'use strict';
// 被験者実験用 GUI のサーバ。研究室の PC で動かし、同じ PC のブラウザで開く。
//
// 実行方法：node tsumepoke/gui/server.js [ポート番号] [--engine v1]
//   例：node tsumepoke/gui/server.js        → http://localhost:8787/ を開く
// npm のパッケージは使わない。localhost からの接続だけを受け付ける。
//
// 記録は results/<被験者 ID>.json に、1問終わるごとに書き出す。
// 対戦の途中の状態はメモリにだけ持つので、サーバを止めるとその問題は最初からになる。

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Schema = require('./settings_schema');
const Sets = require('./sets');

const args = process.argv.slice(2);
const engineIndex = args.indexOf('--engine');
const ENGINE = engineIndex >= 0 ? args[engineIndex + 1] : 'v1';
const PORT = Number(args.find((a, i) => /^\d+$/.test(a) && (engineIndex < 0 || i !== engineIndex + 1)) || 8787);
const adapter = require(`./adapters/${ENGINE}`);

const PUBLIC = path.join(__dirname, 'public');
const CONFIG = path.join(__dirname, 'config');
const RESULTS = path.join(__dirname, 'results');
const SETTINGS_FILE = path.join(CONFIG, 'settings.json');

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
function writeJson(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
	fs.renameSync(file + '.tmp', file);
}

const settings = () => Schema.resolve(readJson(SETTINGS_FILE, {}), adapter.features);
const ratingItems = () => readJson(path.join(CONFIG, 'rating_items.json'), []);
const surveyItems = () => readJson(path.join(CONFIG, 'survey_items.json'), []);

function spriteList() {
	const dir = path.join(PUBLIC, 'sprites');
	if (!fs.existsSync(dir)) return {};
	const out = {};
	for (const f of fs.readdirSync(dir)) {
		const m = f.match(/^([a-z0-9]+)\.(png|gif|webp|jpg)$/);
		if (m) out[m[1]] = f;
	}
	return out;
}

// 被験者の記録
function participantFile(pid) {
	if (!/^[\w-]{1,64}$/.test(pid)) throw new Error('被験者 ID は英数字と - _ だけにしてください');
	return path.join(RESULTS, pid + '.json');
}
const loadParticipant = pid => readJson(participantFile(pid), null);
const saveParticipant = p => writeJson(participantFile(p.participant), p);

function participantSummary(p) {
	const done = p.items.filter(it => it.result && it.result.finished).length;
	const next = p.items.find(it => !(it.result && it.result.finished));
	return {
		participant: p.participant, set: p.set, setName: p.setName, total: p.items.length, done,
		nextOrder: next ? next.order : null, survey: Boolean(p.survey), flow: p.flow, practiceDone: p.practice.length,
	};
}

// 対戦中の問題
const games = new Map();

function newAttempt(entry) {
	entry.game = new adapter.Game(entry.puzzle);
	entry.attempts.push({ startedAt: Date.now(), steps: null, outcome: null, failReason: null });
}

function closeAttempt(entry, outcome) {
	const a = entry.attempts[entry.attempts.length - 1];
	if (a.outcome) return;
	a.outcome = outcome;
	a.steps = entry.game.steps;
	a.failReason = entry.game.failReason;
	a.seconds = Math.round((Date.now() - a.startedAt) / 100) / 10;
	delete a.startedAt;
}

function gameMeta(entry) {
	return {
		gameId: entry.gameId, kind: entry.kind, id: entry.puzzle.id, length: entry.puzzle.length,
		order: entry.order, total: entry.total, attempt: entry.attempts.length, status: entry.status,
		elapsed: Math.round((Date.now() - entry.startedAt) / 1000),
	};
}

// 解き終わった（正解、あきらめ、時間切れ）ときの記録を作る。評価はあとで足す。
function finishEntry(entry, status) {
	entry.status = status;
	entry.endedAt = Date.now();
	entry.record = {
		solved: status === 'solved', gaveUp: status !== 'solved', timedOut: status === 'timeout',
		failures: entry.attempts.filter(a => a.outcome === 'failed').length,
		seconds: Math.round((entry.endedAt - entry.startedAt) / 1000),
		attempts: entry.attempts,
	};
}

function saveRecord(entry, rating) {
	if (entry.kind !== 'main' && entry.kind !== 'practice') return;
	const p = loadParticipant(entry.participant);
	const result = {
		...entry.record, answerViewed: entry.answerViewed, uiCounts: entry.uiCounts, uiLog: entry.uiLog,
		ratings: rating ? rating.ratings : null, comment: rating ? rating.comment : null,
		startedAt: new Date(entry.startedAt).toISOString(), ratedAt: new Date().toISOString(), finished: true,
	};
	if (entry.kind === 'main') p.items[entry.order - 1].result = result;
	else p.practice.push({ id: entry.puzzle.id, length: entry.puzzle.length, result });
	saveParticipant(p);
}

// API
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

route('GET', /^\/api\/meta$/, () => ({
	engine: { id: adapter.id, label: adapter.label, features: adapter.features },
	rules: adapter.rules(),
	typeChart: adapter.typeChart(),
	settings: settings(),
	ratingItems: ratingItems(),
	surveyItems: surveyItems(),
	sets: Sets.listSets(),
	sprites: spriteList(),
}));

route('POST', /^\/api\/settings$/, body => {
	const saved = readJson(SETTINGS_FILE, {});
	for (const s of Schema.SETTINGS) if (body[s.key] !== undefined) saved[s.key] = body[s.key];
	writeJson(SETTINGS_FILE, saved);
	return settings();
});

route('POST', /^\/api\/settings\/reset$/, () => {
	writeJson(SETTINGS_FILE, {});
	return settings();
});

route('GET', /^\/api\/results$/, () => {
	if (!fs.existsSync(RESULTS)) return [];
	return fs.readdirSync(RESULTS).filter(f => f.endsWith('.json')).map(f => participantSummary(readJson(path.join(RESULTS, f))));
});

// 被験者を登録する。すでにあれば、その記録を返す（続きから再開する）。
route('POST', /^\/api\/participant$/, body => {
	const pid = String(body.participant || '').trim();
	let p = loadParticipant(pid);
	if (!p) {
		const s = settings();
		const { set, items } = Sets.assign(body.set, pid, s.shuffleOrder);
		p = {
			participant: pid, set: body.set, setName: set.name, engine: adapter.id, createdAt: new Date().toISOString(),
			settings: s, survey: null, flow: {}, practice: [], items,
		};
		saveParticipant(p);
	}
	return participantSummary(p);
});

route('POST', /^\/api\/participant\/([\w-]+)\/survey$/, (body, m) => {
	const p = loadParticipant(m[1]);
	p.survey = { answers: body.answers, at: new Date().toISOString() };
	saveParticipant(p);
	return participantSummary(p);
});

route('POST', /^\/api\/participant\/([\w-]+)\/flow$/, (body, m) => {
	const p = loadParticipant(m[1]);
	p.flow[body.step] = new Date().toISOString();
	saveParticipant(p);
	return participantSummary(p);
});

// 問題を始める。kind は 'main'（本番）、'practice'（練習）、'free'（記録しない）、'demo'（プレイデモ）。
route('POST', /^\/api\/game\/start$/, body => {
	const s = settings();
	const entry = {
		gameId: crypto.randomUUID(), kind: body.kind, participant: body.participant || null, order: null, total: null,
		startedAt: Date.now(), attempts: [], status: 'playing', answerViewed: false, uiCounts: {}, uiLog: [], record: null,
	};
	if (body.kind === 'main') {
		const p = loadParticipant(entry.participant);
		const item = p.items.find(it => it.order === body.order);
		entry.puzzle = item.puzzle;
		entry.order = item.order;
		entry.total = p.items.length;
	} else if (body.kind === 'practice') {
		const ids = String(s.practicePuzzleIds).split(',').map(x => Number(x.trim())).filter(Number.isInteger);
		entry.puzzle = Sets.puzzleById(ids[body.index]);
		entry.order = body.index + 1;
		entry.total = ids.length;
	} else if (body.kind === 'demo') {
		entry.puzzle = Sets.puzzleById(Number(s.demoPuzzleId));
	} else {
		entry.puzzle = Sets.puzzleById(Number(body.puzzleId));
	}
	newAttempt(entry);
	games.set(entry.gameId, entry);
	return { meta: gameMeta(entry), view: entry.game.view() };
});

const getGame = id => {
	const entry = games.get(id);
	if (!entry) throw new Error('問題が見つからない（サーバを動かし直した場合は、問題を最初からやり直してください）');
	return entry;
};

route('POST', /^\/api\/game\/([\w-]+)\/act$/, (body, m) => {
	const entry = getGame(m[1]);
	if (entry.status !== 'playing') throw new Error('この問題はもう終わっている');
	const out = entry.game.act({ type: body.type, index: body.index });
	if (out.view.phase === 'won') {
		closeAttempt(entry, 'solved');
		finishEntry(entry, 'solved');
	} else if (out.view.phase === 'failed') {
		closeAttempt(entry, 'failed');
	}
	return { ...out, meta: gameMeta(entry) };
});

route('POST', /^\/api\/game\/([\w-]+)\/retry$/, (body, m) => {
	const entry = getGame(m[1]);
	if (entry.status !== 'playing') throw new Error('この問題はもう終わっている');
	closeAttempt(entry, 'abandoned');
	newAttempt(entry);
	return { meta: gameMeta(entry), view: entry.game.view() };
});

route('POST', /^\/api\/game\/([\w-]+)\/giveup$/, (body, m) => {
	const entry = getGame(m[1]);
	if (entry.status === 'playing') {
		closeAttempt(entry, body.reason === 'timeout' ? 'timeout' : 'gaveUp');
		finishEntry(entry, body.reason === 'timeout' ? 'timeout' : 'gaveUp');
	}
	return { meta: gameMeta(entry) };
});

route('GET', /^\/api\/game\/([\w-]+)\/answer$/, (body, m) => {
	const entry = getGame(m[1]);
	if (entry.status === 'playing' && entry.kind !== 'demo') throw new Error('解き終わるまで解答は見られない');
	if (entry.kind !== 'demo') entry.answerViewed = true;
	return adapter.answer(entry.puzzle);
});

route('GET', /^\/api\/game\/([\w-]+)\/damage$/, (body, m) => {
	const entry = getGame(m[1]);
	return adapter.damageTable(entry.game.state);
});

route('POST', /^\/api\/game\/([\w-]+)\/ui$/, (body, m) => {
	const entry = getGame(m[1]);
	entry.uiCounts[body.kind] = (entry.uiCounts[body.kind] || 0) + 1;
	entry.uiLog.push({ t: Math.round((Date.now() - entry.startedAt) / 100) / 10, kind: body.kind, detail: body.detail === undefined ? null : body.detail });
	return { ok: true };
});

route('POST', /^\/api\/game\/([\w-]+)\/rate$/, (body, m) => {
	const entry = getGame(m[1]);
	if (entry.status === 'playing') throw new Error('解き終わってから評価してください');
	saveRecord(entry, body.skip ? null : body);
	games.delete(entry.gameId);
	return entry.kind === 'main' ? participantSummary(loadParticipant(entry.participant)) : { ok: true };
});

// 静的ファイル
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8' };

function serveStatic(req, res) {
	const url = decodeURIComponent(req.url.split('?')[0]);
	const file = url === '/settings_schema.js' ? path.join(__dirname, 'settings_schema.js') : path.join(PUBLIC, url === '/' ? 'index.html' : url);
	if (url !== '/settings_schema.js' && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden');
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
	res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
	fs.createReadStream(file).pipe(res);
}

function send(res, status, body) {
	const json = typeof body !== 'string';
	res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
	res.end(json ? JSON.stringify(body) : body);
}

const server = http.createServer((req, res) => {
	const url = req.url.split('?')[0];
	if (!url.startsWith('/api/')) return serveStatic(req, res);
	const r = routes.find(x => x.method === req.method && x.pattern.test(url));
	if (!r) return send(res, 404, { error: 'not found' });
	let raw = '';
	req.on('data', chunk => { raw += chunk; });
	req.on('end', () => {
		try {
			const body = raw ? JSON.parse(raw) : {};
			send(res, 200, r.fn(body, url.match(r.pattern)));
		} catch (e) {
			console.error(e);
			send(res, 400, { error: e.message });
		}
	});
});

server.listen(PORT, '127.0.0.1', () => {
	console.log(`詰めポケ GUI（エンジン ${adapter.id}）を起動した → http://localhost:${PORT}/`);
	console.log('止めるときは Ctrl+C');
});

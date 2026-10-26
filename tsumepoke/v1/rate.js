'use strict';
// 問題を解いて、面白さ・難しさ・意外性を5段階で評価する CLI。
//
// 実行方法：
//   node tsumepoke/v1/rate.js [乱数の種]        … 評価を始める。1問ごとに JSON と CSV に保存し、次は続きの問題から出す
//   node tsumepoke/v1/rate.js [乱数の種] --csv  … 出題せず、JSON から CSV を作り直す
//   node tsumepoke/v1/rate.js [乱数の種] --per 5 … 1ターン数あたりの問題数を変える（最初に問題を選ぶときだけ効く）
//
// 最初の実行で、puzzles.json からターン数ごとに10問を乱数で選び、全体の順番をシャッフルして ratings_<種>.json に保存する。
// 延長法の同じ系列（元をたどると同じランダム生成の問題になるもの）からは1問しか選ばない。
// 同じ詰み筋の問題を2回解くと、2問目の評価が1問目に引きずられるため。
// 問題の局面は ratings_<種>.json にも写しておくので、あとで puzzles.json を作り直しても評価は残る。

const fs = require('fs');
const path = require('path');
const { showAnswer, showRefutations, makeLineReader, askIndex, attempt } = require('./play');

const args = process.argv.slice(2);
const perIndex = args.indexOf('--per');
const PER = perIndex >= 0 ? Number(args[perIndex + 1]) : 10;
const SEED = Number(args.find((a, i) => /^\d+$/.test(a) && (perIndex < 0 || i !== perIndex + 1)) || 1);
const PUZZLES = path.join(__dirname, 'puzzles.json');
const SESSION = path.join(__dirname, `ratings_${SEED}.json`);
const CSV = path.join(__dirname, `ratings_${SEED}.csv`);

// generate.js と同じ mulberry32。
function makeRng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(arr, rand) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// 延長の元をたどって、系列の最初の問題の id を返す。
function rootOf(puzzles, p) {
	while (p.origin && p.origin.method === 'extend') p = puzzles[p.origin.from];
	return p.id;
}

function sample(puzzles) {
	const rand = makeRng(SEED);
	const lengths = [...new Set(puzzles.map(p => p.length))].sort((x, y) => x - y);
	const usedRoots = new Set();
	const picked = [];
	// 長い問題から選ぶ。長い問題は数が少なく、系列の重なりで選べなくなりやすいため。
	for (const len of [...lengths].reverse()) {
		let n = 0;
		for (const p of shuffle(puzzles.filter(q => q.length === len), rand)) {
			if (n >= PER) break;
			const root = rootOf(puzzles, p);
			if (usedRoots.has(root)) continue;
			usedRoots.add(root);
			picked.push(p);
			n++;
		}
		if (n < PER) console.log(`${len}ターンの問題は ${n} 問しか選べなかった`);
	}
	return shuffle(picked, rand).map((p, i) => ({ order: i + 1, id: p.id, length: p.length, puzzle: p, result: null }));
}

function save(session) {
	fs.writeFileSync(SESSION + '.tmp', JSON.stringify(session, null, 1));
	fs.renameSync(SESSION + '.tmp', SESSION);
}

function writeCsv(session) {
	const head = ['order', 'id', 'length', 'solved', 'failures', 'gaveUp', 'seconds', 'fun', 'difficulty', 'surprise', 'comment', 'ratedAt'];
	const cell = v => (v === undefined || v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
	const rows = session.items.map(it => {
		const r = it.result || {};
		return [it.order, it.id, it.length, r.solved, r.failures, r.gaveUp, r.seconds, r.fun, r.difficulty, r.surprise, r.comment, r.ratedAt].map(cell).join(',');
	});
	// Excel で文字化けしないように BOM を付ける。
	fs.writeFileSync(CSV, '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n');
	console.log(`${session.items.filter(it => it.result).length} 問ぶんの評価を書き出した → ${CSV}`);
}

async function ask(rl, prompt) {
	const raw = await rl.question(prompt);
	if (raw === null) {
		console.log('\n入力が終わったので終了します。');
		process.exit(0);
	}
	return raw.trim();
}

async function askYesNo(rl, prompt) {
	for (;;) {
		const ans = (await ask(rl, prompt)).toLowerCase();
		if (ans === 'y' || ans === 'n') return ans === 'y';
		console.log('y か n で答えてください');
	}
}

async function rateOne(rl, item, total) {
	const puzzle = item.puzzle;
	console.log(`\n################ ${item.order} / ${total} 問目（id ${puzzle.id}）################`);
	console.log(`${puzzle.length}ターン以内に、相手がどう動いても確実に勝つ手順を見つけてください。`);
	const start = Date.now();
	let failures = 0;
	let solved = false;
	for (;;) {
		if (await attempt(rl, puzzle)) {
			console.log('\n正解です！');
			solved = true;
			break;
		}
		failures++;
		console.log(`\n失敗です（${failures} 回目）。`);
		if (!(await askYesNo(rl, 'もう一度挑戦しますか？（y：もう一度／n：あきらめて解答を見る） > '))) break;
	}
	const seconds = Math.round((Date.now() - start) / 1000);
	if (!solved) {
		console.log('\n--- 解答 ---');
		showAnswer(puzzle);
		showRefutations(puzzle);
	} else if (await askYesNo(rl, '解答と、正解以外の初手への受けを見ますか？（y/n） > ')) {
		showAnswer(puzzle);
		showRefutations(puzzle);
	}
	console.log('\n面白さ：1 つまらない／2 あまり面白くない／3 ふつう／4 面白い／5 とても面白い');
	const fun = await askIndex(rl, '面白さは？ > ', 5) + 1;
	console.log('難しさ：1 すぐ分かった／2 少し考えた／3 しっかり考えた／4 かなり考えた・何度か間違えた／5 解けなかった・ほぼ解けなかった');
	const difficulty = await askIndex(rl, '難しさは？ > ', 5) + 1;
	console.log(SURPRISE_SCALE);
	const surprise = await askIndex(rl, '意外性は？ > ', 5) + 1;
	const comment = await ask(rl, 'コメント（なぜ面白い・つまらないか。空でもよい） > ');
	return { solved, failures, gaveUp: !solved, seconds, fun, difficulty, surprise, comment, ratedAt: new Date().toISOString() };
}

const SURPRISE_SCALE = '意外性：1 予想どおり（最初に思いついた手が正解）／2 ほぼ予想どおり／3 少し意外／4 意外／5 とても意外（思いつかなかった手が正解）';

// 意外性を聞く前に評価した問題に、あとから意外性だけを付ける。解答を見せて思い出してもらう。
// 空で答えると null を入れ、次からは聞かない。
async function addSurprise(rl, item) {
	const r = item.result;
	console.log(`\n################ 意外性の追加：${item.order} 問目（id ${item.id}、${item.length}ターン）################`);
	console.log(`前の評価：面白さ ${r.fun}、難しさ ${r.difficulty}、コメント「${r.comment}」`);
	showAnswer(item.puzzle);
	showRefutations(item.puzzle);
	console.log('\n' + SURPRISE_SCALE);
	for (;;) {
		const ans = await ask(rl, '意外性は？（空で飛ばす） > ');
		if (ans === '') return null;
		const k = Number(ans);
		if (Number.isInteger(k) && k >= 1 && k <= 5) return k;
		console.log('1〜5 の番号か、空で答えてください');
	}
}

async function main() {
	let session;
	if (fs.existsSync(SESSION)) {
		session = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
	} else {
		const puzzles = JSON.parse(fs.readFileSync(PUZZLES, 'utf8'));
		session = { seed: SEED, per: PER, createdAt: new Date().toISOString(), items: sample(puzzles) };
		save(session);
		console.log(`${session.items.length} 問を選んだ → ${SESSION}`);
	}
	if (args.includes('--csv')) {
		writeCsv(session);
		return;
	}
	const noSurprise = session.items.filter(it => it.result && it.result.surprise === undefined);
	const rest = session.items.filter(it => !it.result);
	if (!rest.length && !noSurprise.length) {
		console.log('すべての問題を評価済み。');
		return;
	}
	const rl = makeLineReader();
	if (noSurprise.length) console.log(`意外性をまだ付けていない評価済みの問題が ${noSurprise.length} 問ある。先にそれを聞く。`);
	for (const item of noSurprise) {
		item.result.surprise = await addSurprise(rl, item);
		save(session);
		writeCsv(session);
	}
	console.log(`残り ${rest.length} / ${session.items.length} 問。1問終わるごとに保存するので、途中で Ctrl+C で止めてもよい。`);
	for (const item of rest) {
		item.result = await rateOne(rl, item, session.items.length);
		save(session);
		writeCsv(session);
	}
	rl.close();
	console.log('\nすべての問題を評価した。');
}

main();

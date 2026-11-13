'use strict';
require('./rules').readRuleArgs();
// 問題生成。ランダム生成で短い問題を作り、延長法で1ターンずつ伸ばす。
//
// 実行方法：node tsumepoke/v2/generate.js [最長ターン数] [乱数の種] [オプション]
//   例：node tsumepoke/v2/generate.js 4 1
//   例：node tsumepoke/v2/generate.js 10 1 --from 7（ランダム生成をせず、今ある7ターンの問題から延長する）
// オプション：
//   --from N         ランダム生成をせず、今ある N ターンの問題から延長する
//   --attempts N     1つの元の問題につき延長を試す回数の上限（初期値 60）
//   --hit-weight W   延長の変更「相手の HP を回答者の技1発ぶん増やす」の重み（初期値 0 で使わない。ほかの変更の重みは合わせて 6）
//   --dedup-line     解答の手順（両者のポケモンと手）が同じで同じターン数の問題を除く（初期値では除かない）
//   --out FILE       書き出すファイル（初期値 tsumepoke/v2/puzzles_<ルール>.json）
//   --rule ID        ルール（rules.js。初期値 champions）
//   --megas / --no-megas  メガシンカした姿を候補に入れるか（初期値はルールで決まる）
// 結果は puzzles.json に書き出す（ファイルがあれば追記する）。段が1つ終わるたびに書き出す。
// 問題ごとに、解答の手順（line）、代理指標（metrics）、延長の系列の始まりの問題（root）も書く。
// 途中経過は標準エラー出力に出す。
//
// 延長では、N ターンの問題に「1ターン前はこうだった」と見える変更をランダムに加え、N+1 ターンの問題になるかをソルバで調べる。
// 実際の手を戻す厳密な逆算は、両者の手の組とダメージを推定することになり候補が多すぎるので、やらない。
// 候補を作ってから検証する形は、tanuki-tsume-shogi の変異法に近い（石井や tanuki の延長法は実際の手を戻すので別物）。
// 変更は「HP がもっと多かった」「倒れる前のポケモンが場にいた」「交代する前だった」の3通り。
// --hit-weight を付けると「相手の HP が回答者の技1発ぶん多かった」も加わる。

const fs = require('fs');
const path = require('path');
const { RULE, buildMovePool, buildSpeciesPool } = require('./data');
const E = require('./engine');
const { Solver } = require('./solver');
const { answerLine, proxyMetrics, lineKey } = require('./metrics');

// 値を取るオプションと、値を取らないオプションを読む。残りは位置引数にする。
const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--from', '--attempts', '--hit-weight', '--out'];
const FLAG_OPTIONS = ['--dedup-line'];
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
	if (VALUE_OPTIONS.includes(args[i])) opts[args[i]] = args[++i];
	else if (FLAG_OPTIONS.includes(args[i])) opts[args[i]] = true;
	else if (args[i].startsWith('--')) throw new Error(`知らないオプションです：${args[i]}`);
	else positional.push(args[i]);
}
const OUT = opts['--out'] ? path.resolve(opts['--out']) : path.join(__dirname, `puzzles_${RULE.tag}.json`);
const FROM = opts['--from'] !== undefined ? Number(opts['--from']) : null;
const EXTEND_ATTEMPTS_PER_PUZZLE = opts['--attempts'] !== undefined ? Number(opts['--attempts']) : 60;
const HIT_WEIGHT = opts['--hit-weight'] !== undefined ? Number(opts['--hit-weight']) : 0;
const DEDUP_LINE = Boolean(opts['--dedup-line']);
if (!(Number.isInteger(EXTEND_ATTEMPTS_PER_PUZZLE) && EXTEND_ATTEMPTS_PER_PUZZLE >= 1)) throw new Error('--attempts には 1 以上の整数を指定してください');
if (!(Number.isInteger(HIT_WEIGHT) && HIT_WEIGHT >= 0)) throw new Error('--hit-weight には 0 以上の整数を指定してください');
const MAX_LENGTH = Number(positional[0] || 4);
const SEED = Number(positional[1] || 1);
if (FROM !== null && !(Number.isInteger(FROM) && FROM >= 1 && FROM < MAX_LENGTH)) {
	throw new Error(`--from には 1 以上 ${MAX_LENGTH} 未満の整数を指定してください`);
}
const TEAM_MAX = 3;
const MOVES_MAX = 4;
const SEED_MAX_LENGTH = 2;
const SEED_ATTEMPTS = 4000;
const OPTIONS = { rule: RULE.id, megas: RULE.megas, attempts: EXTEND_ATTEMPTS_PER_PUZZLE, hitWeight: HIT_WEIGHT, dedupLine: DEDUP_LINE };

// 乱数は mulberry32（32ビット整数だけで計算できる）。seed が同じなら同じ問題が出る。
function makeRng(seed) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return { next, int: n => Math.floor(next() * n), pick: arr => arr[Math.floor(next() * arr.length)] };
}

const rng = makeRng(SEED);
const movePool = buildMovePool();
const speciesPool = buildSpeciesPool(movePool);
const speciesById = new Map(speciesPool.map(sp => [sp.id, sp]));

// side には同じ側にすでにいるポケモンを渡す。ルールの speciesClause と megaLimit に合うポケモンだけから選ぶ。
// どちらも使わないルールでは、Ver1 と同じ乱数の使い方になる。
function randomMon(hpRatioMin = 0.05, side = []) {
	let pool = speciesPool;
	if (RULE.speciesClause || RULE.megaLimit !== null) {
		const bases = new Set(side.map(m => speciesById.get(m.species).base));
		const megas = side.filter(m => speciesById.get(m.species).mega).length;
		pool = speciesPool.filter(sp => !(RULE.speciesClause && bases.has(sp.base)) && !(RULE.megaLimit !== null && sp.mega && megas >= RULE.megaLimit));
	}
	const sp = rng.pick(pool);
	const moves = [...sp.moves];
	// 技の候補から最大4つを選ぶ（Fisher–Yates を途中まで回して先頭を取る）。
	for (let i = 0; i < Math.min(MOVES_MAX, moves.length); i++) {
		const j = i + rng.int(moves.length - i);
		[moves[i], moves[j]] = [moves[j], moves[i]];
	}
	const maxhp = E.speciesInfo(sp.id).stats.hp;
	const hp = Math.max(1, Math.ceil(maxhp * (hpRatioMin + (1 - hpRatioMin) * rng.next())));
	return { species: sp.id, moves: moves.slice(0, MOVES_MAX).sort(), hp };
}

function randomPosition() {
	const make = () => {
		const n = 1 + rng.int(TEAM_MAX);
		const mons = [];
		for (let i = 0; i < n; i++) mons.push(randomMon(0.05, mons));
		return { active: 0, mons };
	};
	return { sides: [make(), make()] };
}

// 問題の重複を見分けるキー。技の並びも含める。
function puzzleKey(state) {
	return state.sides.map(s => s.active + ':' + s.mons.map(m => `${m.species}=${m.hp}[${m.moves.join('/')}]`).join(',')).join('|');
}

// 問題として成立するかを調べ、成立すれば問題の情報を返す。しなければ null。
// 条件は cap ターン以内に確定勝ちがあり、最短で勝てる初手が1つだけであること。
// cap は作りたいターン数より1つ大きくする。迂回の手は cap ターン以内のものだけを数える。
function check(state, cap) {
	const solver = new Solver();
	const a = solver.analyze(state, cap);
	if (!Number.isFinite(a.length) || a.winners.length !== 1) return null;
	const detour = a.others.filter(o => Number.isFinite(o.distance) && o.distance > a.length).length;
	return { length: a.length, solution: a.winners[0], detourMoves: detour, turnSimulations: solver.stats.turns };
}

// 1ターン前に戻したように見える変更を1つ加えた局面を返す。変更できなければ（控えが満員など）null。
function reverseStep(state) {
	const s = E.cloneState(state);
	const p1 = s.sides[0];
	const p2 = s.sides[1];
	const heal = (mon) => {
		const maxhp = E.speciesInfo(mon.species).stats.hp;
		if (mon.hp >= maxhp) return false;
		mon.hp = Math.min(maxhp, mon.hp + 1 + rng.int(maxhp - mon.hp));
		return true;
	};
	// 重みが 0 のときは V1 と同じ乱数の使い方にする。同じ種なら V1 と同じ変更が選ばれる。
	const r = HIT_WEIGHT > 0 ? rng.int(6 + HIT_WEIGHT) : rng.int(6);
	if (r >= 6) {
		// 相手の場のポケモンの HP を、回答者の場のポケモンの技1発ぶん増やす。技はダメージが 0 でないものから選ぶ。
		const me = E.activeMon(p1);
		const foe = E.activeMon(p2);
		const dmg = me.moves.map(m => E.calcDamage(me.species, foe.species, m, 85)).filter(d => d > 0);
		if (dmg.length === 0) return null;
		const hp = foe.hp + rng.pick(dmg);
		if (hp > E.speciesInfo(foe.species).stats.hp) return null;
		foe.hp = hp;
		return s;
	}
	switch (r) {
	case 0: case 1:
		// 相手の場のポケモンの HP を増やす。
		return heal(E.activeMon(p2)) ? s : null;
	case 2:
		// 前のターンに p1 が倒したポケモンを相手の場に足す。今の場のポケモンは控えに下がる。
		if (p2.mons.length >= TEAM_MAX) return null;
		p2.mons.push(randomMon(0.05, p2.mons));
		p2.active = p2.mons.length - 1;
		return s;
	case 3:
		// 前のターンに相手が交代したとみなし、交代前のポケモンを場に戻す。
		if (p2.mons.filter(m => m.hp > 0).length < 2) return null;
		p2.active = rng.pick(p2.mons.map((m, i) => i).filter(i => i !== p2.active && p2.mons[i].hp > 0));
		return s;
	case 4:
		// 回答者の場のポケモンの HP を増やす。
		return heal(E.activeMon(p1)) ? s : null;
	default:
		// 前のターンに回答者が交代したとみなし、交代前のポケモンを場に戻す。
		if (p1.mons.filter(m => m.hp > 0).length < 2) return null;
		p1.active = rng.pick(p1.mons.map((m, i) => i).filter(i => i !== p1.active && p1.mons[i].hp > 0));
		return s;
	}
}

function loadExisting() {
	if (!fs.existsSync(OUT)) return [];
	return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}

// 一時ファイルに書いてから置き換える。書き出しの途中で止めても puzzles.json が壊れないため。
function save(puzzles) {
	fs.writeFileSync(OUT + '.tmp', JSON.stringify(puzzles, null, 1));
	fs.renameSync(OUT + '.tmp', OUT);
}

// 途中経過を標準エラー出力の1行に上書きで出す。出すのは1秒に1回まで。
let lastProgress = 0;
function progress(text, force = false) {
	if (!process.stderr.isTTY) return;
	const now = Date.now();
	if (!force && now - lastProgress < 1000) return;
	lastProgress = now;
	process.stderr.write(`\r${text}\x1b[K`);
}
function clearProgress() {
	if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
}

const seconds = t => ((Date.now() - t) / 1000).toFixed(1);

function main() {
	const puzzles = loadExisting();
	const seen = new Set(puzzles.map(p => puzzleKey(p.state)));
	const seenLines = new Set(puzzles.filter(p => p.lineKey).map(p => p.length + '#' + p.lineKey));
	let lineDuplicates = 0;
	// すでに延長の元になった問題。前の実行で使った元も含める。
	const used = new Set(puzzles.filter(p => p.origin && p.origin.method === 'extend').map(p => p.origin.from));
	const add = (state, info, origin) => {
		const key = puzzleKey(state);
		if (seen.has(key)) return false;
		const line = answerLine({ id: puzzles.length, length: info.length, state });
		const lk = lineKey(line);
		if (DEDUP_LINE && seenLines.has(info.length + '#' + lk)) {
			lineDuplicates++;
			return false;
		}
		seen.add(key);
		seenLines.add(info.length + '#' + lk);
		const root = origin.method === 'extend' ? (puzzles[origin.from].root ?? origin.from) : puzzles.length;
		puzzles.push({
			id: puzzles.length, length: info.length, solution: info.solution, detourMoves: info.detourMoves,
			origin: { ...origin, options: OPTIONS }, root, metrics: proxyMetrics(line), lineKey: lk, line, state,
		});
		return true;
	};

	// ランダムな局面から1〜2ターンの問題を集め、延長の元にする。--from のときはやらない。
	if (FROM === null) {
		const t0 = Date.now();
		let seeds = 0;
		for (let i = 0; i < SEED_ATTEMPTS; i++) {
			progress(`ランダム生成：${i}/${SEED_ATTEMPTS}（${seeds} 問、${seconds(t0)} 秒）`);
			const state = randomPosition();
			const info = check(state, SEED_MAX_LENGTH + 1);
			if (info && info.length <= SEED_MAX_LENGTH && add(state, info, { method: 'random', seed: SEED })) seeds++;
		}
		clearProgress();
		save(puzzles);
		console.log(`ランダム生成：${SEED_ATTEMPTS} 局面から ${seeds} 問（${seconds(t0)} 秒）`);
	}

	// 短い問題から順に1ターン長い問題を作る。できた問題は次の延長の元になる。
	// 1つの元から作るのは1問まで（成功したら次の元へ）。前の実行で元にした問題は使わない。
	for (let len = FROM || 1; len < MAX_LENGTH; len++) {
		const t1 = Date.now();
		const sources = puzzles.filter(p => p.length === len && !used.has(p.id));
		let made = 0;
		for (const [n, src] of sources.entries()) {
			progress(`延長法 ${len}→${len + 1}：${n}/${sources.length}（${made} 問、${seconds(t1)} 秒）`);
			for (let k = 0; k < EXTEND_ATTEMPTS_PER_PUZZLE; k++) {
				// 変更は1〜2回（半々）。1回では届かない局面（HP と交代の両方を戻すなど）があるため。
				let cand = reverseStep(src.state);
				if (cand && rng.int(2) === 0) cand = reverseStep(cand) || cand;
				if (!cand) continue;
				const info = check(cand, len + 2);
				if (info && info.length === len + 1 && add(cand, info, { method: 'extend', from: src.id, seed: SEED })) {
					used.add(src.id);
					made++;
					break;
				}
			}
		}
		clearProgress();
		save(puzzles);
		console.log(`延長法：${len} ターンの問題 ${sources.length} 問から ${len + 1} ターンの問題を ${made} 問（${seconds(t1)} 秒）`);
	}

	const byLen = {};
	for (const p of puzzles) byLen[p.length] = (byLen[p.length] || 0) + 1;
	console.log('問題数（ターン数ごと）:', byLen, `→ ${OUT}`);
	if (DEDUP_LINE) console.log(`解答の手順が同じで除いた問題：${lineDuplicates} 問`);
}

main();

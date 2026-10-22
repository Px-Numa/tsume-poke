'use strict';
// 問題生成。ランダム生成で短い問題を作り、延長法で1ターンずつ伸ばす。
//
// 実行方法：node tsumepoke/v1/generate.js [最長ターン数] [乱数の種] [--from N]
//   例：node tsumepoke/v1/generate.js 4 1
//   例：node tsumepoke/v1/generate.js 10 1 --from 7（ランダム生成をせず、今ある7ターンの問題から延長する）
// 結果は tsumepoke/v1/puzzles.json に書き出す（ファイルがあれば追記する）。段が1つ終わるたびに書き出す。
// 途中経過は標準エラー出力に出す。
//
// 延長では、N ターンの問題に「1ターン前はこうだった」と見える変更をランダムに加え、N+1 ターンの問題になるかをソルバで調べる。
// 実際の手を戻す厳密な逆算は、両者の手の組とダメージを推定することになり候補が多すぎるので、やらない。
// 候補を作ってから検証する形は、tanuki-tsume-shogi の変異法に近い（石井や tanuki の延長法は実際の手を戻すので別物）。
// 変更は「HP がもっと多かった」「倒れる前のポケモンが場にいた」「交代する前だった」の3通り。

const fs = require('fs');
const path = require('path');
const { buildMovePool, buildSpeciesPool } = require('./data');
const E = require('./engine');
const { Solver } = require('./solver');

const OUT = path.join(__dirname, 'puzzles.json');
const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const FROM = fromIndex >= 0 ? Number(args[fromIndex + 1]) : null;
const positional = fromIndex >= 0 ? args.filter((a, i) => i !== fromIndex && i !== fromIndex + 1) : args;
const MAX_LENGTH = Number(positional[0] || 4);
const SEED = Number(positional[1] || 1);
if (FROM !== null && !(Number.isInteger(FROM) && FROM >= 1 && FROM < MAX_LENGTH)) {
	throw new Error(`--from には 1 以上 ${MAX_LENGTH} 未満の整数を指定してください`);
}
const TEAM_MAX = 3;
const MOVES_MAX = 4;
const SEED_MAX_LENGTH = 2;
const SEED_ATTEMPTS = 4000;
const EXTEND_ATTEMPTS_PER_PUZZLE = 60;

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

function randomMon(hpRatioMin = 0.05) {
	const sp = rng.pick(speciesPool);
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
	const make = () => ({ active: 0, mons: Array.from({ length: 1 + rng.int(TEAM_MAX) }, () => randomMon()) });
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
	switch (rng.int(6)) {
	case 0: case 1:
		// 相手の場のポケモンの HP を増やす。
		return heal(E.activeMon(p2)) ? s : null;
	case 2:
		// 前のターンに p1 が倒したポケモンを相手の場に足す。今の場のポケモンは控えに下がる。
		if (p2.mons.length >= TEAM_MAX) return null;
		p2.mons.push(randomMon(0.05));
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
	// すでに延長の元になった問題。前の実行で使った元も含める。
	const used = new Set(puzzles.filter(p => p.origin && p.origin.method === 'extend').map(p => p.origin.from));
	const add = (state, info, origin) => {
		const key = puzzleKey(state);
		if (seen.has(key)) return false;
		seen.add(key);
		puzzles.push({ id: puzzles.length, length: info.length, solution: info.solution, detourMoves: info.detourMoves, origin, state });
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
}

main();

'use strict';
// 詰めポケ Ver1 の問題生成（ランダム生成で短い問題を作り、延長法で1ターンずつ伸ばす）。
//
// 実行方法：node tsumepoke/v1/generate.js [最長ターン数] [乱数の種]
//   例：node tsumepoke/v1/generate.js 4 1
// 結果は tsumepoke/v1/puzzles.json に書き出している（同じファイルがあれば中身を足していく）。
//
// 延長法では、N ターンで詰む問題に「1ターン前に戻したように見える変更」を加え、N+1 ターンの問題になるかをソルバで確かめている。
// 1ターン前の局面を厳密に逆算するのは、両者の手の組と与えたダメージの両方を推定することになり、候補が多くなりすぎる。
// そこで石井（2020）や tanuki-tsume-shogi の延長法と同じく、候補を作ってから検証する方式にした。
// 使う変更は、1ターン前には「HP がもっと多かった」「倒れる前のポケモンが場にいた」「交代する前だった」という状況を作るものにしてある。

const fs = require('fs');
const path = require('path');
const { buildMovePool, buildSpeciesPool } = require('./data');
const E = require('./engine');
const { Solver } = require('./solver');

const OUT = path.join(__dirname, 'puzzles.json');
const MAX_LENGTH = Number(process.argv[2] || 4);
const SEED = Number(process.argv[3] || 1);
const TEAM_MAX = 3;
const MOVES_MAX = 4;
// 最短ターン数を調べる上限で、問題の最大ターン数より1つ大きくして迂回の手順も見えるようにした。
const CAP = MAX_LENGTH + 1;
const SEED_ATTEMPTS = 4000;
const EXTEND_ATTEMPTS_PER_PUZZLE = 60;

// 32ビットの整数だけで計算する mulberry32 を乱数に使っている（seed が同じなら同じ問題が出る）。
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
	// 技の候補から最大4つを選んでいる（Fisher–Yates の途中までで並べ替えて先頭を取る形にした）。
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

// 技の並びまで含めて、問題が同じかどうかを見分けるためのキーを作っている。
function puzzleKey(state) {
	return state.sides.map(s => s.active + ':' + s.mons.map(m => `${m.species}=${m.hp}[${m.moves.join('/')}]`).join(',')).join('|');
}

// 局面が問題として成り立つかを調べ、成り立つなら問題の情報を返している（成り立たなければ null）。
// 条件は、CAP ターン以内に確定勝ちがあり、最短ターン数で勝てる初手がちょうど1つであること。
function check(state) {
	const solver = new Solver();
	const a = solver.analyze(state, CAP);
	if (!Number.isFinite(a.length) || a.winners.length !== 1) return null;
	const detour = a.others.filter(o => Number.isFinite(o.distance) && o.distance > a.length).length;
	return { length: a.length, solution: a.winners[0], detourMoves: detour, turnSimulations: solver.stats.turns };
}

// 1ターン前に戻したように見える変更を1つ加えた局面を返している。
// 変更できなかったとき（例：控えが満員）は null を返すようにした。
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
		// 相手の場のポケモンが、前のターンには今より HP が多かった、という変更にあたる。
		return heal(E.activeMon(p2)) ? s : null;
	case 2:
		// 前のターンに p1 が倒したポケモンを、相手の場に戻している（今の場のポケモンは控えに下がる）。
		if (p2.mons.length >= TEAM_MAX) return null;
		p2.mons.push(randomMon(0.05));
		p2.active = p2.mons.length - 1;
		return s;
	case 3:
		// 前のターンに相手が交代してきた、とみなして、交代する前のポケモンを場に戻している。
		if (p2.mons.filter(m => m.hp > 0).length < 2) return null;
		p2.active = rng.pick(p2.mons.map((m, i) => i).filter(i => i !== p2.active && p2.mons[i].hp > 0));
		return s;
	case 4:
		// 回答者の場のポケモンが、前のターンには今より HP が多かった、という変更にあたる。
		return heal(E.activeMon(p1)) ? s : null;
	default:
		// 前のターンに回答者が交代した、とみなして、交代する前のポケモンを場に戻している。
		if (p1.mons.filter(m => m.hp > 0).length < 2) return null;
		p1.active = rng.pick(p1.mons.map((m, i) => i).filter(i => i !== p1.active && p1.mons[i].hp > 0));
		return s;
	}
}

function loadExisting() {
	if (!fs.existsSync(OUT)) return [];
	return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}

function main() {
	const puzzles = loadExisting();
	const seen = new Set(puzzles.map(p => puzzleKey(p.state)));
	const add = (state, info, origin) => {
		const key = puzzleKey(state);
		if (seen.has(key)) return false;
		seen.add(key);
		puzzles.push({ id: puzzles.length, length: info.length, solution: info.solution, detourMoves: info.detourMoves, origin, state });
		return true;
	};

	// ランダムに局面を作り、1〜2ターンで詰む問題を集めて延長の元にしている。
	const t0 = Date.now();
	let seeds = 0;
	for (let i = 0; i < SEED_ATTEMPTS; i++) {
		const state = randomPosition();
		const info = check(state);
		if (info && info.length <= 2 && add(state, info, { method: 'random', seed: SEED })) seeds++;
	}
	console.log(`ランダム生成：${SEED_ATTEMPTS} 局面から ${seeds} 問（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);

	// 短い問題から順に、1ターン長い問題を作っていく。作れた問題も、次の延長の元に使っている。
	for (let len = 1; len < MAX_LENGTH; len++) {
		const t1 = Date.now();
		const sources = puzzles.filter(p => p.length === len);
		let made = 0;
		for (const src of sources) {
			for (let k = 0; k < EXTEND_ATTEMPTS_PER_PUZZLE; k++) {
				// 変更を1〜2回重ねている。1回だけでは届かない局面（例：HP を戻しつつ交代も戻す）もあるためである。
				let cand = reverseStep(src.state);
				if (cand && rng.int(2) === 0) cand = reverseStep(cand) || cand;
				if (!cand) continue;
				const info = check(cand);
				if (info && info.length === len + 1 && add(cand, info, { method: 'extend', from: src.id, seed: SEED })) {
					made++;
					break;
				}
			}
		}
		console.log(`延長法：${len} ターンの問題 ${sources.length} 問から ${len + 1} ターンの問題を ${made} 問（${((Date.now() - t1) / 1000).toFixed(1)} 秒）`);
	}

	fs.writeFileSync(OUT, JSON.stringify(puzzles, null, 1));
	const byLen = {};
	for (const p of puzzles) byLen[p.length] = (byLen[p.length] || 0) + 1;
	console.log('問題数（ターン数ごと）:', byLen, `→ ${OUT}`);
}

main();

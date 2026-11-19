'use strict';
require('./rules').readRuleArgs();
// 人に見せる問題（プレイデモ、スライドなど）の候補を、知名度、タイプの分かりやすさ、問題の分かりやすさで点を付けて並べる。
//
// 実行方法：node tsumepoke/v2/pick_demo.js [オプション]
//   例：node tsumepoke/v2/pick_demo.js --length 2 --top 10
//   例：node tsumepoke/v2/pick_demo.js --length 1 --top 10 --rule gen9
// オプション：
//   --length N       ターン数（初期値 2）
//   --team-max N     どちらの側も N 匹以下の問題だけにする（初期値 なし）
//   --team-min N     どちらの側も N 匹以上の問題だけにする（初期値 なし）
//   --non-greedy N   非短絡手の数が N 以上の問題だけにする（初期値 なし）
//   --changes N      手の変化（metrics.js）が N 以上の問題だけにする（初期値 なし）。毎ターン同じ技を押すだけの問題を除くときに使う
//   --all-super      解答の技がすべて効果ばつぐんの問題だけにする（初期値 なし）
//   --megas-ok       メガシンカした姿を含む問題も候補にする（初期値では除く）
//   --top N          表示する数（初期値 15）
//   --ids a,b,c      この id の問題だけに点を付ける（今のデモの問題と比べるときに使う）
//   --criteria FILE  基準のファイル（初期値 tsumepoke/v2/demo_criteria.json）
//   --puzzles FILE   問題のファイル（初期値 tsumepoke/v2/puzzles_<ルール>.json）
//   --json FILE      結果を JSON でも書き出す
//   --rule ID、--megas / --no-megas  ルール（rules.js）
//
// 点はどれも 0〜1 で、大きいほど人に見せやすい。基準の中身は demo_criteria.json に書いてある。
// 知名度とタイプは両方の側のポケモン全員で測り、問題の分かりやすさは解答の手順（metrics.js の answerLine）で測る。

const fs = require('fs');
const path = require('path');
const { RULE, dex } = require('./data');
const E = require('./engine');
const { Solver } = require('./solver');
const { answerLine, proxyMetrics } = require('./metrics');

const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--length', '--team-max', '--team-min', '--non-greedy', '--changes', '--top', '--ids', '--criteria', '--puzzles', '--json'];
const FLAG_OPTIONS = ['--megas-ok', '--all-super'];
const opts = {};
for (let i = 0; i < args.length; i++) {
	if (VALUE_OPTIONS.includes(args[i])) opts[args[i]] = args[++i];
	else if (FLAG_OPTIONS.includes(args[i])) opts[args[i]] = true;
	else throw new Error(`知らない引数です：${args[i]}`);
}
const LENGTH = Number(opts['--length'] || 2);
const TEAM_MAX = opts['--team-max'] ? Number(opts['--team-max']) : Infinity;
const TEAM_MIN = opts['--team-min'] ? Number(opts['--team-min']) : 0;
const NON_GREEDY = opts['--non-greedy'] ? Number(opts['--non-greedy']) : 0;
const CHANGES = opts['--changes'] ? Number(opts['--changes']) : 0;
const TOP = Number(opts['--top'] || 15);
const IDS = opts['--ids'] ? new Set(opts['--ids'].split(',').map(Number)) : null;
const CRITERIA = JSON.parse(fs.readFileSync(opts['--criteria'] || path.join(__dirname, 'demo_criteria.json'), 'utf8'));
const PUZZLES = opts['--puzzles'] || path.join(__dirname, `puzzles_${RULE.tag}.json`);

const ja = JSON.parse(fs.readFileSync(path.join(__dirname, 'names_ja.json'), 'utf8'));
const speciesName = id => ja.species[id] || dex.species.get(id).name;
const moveName = id => ja.moves[id] || dex.moves.get(id).name;
const typeName = t => ja.types[t] || t;

// ---------- 知名度とタイプ ----------

const famousA = new Set(CRITERIA.famous.A);
const famousB = new Set(CRITERIA.famous.B);

// ポケモン1匹の知名度。
function popularity(id) {
	const s = dex.species.get(id);
	const base = dex.species.get(s.baseSpecies).id;
	let score = famousA.has(base) ? CRITERIA.famous.scoreA
		: famousB.has(base) ? CRITERIA.famous.scoreB
		: CRITERIA.famous.genScore[String(dex.species.get(base).gen)] ?? 0.25;
	if (s.isMega) score *= CRITERIA.famous.megaFactor;
	else if (id !== base) score *= CRITERIA.famous.formFactor;
	return score;
}

const typeTier = new Map();
for (const tier of ['basic', 'middle', 'hard']) for (const t of CRITERIA.types[tier].types) typeTier.set(t, CRITERIA.types[tier].score);

// ポケモン1匹のタイプの分かりやすさ。
function typeScore(id) {
	const types = E.speciesInfo(id).types;
	const avg = types.reduce((a, t) => a + (typeTier.get(t) ?? 0.3), 0) / types.length;
	return types.length > 1 ? avg * CRITERIA.types.dualFactor : avg;
}

// ---------- 問題の分かりやすさ ----------

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function clarity(puzzle, line) {
	const sides = puzzle.state.sides;
	// 遠回りして勝てる初手の数。
	const detour = 1 / (1 + puzzle.detourMoves);
	// 2手目以降に、解答の手のほかにも勝てる手がある数。初手は生成の時点で1つに決まっている。
	const extra = line.slice(1).reduce((a, s) => a + Math.max(0, s.winCount - 1), 0);
	const alternatives = 1 / (1 + extra);
	// 解答の手順で一度も場に出ないポケモンの数。
	const appeared = [new Set(), new Set()];
	for (const s of line) {
		appeared[0].add(s.me);
		appeared[1].add(s.foe);
		if (s.foeReplace) appeared[1].add(s.foeReplace);
		if (s.meReplace) appeared[0].add(s.meReplace);
	}
	const unusedCount = sides.reduce((a, side, i) => a + side.mons.filter(m => !appeared[i].has(m.species)).length, 0);
	const unused = 1 / (1 + 0.5 * unusedCount);
	// 読む量。技の総数が6以下なら1、26で0.3。
	const moveCount = sides.reduce((a, side) => a + side.mons.reduce((b, m) => b + m.moves.length, 0), 0);
	const reading = clamp(1 - (moveCount - 6) / 20 * 0.7, 0.3, 1);
	// 優先度の技と、素早さの同じ組。どちらも説明が要る。
	const priority = sides.some(side => side.mons.some(m => m.moves.some(id => E.moveInfo(id).priority !== 0)));
	const speeds = sides.map(side => side.mons.map(m => E.speciesInfo(m.species).stats.spe));
	const speedTie = speeds[0].some(a => speeds[1].includes(a));
	const mechanics = (priority ? 0.6 : 1) * (speedTie ? 0.7 : 1);
	// 解答の技のうち、効果ばつぐんの技の割合。タイプの相性で理由を説明しやすい。
	const moveSteps = line.filter(s => !s.action.startsWith('>'));
	const superCount = moveSteps.filter(s => effectiveness(s.action, s.foe) >= 2).length;
	const reason = moveSteps.length ? superCount / moveSteps.length : 0;
	const w = CRITERIA.clarity;
	const score = (w.detour * detour + w.alternatives * alternatives + w.unused * unused + w.reading * reading + w.mechanics * mechanics + w.reason * reason)
		/ (w.detour + w.alternatives + w.unused + w.reading + w.mechanics + w.reason);
	return { score, detourMoves: puzzle.detourMoves, extraWins: extra, unusedCount, moveCount, priority, speedTie, superCount, moveSteps: moveSteps.length };
}

// 解答の技の相性（2倍以上なら「効果ばつぐん」）。
function effectiveness(attackerMoveId, defenderSpecies) {
	const move = E.moveInfo(attackerMoveId);
	const types = E.speciesInfo(defenderSpecies).types;
	if (!dex.getImmunity(move.type, types)) return 0;
	return 2 ** dex.getEffectiveness(move.type, types);
}

// ---------- 点を付ける ----------

const puzzles = JSON.parse(fs.readFileSync(PUZZLES, 'utf8'));
const solver = new Solver();
const results = [];
for (const p of puzzles) {
	if (IDS ? !IDS.has(p.id) : p.length !== LENGTH) continue;
	const sides = p.state.sides;
	if (!IDS) {
		if (sides.some(s => s.mons.length > TEAM_MAX || s.mons.length < TEAM_MIN)) continue;
		if (!opts['--megas-ok'] && sides.some(s => s.mons.some(m => dex.species.get(m.species).isMega))) continue;
	}
	const line = answerLine(p, solver);
	const metrics = proxyMetrics(line);
	if (!IDS && (metrics.nonGreedy < NON_GREEDY || metrics.changes < CHANGES)) continue;
	const mons = sides.flatMap(s => s.mons.map(m => m.species));
	const pops = mons.map(popularity);
	const pop = 0.5 * (pops.reduce((a, b) => a + b, 0) / pops.length) + 0.5 * Math.min(...pops);
	const types = mons.map(typeScore).reduce((a, b) => a + b, 0) / mons.length;
	const cl = clarity(p, line);
	if (!IDS && opts['--all-super'] && cl.superCount < cl.moveSteps) continue;
	const W = CRITERIA.weights;
	const total = (W.popularity * pop + W.types * types + W.clarity * cl.score) / (W.popularity + W.types + W.clarity);
	results.push({ id: p.id, length: p.length, teams: sides.map(s => s.mons.length), total, popularity: pop, types, clarity: cl, metrics, line, puzzle: p });
}
results.sort((a, b) => b.total - a.total);

// ---------- 表示 ----------

const f2 = x => x.toFixed(2);
function describeMon(m) {
	const info = E.speciesInfo(m.species);
	const moves = m.moves.map(id => `${moveName(id)}(${typeName(E.moveInfo(id).type)})`).join('・');
	return `${speciesName(m.species)}[${info.types.map(typeName).join('/')}] HP${m.hp}/${calcMaxHp(m.species)} 素早さ${info.stats.spe} 技：${moves}`;
}
function calcMaxHp(id) { return E.speciesInfo(id).stats.hp; }
function describeLine(line) {
	return line.map((s, i) => {
		const act = s.action.startsWith('>') ? `${speciesName(s.action.slice(1))}に交代` : moveName(s.action);
		const eff = s.action.startsWith('>') ? '' : (() => { const e = effectiveness(s.action, s.foe); return e >= 2 ? '（ばつぐん）' : e === 0 ? '（効果なし）' : e < 1 ? '（いまひとつ）' : ''; })();
		const foeAct = s.foeAction.startsWith('>') ? `${speciesName(s.foeAction.slice(1))}に交代` : moveName(s.foeAction);
		const rep = s.foeReplace ? ` → 相手は${speciesName(s.foeReplace)}を出す` : s.meReplace ? ` → あなたは${speciesName(s.meReplace)}を出す` : '';
		return `${i + 1}ターン目：${speciesName(s.me)}の${act}${eff}／相手の${speciesName(s.foe)}は${foeAct}${rep}`;
	}).join('\n      ');
}

console.log(`ルール：${RULE.label}（${path.basename(PUZZLES)}、${puzzles.length}問）`);
console.log(IDS ? `id ${[...IDS].join(', ')} の点` : `${LENGTH}ターンの問題のうち条件に合う ${results.length} 問の上位 ${Math.min(TOP, results.length)} 問`);
console.log('点の見方：総合＝知名度・タイプ・分かりやすさの重み付きの平均。分かりやすさの中身は「遠回り／ほかに勝てる手／出ないポケモン／技の数／解答の技のうちばつぐんの数／優先度・素早さ同じ」。');
for (const r of results.slice(0, IDS ? results.length : TOP)) {
	const c = r.clarity;
	console.log(`\nid ${r.id}（${r.teams[0]}匹 対 ${r.teams[1]}匹）総合 ${f2(r.total)}｜知名度 ${f2(r.popularity)}｜タイプ ${f2(r.types)}｜分かりやすさ ${f2(c.score)}`
		+ `（遠回り${c.detourMoves}／ほかに勝てる手${c.extraWins}／出ない${c.unusedCount}匹／技${c.moveCount}個／ばつぐん${c.superCount}/${c.moveSteps}${c.priority ? '／優先度の技あり' : ''}${c.speedTie ? '／素早さ同じ組あり' : ''}）`
		+ `｜非短絡手 ${r.metrics.nonGreedy}・手の変化 ${r.metrics.changes}`);
	r.puzzle.state.sides.forEach((side, i) => side.mons.forEach((m, k) => console.log(`    ${i === 0 ? 'あなた' : '相手　'}${k === side.active ? '（場）' : '（控）'} ${describeMon(m)}`)));
	console.log(`    解答：${describeLine(r.line)}`);
}

if (opts['--json']) {
	fs.writeFileSync(opts['--json'], JSON.stringify(results.slice(0, IDS ? results.length : TOP).map(({ puzzle, ...r }) => r), null, 1));
	console.log(`\n${opts['--json']} に書き出した`);
}

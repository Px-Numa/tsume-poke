'use strict';
// 解答の手順と、つまらなさの代理指標を計算する。
//
// 解答の手順：毎ターン、残りターン数以内に勝てる手のうち、相手の場のポケモンに一番大きいダメージを与える技を選ぶ。
// 勝てる技がなければ、勝てる交代のうち legalActions で先に出たものを選ぶ。相手は最長の受けを選ぶ。
// 短絡的な手：先を読まず、相手の場のポケモンに一番大きいダメージを与える技（同じダメージの技が複数あればそのすべて）。
// 非短絡手の数：解答の手順のうち、短絡的な手がどれも残りターン数以内に勝てないターンの数。
// 手の変化：解答の手順で、前のターンと違う手（技の種類、交代先、使うポケモン）を選んだ回数。
// この定義で、ratings_1 の50問からスライド（2026-10-27 ゼミ）の数値（相関 0.71 と 0.54 など）が再現できる。

const E = require('./engine');
const { Solver, bestDefense, bestReplacement } = require('./solver');

const P1_ROLL = 85;

// p1 の場のポケモンの技ごとに、相手の場のポケモンへのダメージを返す。
function moveDamages(state) {
	const me = E.activeMon(state.sides[0]);
	const foe = E.activeMon(state.sides[1]);
	return me.moves.map(m => E.calcDamage(me.species, foe.species, m, P1_ROLL));
}

function actionLabel(state, sideIndex, a) {
	const side = state.sides[sideIndex];
	return a.type === 'move' ? E.activeMon(side).moves[a.index] : '>' + side.mons[a.index].species;
}

// 解答の手順を返す。各ターンは { me, action, foe, foeAction, greedyWins, winCount, foeReplace, meReplace }。
// action と foeAction は技 ID か「>交代先の種族 ID」。
function answerLine(puzzle, solver = new Solver()) {
	let state = puzzle.state;
	const steps = [];
	for (let rem = puzzle.length; rem > 0; rem--) {
		const wins = E.legalActions(state, 0).filter(a => solver.actionWinsWithin(state, a, rem));
		if (wins.length === 0) throw new Error(`id ${puzzle.id}：${rem} ターン以内に勝てる手がない`);
		const dmg = moveDamages(state);
		const winMoves = wins.filter(a => a.type === 'move').sort((x, y) => dmg[y.index] - dmg[x.index]);
		const a1 = winMoves.length ? winMoves[0] : wins[0];
		const max = Math.max(...dmg);
		const greedyWins = wins.some(a => a.type === 'move' && dmg[a.index] === max);
		const def = bestDefense(solver, state, a1, rem);
		const step = {
			me: E.activeMon(state.sides[0]).species,
			action: actionLabel(state, 0, a1),
			foe: E.activeMon(state.sides[1]).species,
			foeAction: actionLabel(state, 1, def.action),
			greedyWins,
			// そのターンに残りターン数以内に勝てる手の数（2以上なら、解答の手のほかにも勝てる手がある）。
			winCount: wins.length,
		};
		steps.push(step);
		if (def.result.winner === 0) break;
		state = def.result.state;
		if (def.result.replace === 1) {
			const i = bestReplacement(solver, state, rem - 1).index;
			step.foeReplace = state.sides[1].mons[i].species;
			state = E.applyReplacement(state, 1, i);
		} else if (def.result.replace === 0) {
			const i = E.replacementChoices(state, 0).find(j => solver.winWithin(E.applyReplacement(state, 0, j), rem - 1));
			step.meReplace = state.sides[0].mons[i].species;
			state = E.applyReplacement(state, 0, i);
		}
	}
	return steps;
}

// 解答の手順から代理指標を計算する。
function proxyMetrics(steps) {
	const nonGreedy = steps.filter(s => !s.greedyWins).length;
	let changes = 0;
	for (let i = 1; i < steps.length; i++) {
		if (steps[i].action !== steps[i - 1].action || steps[i].me !== steps[i - 1].me) changes++;
	}
	return { nonGreedy, changes };
}

// 手順が同じ問題を見分けるキー。両者のポケモンと手をすべて含める。
function lineKey(steps) {
	return steps.map(s => `${s.me}:${s.action}/${s.foe}:${s.foeAction}${s.foeReplace ? '>' + s.foeReplace : ''}${s.meReplace ? '<' + s.meReplace : ''}`).join(' ');
}

module.exports = { answerLine, proxyMetrics, lineKey, moveDamages };

'use strict';
// ソルバ。確定勝ちの判定と、最短ターン数・唯一解の判定をする。
//
// エンジンに乱数がないので、1ターンは「p1 が手を選ぶ（OR）→ p2 が手を選ぶ（AND）」の2段になる。
// p2 は p1 の手を見てから選べるものとして探索する。確率1の勝ちの判定なら、これで結果は変わらない（e2.SolverDescription.md）。
// 倒れたポケモンの代わりを選ぶ場面は、p1 なら OR、p2 なら AND としてそのターンの中で扱う。
//
// 中心は winWithin（n ターン以内に勝てるか）と distance（最短何ターンで勝てるか）の2つ。

const E = require('./engine');

const INF = Infinity;

class Solver {
	constructor() {
		// 置換表。キーは「残りターン数|局面」、値は勝てるかどうか。
		this.memo = new Map();
		this.stats = { turns: 0, hits: 0 };
	}

	// state から n ターン以内に、p2 の手によらず勝てるかを返す（OR ノード）。
	winWithin(state, n) {
		if (n <= 0) return false;
		const key = n + '|' + E.stateKey(state);
		const cached = this.memo.get(key);
		if (cached !== undefined) {
			this.stats.hits++;
			return cached;
		}
		let result = false;
		for (const a1 of E.legalActions(state, 0)) {
			if (this.actionWinsWithin(state, a1, n)) {
				result = true;
				break;
			}
		}
		this.memo.set(key, result);
		return result;
	}

	// p1 が a1 を選んだとき、p2 のどの手に対しても n ターン以内に勝てるかを返す（AND ノード）。
	actionWinsWithin(state, a1, n) {
		for (const a2 of E.legalActions(state, 1)) {
			this.stats.turns++;
			const r = E.resolveTurn(state, [a1, a2]);
			if (!this.outcomeWinsWithin(r, n)) return false;
		}
		return true;
	}

	// 1ターン処理した結果 r が、残り n ターン（このターンを含む）で勝ちになるかを返す。
	outcomeWinsWithin(r, n) {
		if (r.winner !== null) return r.winner === 0;
		if (r.replace === 1) {
			// p2 は p1 に一番都合の悪い交代先を選べる。
			return E.replacementChoices(r.state, 1)
				.every(i => this.winWithin(E.applyReplacement(r.state, 1, i), n - 1));
		}
		if (r.replace === 0) {
			return E.replacementChoices(r.state, 0)
				.some(i => this.winWithin(E.applyReplacement(r.state, 0, i), n - 1));
		}
		return this.winWithin(r.state, n - 1);
	}

	// 勝つまでの最短ターン数を返す。cap ターン以内に勝てなければ Infinity。
	// 上限を1ターンずつ上げて winWithin を呼ぶ（反復深化）。
	distance(state, cap) {
		for (let n = 1; n <= cap; n++) {
			if (this.winWithin(state, n)) return n;
		}
		return INF;
	}

	// p1 が a1 を選んだときの最短ターン数（このターンを含む）を返す。
	actionDistance(state, a1, cap) {
		for (let n = 1; n <= cap; n++) {
			if (this.actionWinsWithin(state, a1, n)) return n;
		}
		return INF;
	}

	// 1ターン処理した結果 r から、決着まであと何ターンかかるかを返す。
	// このターンで勝てば 0、負ければ Infinity。交代先は両者とも最善のものを選ぶ。
	outcomeDistance(r, cap) {
		if (r.winner !== null) return r.winner === 0 ? 0 : INF;
		if (r.replace === 1) {
			return Math.max(...E.replacementChoices(r.state, 1).map(i => this.distance(E.applyReplacement(r.state, 1, i), cap)));
		}
		if (r.replace === 0) {
			return Math.min(...E.replacementChoices(r.state, 0).map(i => this.distance(E.applyReplacement(r.state, 0, i), cap)));
		}
		return this.distance(r.state, cap);
	}

	// 局面を問題として調べた結果を返す。
	// length：最短ターン数、winners：そのターン数で勝てる初手、others：初手ごとの最短ターン数（勝てない手は Infinity）。
	// 初手が唯一解かどうかは winners.length === 1 で分かる。
	analyze(state, cap) {
		const length = this.distance(state, cap);
		const others = E.legalActions(state, 0).map(a1 => ({ action: a1, distance: this.actionDistance(state, a1, cap) }));
		const winners = others.filter(o => o.distance === length).map(o => o.action);
		return { length, winners, others };
	}
}

// p1 の勝ちを一番遅らせる p2 の手を返す（詰将棋の最長の受け）。
// 逃れられる手があればその手。同じ長さなら legalActions で先に出た手にする。
function bestDefense(solver, state, a1, cap) {
	let best = null;
	for (const a2 of E.legalActions(state, 1)) {
		const r = E.resolveTurn(state, [a1, a2]);
		const d = solver.outcomeDistance(r, cap);
		if (best === null || d > best.distance) best = { action: a2, distance: d, result: r };
	}
	return best;
}

// p2 のポケモンが倒れたあと、p1 の勝ちを一番遅らせる交代先を返す。
function bestReplacement(solver, state, cap) {
	let best = null;
	for (const i of E.replacementChoices(state, 1)) {
		const d = solver.distance(E.applyReplacement(state, 1, i), cap);
		if (best === null || d > best.distance) best = { index: i, distance: d };
	}
	return best;
}

module.exports = { Solver, bestDefense, bestReplacement, INF };

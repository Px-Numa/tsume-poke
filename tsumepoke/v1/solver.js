'use strict';
// 詰めポケ Ver1 のソルバ（確定勝ちの判定と、最短ターン数・唯一解の判定）。
//
// Ver1 のエンジンには乱数がないので、1ターンは「p1 が手を選ぶ（OR）→ p2 が手を選ぶ（AND）」の2段だけになる。
// p1 が先に手を決め、p2 はそれを見てから選べるものとして探索している。
// 確率1の勝ちを判定するだけなら、この変形で結果が変わらないことは e2.SolverDescription.md で確かめてある。
// 倒れたポケモンの代わりを選ぶ場面は、p1 なら OR、p2 なら AND として同じターンの中で扱った。
//
// 「n ターン以内に勝てるか」を判定する winWithin と、
// 「最短で何ターンで勝てるか」を求める distance の2つを中心に組み立ててある。

const E = require('./engine');

const INF = Infinity;

class Solver {
	constructor() {
		// 「残りターン数|局面」をキーにして、判定の結果を覚えている。
		this.memo = new Map();
		this.stats = { turns: 0, hits: 0 };
	}

	// p1 が state から n ターン以内に、相手の手によらず勝てるかを返している。
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

	// p1 が a1 を選んだとき、p2 のどの手に対しても n ターン以内に勝てるかを返している。
	actionWinsWithin(state, a1, n) {
		for (const a2 of E.legalActions(state, 1)) {
			this.stats.turns++;
			const r = E.resolveTurn(state, [a1, a2]);
			if (!this.outcomeWinsWithin(r, n)) return false;
		}
		return true;
	}

	// 1ターン処理したあとの結果 r が、残り n ターン（このターンを含む）で勝ちになるかを判定している。
	outcomeWinsWithin(r, n) {
		if (r.winner !== null) return r.winner === 0;
		if (r.replace === 1) {
			// p2 は、p1 にとって一番都合の悪い交代先を選べるものとして扱った。
			return E.replacementChoices(r.state, 1)
				.every(i => this.winWithin(E.applyReplacement(r.state, 1, i), n - 1));
		}
		if (r.replace === 0) {
			return E.replacementChoices(r.state, 0)
				.some(i => this.winWithin(E.applyReplacement(r.state, 0, i), n - 1));
		}
		return this.winWithin(r.state, n - 1);
	}

	// state から p1 が勝つまでの最短ターン数を返している（cap ターン以内に勝てなければ Infinity）。
	distance(state, cap) {
		for (let n = 1; n <= cap; n++) {
			if (this.winWithin(state, n)) return n;
		}
		return INF;
	}

	// p1 が a1 を選んだときの最短ターン数（このターンを含む）を返している。
	actionDistance(state, a1, cap) {
		for (let n = 1; n <= cap; n++) {
			if (this.actionWinsWithin(state, a1, n)) return n;
		}
		return INF;
	}

	// 1ターン処理した結果 r から、決着までにあと何ターンかかるかを返している。
	// このターンで勝てば 0、負ければ Infinity になる。交代先の選び方も含めて最善を尽くした値にしてある。
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

	// 局面を問題として調べた結果をまとめて返している。
	// length は最短ターン数、winners はそのターン数で勝てる初手の一覧、
	// others は初手ごとの最短ターン数（勝てない手は Infinity）になっている。
	// 「初手だけ唯一解」の条件は winners.length === 1 で判定できる。
	analyze(state, cap) {
		const length = this.distance(state, cap);
		const others = E.legalActions(state, 0).map(a1 => ({ action: a1, distance: this.actionDistance(state, a1, cap) }));
		const winners = others.filter(o => o.distance === length).map(o => o.action);
		return { length, winners, others };
	}
}

// p2 の受け方として、p1 の勝ちを一番遅らせる手を選んでいる（詰将棋の「最長の受け」と同じ考え方）。
// 勝ちを逃れられる手があれば、それが選ばれる（distance が Infinity になるため）。
// 同じ長さの手が複数あるときは、legalActions の順で先に出てきた手を選ぶことにした。
function bestDefense(solver, state, a1, cap) {
	let best = null;
	for (const a2 of E.legalActions(state, 1)) {
		const r = E.resolveTurn(state, [a1, a2]);
		const d = solver.outcomeDistance(r, cap);
		if (best === null || d > best.distance) best = { action: a2, distance: d, result: r };
	}
	return best;
}

// p2 のポケモンが倒れたあとの交代先を、p1 の勝ちを一番遅らせるものにしている。
function bestReplacement(solver, state, cap) {
	let best = null;
	for (const i of E.replacementChoices(state, 1)) {
		const d = solver.distance(E.applyReplacement(state, 1, i), cap);
		if (best === null || d > best.distance) best = { index: i, distance: d };
	}
	return best;
}

module.exports = { Solver, bestDefense, bestReplacement, INF };

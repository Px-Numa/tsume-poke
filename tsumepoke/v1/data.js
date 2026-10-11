'use strict';
// 詰めポケ Ver1 のデータ層。
//
// PS（pokemon-showdown/）からは図鑑・技・タイプ相性のデータだけを借りている。
// 対戦エンジンそのものは engine.js に自作したので、PS の Battle は使っていない。
// ポケモンと技の候補は、PS のランダムバトル用の型（data/random-battles/gen9/sets.json）から取ることにした。
// 実際の対戦で使われる組み合わせに近づけたかったので、このような選び方にしてある。

const path = require('path');
const { Dex } = require(path.join(__dirname, '..', '..', 'pokemon-showdown'));

const dex = Dex.forGen(9);

// Ver1 の固定値として、レベル50、個体値31、努力値0、性格補正なしを全員に使っている。
// 後の版で変えられるように、ここにまとめて置くことにした。
const LEVEL = 50;
const IV = 31;
const EV = 0;

// 技の対象として、相手1体に当たるものだけを残している。
// シングルバトルでは allAdjacent（例：じしん）や allAdjacentFoes（例：いわなだれ）も相手1体に当たるので含めた。
const SINGLE_TARGETS = new Set(['normal', 'any', 'allAdjacent', 'allAdjacentFoes']);

// Ver1 で使えない技を見分けるための判定で、使えない理由を文字列で返している（使えるなら null）。
// 威力が毎回同じで、当てたあとに確実に起こる効果を持たない技だけを残す方針にしてある。
// 例えば 10まんボルト（10% でまひ）は、追加効果を「起こらない」とみなして残る。
// インファイト（確実に自分の防御が下がる）や とんぼがえり（確実に交代する）は除かれる。
function rejectReason(move) {
	if (!move.exists || move.isNonstandard) return 'nonstandard';
	if (move.category === 'Status') return 'status';
	if (!(move.basePower > 0)) return 'no-basepower';
	if (!SINGLE_TARGETS.has(move.target)) return 'target';
	if (move.isZ || move.isMax) return 'z-max';
	if (move.multihit) return 'multihit';
	if (move.recoil || move.drain || move.mindBlownRecoil || move.chloroblastRecoil || move.hasCrashDamage || move.selfdestruct) {
		return 'hp-change';
	}
	if (move.ignoreImmunity || move.forceSTAB) return 'special-typing';
	if (move.ohko || move.damage) return 'fixed-damage';
	if (move.selfSwitch || move.forceSwitch) return 'switch';
	if (move.self || move.selfBoost) return 'self-effect';
	if (move.willCrit) return 'always-crit';
	if (move.flags && (move.flags.charge || move.flags.recharge || move.flags.futuremove)) return 'two-turn';
	if (move.overrideOffensivePokemon || move.overrideOffensiveStat) return 'override-attack';
	if (move.heal || move.boosts || move.volatileStatus || move.sideCondition || move.weather || move.terrain || move.pseudoWeather) {
		return 'other-effect';
	}
	// 「確実に起こる追加効果」は Ver1 では表現できないので、確率 100% の追加効果を持つ技は除いている。
	const secondaries = move.secondaries || (move.secondary ? [move.secondary] : []);
	for (const s of secondaries) {
		if (s.chance === undefined || s.chance >= 100) return 'certain-secondary';
	}
	// 威力や相性が状況で変わる技（例：はたきおとす、フリーズドライ）は、PS では関数として書かれている。
	// 関数を1つでも持つ技は、Ver1 の単純な計算では再現できないので除くことにした。
	for (const key of Object.keys(move)) {
		if (typeof move[key] === 'function') return 'callback:' + key;
	}
	return null;
}

// Ver1 で使える技の一覧を、技 ID から技データへの Map として作っている。
function buildMovePool() {
	const pool = new Map();
	for (const move of dex.moves.all()) {
		if (rejectReason(move) === null) pool.set(move.id, move);
	}
	return pool;
}

// ランダムバトルの型から、ポケモンごとに Ver1 で使える技の候補を集めている。
// 使える技が minMoves 個に満たないポケモンは、問題に出しても選択肢が少なすぎるので外した。
function buildSpeciesPool(movePool, minMoves = 2) {
	const sets = require(path.join(__dirname, '..', '..', 'pokemon-showdown', 'data', 'random-battles', 'gen9', 'sets.json'));
	const pool = [];
	for (const [speciesId, entry] of Object.entries(sets)) {
		const species = dex.species.get(speciesId);
		if (!species.exists || species.isNonstandard) continue;
		const moves = new Set();
		for (const set of entry.sets) {
			for (const name of set.movepool) {
				const id = dex.moves.get(name).id;
				if (movePool.has(id)) moves.add(id);
			}
		}
		if (moves.size >= minMoves) pool.push({ id: species.id, moves: [...moves].sort() });
	}
	return pool;
}

// PS の Battle.statModify と同じ式で能力値を計算している（性格補正なしの場合）。
function calcStats(baseStats) {
	const tr = Math.trunc;
	const stats = {};
	for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
		const base = baseStats[stat];
		if (stat === 'hp') {
			stats.hp = tr(tr(2 * base + IV + tr(EV / 4) + 100) * LEVEL / 100 + 10);
		} else {
			stats[stat] = tr(tr(2 * base + IV + tr(EV / 4)) * LEVEL / 100 + 5);
		}
	}
	return stats;
}

module.exports = { dex, LEVEL, IV, EV, rejectReason, buildMovePool, buildSpeciesPool, calcStats };

// 直接実行したときは、技とポケモンの候補の数と、除いた理由の内訳を表示するようにした。
if (require.main === module) {
	const reasons = new Map();
	for (const move of dex.moves.all()) {
		const r = rejectReason(move);
		const k = r === null ? 'OK' : r.split(':')[0];
		reasons.set(k, (reasons.get(k) || 0) + 1);
	}
	console.log('技の判定の内訳:', Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])));
	const movePool = buildMovePool();
	const speciesPool = buildSpeciesPool(movePool);
	console.log(`使える技 ${movePool.size} 個、使えるポケモン ${speciesPool.length} 匹`);
	console.log('技の例:', [...movePool.values()].slice(0, 40).map(m => m.name).join(', '));
	const cb = new Map();
	for (const move of dex.moves.all()) {
		const r = rejectReason(move);
		if (r && r.startsWith('callback:')) cb.set(r, (cb.get(r) || 0) + 1);
	}
	console.log('関数で除いた技の内訳:', Object.fromEntries(cb));
}

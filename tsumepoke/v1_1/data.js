'use strict';
// データまわり。
//
// PS（pokemon-showdown/）からは図鑑・技・タイプ相性のデータだけを使う。対戦の処理は engine.js にあり、PS の Battle は使わない。
// ポケモンごとの技の候補は、実戦に近い組み合わせにするため、ランダムバトル用の型（data/random-battles/gen9/sets.json）から取る。

const path = require('path');
const { Dex } = require(path.join(__dirname, '..', '..', 'pokemon-showdown'));

const dex = Dex.forGen(9);

// 全員レベル50、個体値31、努力値0、性格補正なし。
const LEVEL = 50;
const IV = 31;
const EV = 0;

// 相手1体に当たる技の対象。シングルでは allAdjacent（じしんなど）や allAdjacentFoes（いわなだれなど）も相手1体に当たる。
const SINGLE_TARGETS = new Set(['normal', 'any', 'allAdjacent', 'allAdjacentFoes']);

// 使えない技なら理由の文字列を、使えるなら null を返す。
// 残すのは、威力が毎回同じで、当てたあとに確実に起こる効果を持たない技。
// 10まんボルト（10% でまひ）は追加効果が起こらないものとして残る。
// インファイト（確実に防御が下がる）や とんぼがえり（確実に交代する）は除く。
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
	// 確率 100% の追加効果は表現できないので除く。
	const secondaries = move.secondaries || (move.secondary ? [move.secondary] : []);
	for (const s of secondaries) {
		if (s.chance === undefined || s.chance >= 100) return 'certain-secondary';
	}
	// 威力や相性が状況で変わる技（はたきおとす、フリーズドライなど）は PS では関数で書かれている。
	// 関数を1つでも持つ技は再現できないので除く。
	for (const key of Object.keys(move)) {
		if (typeof move[key] === 'function') return 'callback:' + key;
	}
	return null;
}

// 使える技の Map（技 ID → 技データ）を返す。PS の第9世代の技全体が対象。
function buildMovePool() {
	const pool = new Map();
	for (const move of dex.moves.all()) {
		if (rejectReason(move) === null) pool.set(move.id, move);
	}
	return pool;
}

// ランダムバトルの型から、ポケモンごとに使える技の候補を集める。
// 使える技が minMoves 個に満たないポケモンは選択肢が少なすぎるので外す。
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

// 能力値を計算する。式は PS の Battle.statModify と同じ（性格補正なし）。
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

// 直接実行すると、技とポケモンの候補の数と、除いた理由の内訳を表示する。
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

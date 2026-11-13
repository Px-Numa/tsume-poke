'use strict';
// 対戦エンジン。PS を参考にした簡略版で、乱数は使わない。
//
// 命中は常に100%、急所なし、確率で起こる追加効果は起こらないものとする。
// ダメージ乱数は p1（回答者）の技を最低値の 85、p2（相手）の技を最高値の 100 に固定する。
// 素早さが同じなら p2 が先に動く。どちらも p1 に不利な側に寄せている。
// 特性・持ち物・状態異常・能力ランク・テラスタルは扱わない。
//
// 局面は JSON にそのまま書けるオブジェクトで持つ。
//   { sides: [ { active: 0, mons: [ { species: 'garchomp', moves: ['earthquake', ...], hp: 120 } ] }, {...} ] }
// sides[0] が p1、sides[1] が p2。
// 倒れたポケモンは hp 0 のまま mons に残し、交代先の候補から外す。

const { dex, LEVEL, calcStats } = require('./data');

const P1_ROLL = 85;
const P2_ROLL = 100;

// 種族ごとの能力値とタイプは何度も使うのでキャッシュしておく。
const speciesCache = new Map();
function speciesInfo(id) {
	let info = speciesCache.get(id);
	if (!info) {
		const species = dex.species.get(id);
		if (!species.exists) throw new Error(`unknown species: ${id}`);
		info = { name: species.name, types: species.types, stats: calcStats(species.baseStats) };
		speciesCache.set(id, info);
	}
	return info;
}

const moveCache = new Map();
function moveInfo(id) {
	let move = moveCache.get(id);
	if (!move) {
		move = dex.moves.get(id);
		if (!move.exists) throw new Error(`unknown move: ${id}`);
		moveCache.set(id, move);
	}
	return move;
}

// value に倍率を掛ける。丸め方は PS の Battle.modify と同じ（4096 分率の整数計算）。
function psModify(value, multiplier) {
	const tr = Math.trunc;
	const modifier = tr(multiplier * 4096);
	return tr((tr(value * modifier) + 2048 - 1) / 4096);
}

// attacker が defender に moveId の技を当てたときのダメージを返す。roll はダメージ乱数（85〜100）。
// 計算の順番は PS の getDamage と modifyDamage（sim/battle-actions.ts）に合わせている。
function calcDamage(attackerSpecies, defenderSpecies, moveId, roll) {
	const tr = Math.trunc;
	const move = moveInfo(moveId);
	const atk = speciesInfo(attackerSpecies);
	const def = speciesInfo(defenderSpecies);

	// タイプで無効（じめん技をひこうタイプに当てた場合など）なら 0。
	if (!dex.getImmunity(move.type, def.types)) return 0;

	const physical = move.category === 'Physical';
	const attack = physical ? atk.stats.atk : atk.stats.spa;
	// サイコショックのように特殊技でも防御で受ける技は overrideDefensiveStat を持つ。
	const defenseStat = move.overrideDefensiveStat || (physical ? 'def' : 'spd');
	const defense = def.stats[defenseStat];

	let damage = tr(tr(tr(tr(2 * LEVEL / 5 + 2) * move.basePower * attack) / defense) / 50);
	damage += 2;
	damage = tr(tr(damage * roll) / 100);
	if (atk.types.includes(move.type)) damage = psModify(damage, 1.5);
	const typeMod = Math.max(-6, Math.min(6, dex.getEffectiveness(move.type, def.types)));
	for (let i = 0; i < typeMod; i++) damage *= 2;
	for (let i = 0; i > typeMod; i--) damage = tr(damage / 2);
	if (!damage) return 1;
	return damage;
}

function rollFor(sideIndex) {
	return sideIndex === 0 ? P1_ROLL : P2_ROLL;
}

function activeMon(side) {
	return side.mons[side.active];
}

function aliveCount(side) {
	return side.mons.filter(m => m.hp > 0).length;
}

// 局面を深くコピーする。局面は小さいので JSON 経由でも十分速い。
function cloneState(state) {
	return JSON.parse(JSON.stringify(state));
}

// 置換表のキーにする文字列を返す。
// 技の並びは1つの問題の中で変わらないので、場のポケモンと種族と HP だけを入れる。
function stateKey(state) {
	return state.sides.map(s => s.active + ':' + s.mons.map(m => m.species + '=' + m.hp).join(',')).join('|');
}

// ターンの最初に選べる行動の一覧を返す。
// 技は { type: 'move', index }、交代は { type: 'switch', index }（index は mons の中の位置）。
function legalActions(state, sideIndex) {
	const side = state.sides[sideIndex];
	const actions = [];
	const mon = activeMon(side);
	mon.moves.forEach((_, i) => actions.push({ type: 'move', index: i }));
	side.mons.forEach((m, i) => {
		if (i !== side.active && m.hp > 0) actions.push({ type: 'switch', index: i });
	});
	return actions;
}

// 倒れたあとに場に出せるポケモンの位置の一覧を返す。
function replacementChoices(state, sideIndex) {
	const side = state.sides[sideIndex];
	const choices = [];
	side.mons.forEach((m, i) => { if (m.hp > 0) choices.push(i); });
	return choices;
}

// 1ターン分を処理する。元の state は書き換えず、新しい局面を返す。
// 戻り値は { state, winner, replace, log }。
//   winner: 勝った側の番号（0 か 1）。決着していなければ null
//   replace: 倒れたポケモンの代わりを選ぶ側の番号。なければ null
//   log: 表示用の出来事の列
// 反動や天候のダメージがないので、1ターンに倒れるのは多くても1体（倒された側の技は出ない）。
function resolveTurn(state, actions) {
	const next = cloneState(state);
	const log = [];

	// 交代は技より先。特性や持ち物がないので、両者の交代の順番で結果は変わらない。
	for (const s of [0, 1]) {
		const a = actions[s];
		if (a.type === 'switch') {
			const side = next.sides[s];
			log.push({ kind: 'switch', side: s, from: activeMon(side).species, to: side.mons[a.index].species });
			side.active = a.index;
		}
	}

	// 技の順番は優先度、素早さの順。素早さも同じなら p2 が先。
	const movers = [0, 1].filter(s => actions[s].type === 'move');
	const priorityOf = s => moveInfo(activeMon(next.sides[s]).moves[actions[s].index]).priority;
	const speedOf = s => speciesInfo(activeMon(next.sides[s]).species).stats.spe;
	movers.sort((x, y) => (priorityOf(y) - priorityOf(x)) || (speedOf(y) - speedOf(x)) || (y - x));

	let replace = null;
	let winner = null;
	for (const s of movers) {
		const attacker = activeMon(next.sides[s]);
		if (attacker.hp <= 0) continue;
		const foe = 1 - s;
		const defender = activeMon(next.sides[foe]);
		const moveId = attacker.moves[actions[s].index];
		const damage = Math.min(defender.hp, calcDamage(attacker.species, defender.species, moveId, rollFor(s)));
		defender.hp -= damage;
		log.push({ kind: 'move', side: s, user: attacker.species, move: moveId, target: defender.species, damage, hpLeft: defender.hp });
		if (defender.hp <= 0) {
			log.push({ kind: 'faint', side: foe, mon: defender.species });
			if (aliveCount(next.sides[foe]) === 0) {
				winner = s;
			} else {
				replace = foe;
			}
			break;
		}
	}
	return { state: next, winner, replace, log };
}

// 倒れたポケモンの代わりを場に出した局面を返す。
function applyReplacement(state, sideIndex, monIndex) {
	const next = cloneState(state);
	next.sides[sideIndex].active = monIndex;
	return next;
}

module.exports = {
	P1_ROLL, P2_ROLL, speciesInfo, moveInfo, calcDamage, rollFor, activeMon, aliveCount, cloneState, stateKey,
	legalActions, replacementChoices, resolveTurn, applyReplacement,
};

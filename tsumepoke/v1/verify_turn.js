'use strict';
// engine.js の1ターン分の処理（行動の順番、ダメージ、倒れたときの処理、交代）が、
// PS で同じターンを動かした結果と一致するかを調べる。
// 実行方法：node tsumepoke/v1/verify_turn.js [局面の数] [乱数の種]
//
// PS 側の乱数の関数をエンジンに合わせて差し替える。
//   randomizer：技を出した側が p1 なら乱数 85、p2 なら 100
//   randomChance：命中の判定（確率 25% 以上）は必ず当たり、急所の判定（1/24 など）は必ず外れ
//   random：追加効果の判定（random(100) < 確率）が必ず外れるように、取りうる最大の値を返す
// 優先度も素早さも同じ組み合わせは、PS では順番が乱数で決まるので比べない。

const path = require('path');
const { Battle } = require(path.join(__dirname, '..', '..', 'pokemon-showdown'));
const { LEVEL, IV, EV, buildMovePool, buildSpeciesPool } = require('./data');
const E = require('./engine');

const N = Number(process.argv[2] || 2000);
let seed = Number(process.argv[3] || 7) >>> 0;
function rand(n) {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed % n;
}

const movePool = buildMovePool();
const speciesPool = buildSpeciesPool(movePool);

function randomMon() {
	const sp = speciesPool[rand(speciesPool.length)];
	const moves = [];
	while (moves.length < Math.min(4, sp.moves.length)) {
		const m = sp.moves[rand(sp.moves.length)];
		if (!moves.includes(m)) moves.push(m);
	}
	const maxhp = E.speciesInfo(sp.id).stats.hp;
	return { species: sp.id, moves, hp: 1 + rand(maxhp) };
}

function toPsSet(mon, name) {
	const stat = v => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });
	return {
		name, species: mon.species, ability: 'No Ability', item: '', nature: 'Hardy',
		level: LEVEL, ivs: stat(IV), evs: stat(EV), moves: mon.moves, gender: 'M',
	};
}

function choiceString(a) {
	return a.type === 'move' ? `move ${a.index + 1}` : `switch ${a.index + 1}`;
}

let compared = 0;
let skipped = 0;
let mismatches = 0;
for (let t = 0; t < N; t++) {
	const state = { sides: [0, 1].map(() => ({ active: 0, mons: Array.from({ length: 1 + rand(3) }, randomMon) })) };
	const acts = [0, 1].map(s => {
		const list = E.legalActions(state, s);
		return list[rand(list.length)];
	});

	// 両者が技を出し、優先度も素早さも同じならスキップ。
	if (acts[0].type === 'move' && acts[1].type === 'move') {
		const pri = s => E.moveInfo(state.sides[s].mons[0].moves[acts[s].index]).priority;
		const spe = s => E.speciesInfo(state.sides[s].mons[0].species).stats.spe;
		if (pri(0) === pri(1) && spe(0) === spe(1)) {
			skipped++;
			continue;
		}
	}

	const battle = new Battle({ formatid: 'gen9customgame', seed: [1, 2, 3, 4] });
	battle.setPlayer('p1', { name: 'A', team: state.sides[0].mons.map((m, i) => toPsSet(m, 'a' + i)) });
	battle.setPlayer('p2', { name: 'B', team: state.sides[1].mons.map((m, i) => toPsSet(m, 'b' + i)) });
	battle.makeChoices('default', 'default');
	for (const s of [0, 1]) {
		state.sides[s].mons.forEach((m, i) => battle.sides[s].pokemon[i].sethp(m.hp));
	}
	battle.randomizer = base => {
		const roll = battle.activePokemon && battle.activePokemon.side.n === 0 ? 85 : 100;
		return Math.trunc(Math.trunc(base * roll) / 100);
	};
	battle.randomChance = (num, den) => num / den >= 0.25;
	battle.random = (m, n) => (n === undefined ? (m === undefined ? 0.999 : m - 1) : n - 1);

	battle.makeChoices(choiceString(acts[0]), choiceString(acts[1]));
	const mine = E.resolveTurn(state, acts);

	// 全員の残り HP、場のポケモン、勝敗を比べる。
	const psHp = [0, 1].map(s => state.sides[s].mons.map((_, i) => battle.sides[s].pokemon.find(p => p.name === (s ? 'b' : 'a') + i).hp));
	const myHp = [0, 1].map(s => mine.state.sides[s].mons.map(m => m.hp));
	const psActive = [0, 1].map(s => Number(battle.sides[s].active[0].name.slice(1)));
	const myActive = [0, 1].map(s => mine.state.sides[s].active);
	const psWinner = battle.ended ? (battle.winner === 'A' ? 0 : 1) : null;
	const same = JSON.stringify([psHp, psActive, psWinner]) === JSON.stringify([myHp, myActive, mine.winner]);
	compared++;
	if (!same) {
		mismatches++;
		if (mismatches <= 10) {
			console.log('不一致', JSON.stringify({ state, acts, psHp, myHp, psActive, myActive, psWinner, myWinner: mine.winner }));
			console.log(battle.log.slice(-15).join('\n'));
		}
	}
}
console.log(`${compared} 局面を比べて不一致 ${mismatches} 件（優先度と素早さが同じで比べなかった局面 ${skipped} 件）`);

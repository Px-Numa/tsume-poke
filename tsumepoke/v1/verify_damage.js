'use strict';
// engine.js のダメージ計算が PS の getDamage と一致するかを調べる。
// 実行方法：node tsumepoke/v1/verify_damage.js [組み合わせの数]
//
// PS の Battle を作り、ダメージ乱数を 85 か 100 に固定、急所なしにして getDamage を呼ぶ。
// 条件をエンジンに合わせるため、特性は 'No Ability'、持ち物なし、性格は Hardy（補正なし）にする。

const path = require('path');
const { Battle } = require(path.join(__dirname, '..', '..', 'pokemon-showdown'));
const { LEVEL, IV, EV, buildMovePool, buildSpeciesPool } = require('./data');
const { calcDamage } = require('./engine');

const N = Number(process.argv[2] || 3000);
const movePool = buildMovePool();
const speciesPool = buildSpeciesPool(movePool);

// 再現できるように seed つきの線形合同法を使う。
let seed = Number(process.argv[3] || 12345);
function rand(n) {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed % n;
}

function makeSet(speciesId, moves) {
	const stat = v => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });
	return {
		name: speciesId, species: speciesId, ability: 'No Ability', item: '', nature: 'Hardy',
		level: LEVEL, ivs: stat(IV), evs: stat(EV), moves, gender: 'M',
	};
}

let mismatches = 0;
let immune = 0;
for (let i = 0; i < N; i++) {
	const a = speciesPool[rand(speciesPool.length)];
	const d = speciesPool[rand(speciesPool.length)];
	const moveId = a.moves[rand(a.moves.length)];
	const roll = rand(2) === 0 ? 85 : 100;

	const battle = new Battle({ formatid: 'gen9customgame', seed: [1, 2, 3, 4] });
	battle.setPlayer('p1', { name: 'A', team: [makeSet(a.id, [moveId])] });
	battle.setPlayer('p2', { name: 'B', team: [makeSet(d.id, ['tackle'])] });
	battle.makeChoices('team 1', 'team 1');
	// 乱数を固定し、急所の判定（randomChance）は常に外れにする。
	battle.randomizer = base => Math.trunc(Math.trunc(base * roll) / 100);
	battle.randomChance = () => false;
	const source = battle.p1.active[0];
	const target = battle.p2.active[0];
	const psDamage = battle.actions.getDamage(source, target, moveId, true);
	const ps = (psDamage === false || psDamage === undefined || psDamage === null) ? 0 : psDamage;
	const mine = calcDamage(a.id, d.id, moveId, roll);
	if (ps === 0) immune++;
	if (ps !== mine) {
		mismatches++;
		if (mismatches <= 20) console.log(`不一致: ${a.id} の ${moveId} → ${d.id}（乱数 ${roll}）PS=${psDamage} 自作=${mine}`);
	}
}
console.log(`${N} 通りを比べて、不一致は ${mismatches} 件（そのうち PS で 0 ダメージだったものは ${immune} 件）`);

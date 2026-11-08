'use strict';
// GUI と詰めポケ Ver1 のエンジン・ソルバをつなぐアダプタ。
//
// GUI はこのファイルが返す形（view、events、features）だけを見て表示する。
// エンジンを差し替えるときは、同じ関数を持つ別のアダプタ（adapters/v2.js など）を作る。
//
// 返す形：
//   view：{ phase, remaining, sides: [{ active, mons: [monView] }], field, choices }
//     phase は 'choose'（手を選ぶ）、'replace'（倒れたあとの交代先を選ぶ）、'won'、'failed'
//     monView はエンジンが扱わない要素（status、ability、item、boosts）も null や {} で持つ
//   events：[{ kind, side, text, hp: { side, index, hp } | null }]
//     text は表示用の文。GUI は kind を知らなくても text だけで表示できる

const path = require('path');
const fs = require('fs');
const V1 = path.join(__dirname, '..', '..', 'v1');
const E = require(path.join(V1, 'engine'));
const { Solver, bestDefense, bestReplacement } = require(path.join(V1, 'solver'));
const { dex, LEVEL, IV, EV } = require(path.join(V1, 'data'));

const NAMES_JA = path.join(V1, 'names_ja.json');
const ja = fs.existsSync(NAMES_JA) ? JSON.parse(fs.readFileSync(NAMES_JA, 'utf8')) : { species: {}, moves: {}, types: {} };
const speciesName = id => ja.species[id] || E.speciesInfo(id).name;
const moveName = id => ja.moves[id] || E.moveInfo(id).name;
const typeName = t => ja.types[t] || t;

const id = 'v1';
const label = '詰めポケ Ver1（乱数なしの簡略モデル）';

// このエンジンが扱う要素。GUI は false の要素の表示と設定を出さない（設定画面では灰色にする）。
const features = {
	abilities: false,
	items: false,
	status: false,
	boosts: false,
	weather: false,
	terrain: false,
	terastal: false,
	accuracy: false,
	criticalHits: false,
	secondaryEffects: false,
	damageRolls: 'fixed',
	opponentPolicies: ['longest'],
};

function rules() {
	return [
		{ title: '問題の目的', body: '決められたターン数以内に、相手がどう動いても確実に勝てる手順を見つけます。正解の最初の一手は1つだけです。' },
		{ title: '相手の動き', body: '相手は、あなたの勝ちを一番遅らせる手を選びます。逃れられる手があれば、その手を選びます。相手のポケモンが倒れたときの交代先も、あなたに一番不利なものを選びます。' },
		{ title: 'ダメージ', body: `ダメージ乱数は固定です。あなたの技は最低乱数（${E.P1_ROLL}）、相手の技は最高乱数（${E.P2_ROLL}）で計算します。技は必ず当たり、急所には当たりません。10%のまひのような、確率で起こる追加効果は起こりません。` },
		{ title: 'ポケモン', body: `全員レベル${LEVEL}、個体値${IV}、努力値${EV}、性格の補正なしです。特性・持ち物・状態異常・能力ランクの変化・テラスタルはありません。` },
		{ title: '行動の順番', body: '交代は技より先に行われます。技は優先度の高い順、同じなら素早さの高い順に出ます。優先度も素早さも同じときは、相手が先に動きます。' },
		{ title: '失敗', body: '選んだ手のせいで、残りのターン数以内に確実に勝てなくなった時点で失敗になります。遅れて勝てる手を選んでも失敗です。' },
	];
}

// 18 タイプの相性表。chart[攻撃側][防御側] が倍率。
function typeChart() {
	// ステラはテラスタル専用のタイプなので表に入れない。
	const order = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
	const types = dex.types.all().filter(t => t.exists && !t.isNonstandard && t.name !== 'Stellar').map(t => t.name)
		.sort((a, b) => order.indexOf(a) - order.indexOf(b));
	const chart = {};
	for (const atk of types) {
		chart[atk] = {};
		for (const def of types) {
			chart[atk][def] = !dex.getImmunity(atk, [def]) ? 0 : 2 ** dex.getEffectiveness(atk, [def]);
		}
	}
	return { types, names: Object.fromEntries(types.map(t => [t, typeName(t)])), chart };
}

function moveView(moveId) {
	const m = E.moveInfo(moveId);
	return {
		id: moveId,
		name: moveName(moveId),
		type: m.type,
		typeName: typeName(m.type),
		category: m.category === 'Physical' ? '物理' : '特殊',
		power: m.basePower,
		priority: m.priority,
		accuracy: m.accuracy === true ? null : m.accuracy,
		pp: null,
		description: m.shortDesc || '',
	};
}

function monView(mon, sideIndex, monIndex) {
	const info = E.speciesInfo(mon.species);
	return {
		index: monIndex,
		side: sideIndex,
		species: mon.species,
		name: speciesName(mon.species),
		types: info.types.map(t => ({ type: t, name: typeName(t) })),
		hp: mon.hp,
		maxhp: info.stats.hp,
		stats: info.stats,
		level: LEVEL,
		moves: mon.moves.map(moveView),
		status: null,
		ability: null,
		item: null,
		boosts: {},
	};
}

// 攻撃側 a（sideIndex 側の monIndex）の技ごとに、相手側のすべてのポケモンへのダメージを返す。
function damageRow(state, sideIndex, monIndex) {
	const mon = state.sides[sideIndex].mons[monIndex];
	const foes = state.sides[1 - sideIndex].mons;
	return mon.moves.map(moveId => foes.map(f => {
		const maxhp = E.speciesInfo(f.species).stats.hp;
		const damage = E.calcDamage(mon.species, f.species, moveId, E.rollFor(sideIndex));
		return { damage, percent: 100 * damage / maxhp, ko: f.hp > 0 && damage >= f.hp };
	}));
}

// 両者の全ポケモン・全技から、相手の全ポケモンへのダメージの表を返す。
function damageTable(state) {
	return [0, 1].map(s => state.sides[s].mons.map((m, i) => ({ mon: i, rows: damageRow(state, s, i) })));
}

function actionLabel(state, sideIndex, a) {
	const side = state.sides[sideIndex];
	if (a.type === 'move') return moveName(E.activeMon(side).moves[a.index]);
	return `交代 → ${speciesName(side.mons[a.index].species)}`;
}

function eventsFromLog(log, state) {
	const who = s => (s === 0 ? 'あなた' : '相手');
	const indexOf = (s, species) => state.sides[s].mons.findIndex(m => m.species === species);
	return log.map(ev => {
		if (ev.kind === 'switch') {
			return { kind: 'switch', side: ev.side, text: `${who(ev.side)}は ${speciesName(ev.from)} を引っ込めて ${speciesName(ev.to)} を出した`, active: { side: ev.side, index: indexOf(ev.side, ev.to) }, hp: null };
		}
		if (ev.kind === 'move') {
			const foe = 1 - ev.side;
			return {
				kind: 'move', side: ev.side,
				text: `${who(ev.side)}の ${speciesName(ev.user)} の ${moveName(ev.move)}！ ${speciesName(ev.target)} に ${ev.damage} ダメージ`,
				hp: { side: foe, index: indexOf(foe, ev.target), hp: ev.hpLeft },
			};
		}
		if (ev.kind === 'faint') return { kind: 'faint', side: ev.side, text: `${who(ev.side)}の ${speciesName(ev.mon)} は倒れた`, hp: null };
		return { kind: ev.kind, side: ev.side, text: JSON.stringify(ev), hp: null };
	});
}

// 1問ぶんの対戦。1回の挑戦ごとに作り直す。
class Game {
	constructor(puzzle) {
		this.puzzle = puzzle;
		this.solver = new Solver();
		this.state = E.cloneState(puzzle.state);
		this.remaining = puzzle.length;
		this.turn = 1;
		this.phase = 'choose';
		this.failReason = null;
		this.steps = [];
	}

	choices() {
		if (this.phase === 'choose') {
			return E.legalActions(this.state, 0).map(a => ({ ...a, label: actionLabel(this.state, 0, a) }));
		}
		if (this.phase === 'replace') {
			return E.replacementChoices(this.state, 0).map(i => ({ type: 'replace', index: i, label: speciesName(this.state.sides[0].mons[i].species) }));
		}
		return [];
	}

	view() {
		return {
			phase: this.phase,
			turn: this.turn,
			remaining: this.remaining,
			length: this.puzzle.length,
			failReason: this.failReason,
			sides: this.state.sides.map((side, s) => ({
				active: side.active,
				mons: side.mons.map((m, i) => monView(m, s, i)),
				damageToFoeActive: side.mons.map((m, i) => damageRow(this.state, s, i).map(row => row[this.state.sides[1 - s].active])),
			})),
			field: { weather: null, terrain: null },
			choices: this.choices(),
		};
	}

	// choice は choices() の要素の { type, index }。戻り値は { events, view }。
	act(choice) {
		if (this.phase === 'replace') return this.replace(choice);
		if (this.phase !== 'choose') throw new Error('手を選べる場面ではない');
		const a1 = E.legalActions(this.state, 0).find(a => a.type === choice.type && a.index === choice.index);
		if (!a1) throw new Error('選べない手');
		const def = bestDefense(this.solver, this.state, a1, this.remaining);
		const events = [{ kind: 'turn', side: null, text: `${this.turn}ターン目：あなた「${actionLabel(this.state, 0, a1)}」／相手「${actionLabel(this.state, 1, def.action)}」`, hp: null }];
		events.push(...eventsFromLog(def.result.log, this.state));
		this.steps.push({ turn: this.turn, p1: a1, p2: def.action, p1Label: actionLabel(this.state, 0, a1), p2Label: actionLabel(this.state, 1, def.action) });
		this.state = def.result.state;
		if (def.result.winner === 0) {
			this.phase = 'won';
			events.push({ kind: 'result', side: null, text: 'あなたの勝ち！', hp: null });
			return { events, view: this.view() };
		}
		if (def.result.winner === 1 || def.distance > this.remaining - 1) {
			this.phase = 'failed';
			this.failReason = def.result.winner === 1 ? 'あなたのポケモンがすべて倒れた' : `この手では、残り ${this.remaining - 1} ターン以内に確実に勝つことができなくなった`;
			events.push({ kind: 'result', side: null, text: this.failReason, hp: null });
			return { events, view: this.view() };
		}
		this.remaining--;
		this.turn++;
		if (def.result.replace === 1) {
			const rep = bestReplacement(this.solver, this.state, this.remaining);
			this.state = E.applyReplacement(this.state, 1, rep.index);
			events.push({ kind: 'replace', side: 1, text: `相手は ${speciesName(this.state.sides[1].mons[rep.index].species)} を出した`, active: { side: 1, index: rep.index }, hp: null });
			this.steps[this.steps.length - 1].p2Replace = rep.index;
		} else if (def.result.replace === 0) {
			this.phase = 'replace';
		}
		return { events, view: this.view() };
	}

	replace(choice) {
		if (!E.replacementChoices(this.state, 0).includes(choice.index)) throw new Error('出せないポケモン');
		this.state = E.applyReplacement(this.state, 0, choice.index);
		this.steps[this.steps.length - 1].p1Replace = choice.index;
		const events = [{ kind: 'replace', side: 0, text: `あなたは ${speciesName(this.state.sides[0].mons[choice.index].species)} を出した`, active: { side: 0, index: choice.index }, hp: null }];
		if (!this.solver.winWithin(this.state, this.remaining)) {
			this.phase = 'failed';
			this.failReason = `このポケモンでは、残り ${this.remaining} ターン以内に確実に勝つことができなくなった`;
			events.push({ kind: 'result', side: null, text: this.failReason, hp: null });
		} else {
			this.phase = 'choose';
		}
		return { events, view: this.view() };
	}
}

// 解答の手順（相手は最長の受け）と、正解以外の初手への受けを返す。play.js の showAnswer・showRefutations と同じ手順で作る。
function answer(puzzle) {
	const solver = new Solver();
	const steps = [];
	let state = puzzle.state;
	let remaining = puzzle.length;
	for (let turn = 1; remaining > 0; turn++, remaining--) {
		const a1 = E.legalActions(state, 0).find(a => solver.actionWinsWithin(state, a, remaining));
		const def = bestDefense(solver, state, a1, remaining);
		const step = { turn, p1: actionLabel(state, 0, a1), p2: actionLabel(state, 1, def.action), events: eventsFromLog(def.result.log, state).map(e => e.text), after: null, p1Action: a1 };
		steps.push(step);
		if (def.result.winner === 0) break;
		state = def.result.state;
		if (def.result.replace === 1) {
			const rep = bestReplacement(solver, state, remaining - 1);
			step.after = `相手は ${speciesName(state.sides[1].mons[rep.index].species)} を出した`;
			state = E.applyReplacement(state, 1, rep.index);
		} else if (def.result.replace === 0) {
			const i = E.replacementChoices(state, 0).find(j => solver.winWithin(E.applyReplacement(state, 0, j), remaining - 1));
			step.after = `あなたは ${speciesName(state.sides[0].mons[i].species)} を出す`;
			step.p1Replace = i;
			state = E.applyReplacement(state, 0, i);
		}
	}
	const cap = puzzle.length + 2;
	const refutations = [];
	for (const a1 of E.legalActions(puzzle.state, 0)) {
		const def = bestDefense(solver, puzzle.state, a1, cap);
		const total = def.distance === Infinity ? null : def.distance + 1;
		if (total === puzzle.length) continue;
		refutations.push({
			p1: actionLabel(puzzle.state, 0, a1),
			p2: actionLabel(puzzle.state, 1, def.action),
			verdict: total === null ? `${cap} ターン以内には勝てない` : `最短 ${total} ターンになる`,
		});
	}
	return { steps, refutations };
}

module.exports = { id, label, features, rules, typeChart, damageTable, Game, answer, speciesName };

'use strict';
// 出題用の CLI。
//
// 実行方法：
//   node tsumepoke/v1/play.js             … 一番長い問題から1問を選んで出題
//   node tsumepoke/v1/play.js 12          … id 12 の問題を出題
//   node tsumepoke/v1/play.js 12 --answer … 解答の手順（相手は最長の受け）を表示
//   node tsumepoke/v1/play.js --list      … 問題の一覧（id とターン数）を表示
//
// 回答者が手を選ぶと、相手は回答者の勝ちを一番遅らせる手（逃れられるならその手）を選んで次のターンへ進む。
// 勝てば正解。決められたターン数で勝てなくなったら失敗で、最初からやり直す。

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const E = require('./engine');
const { Solver, bestDefense, bestReplacement } = require('./solver');

const PUZZLES = path.join(__dirname, 'puzzles.json');

// 名前は names_ja.json（build_names_ja.js で作る）の日本語名で表示する。表にない名前は PS の英語名のまま。
const NAMES_JA = path.join(__dirname, 'names_ja.json');
const ja = fs.existsSync(NAMES_JA) ? JSON.parse(fs.readFileSync(NAMES_JA, 'utf8')) : { species: {}, moves: {}, types: {} };
const speciesName = id => ja.species[id] || E.speciesInfo(id).name;
const moveName = id => ja.moves[id] || E.moveInfo(id).name;
const typeName = t => ja.types[t] || t;

function monLine(mon, isActive) {
	const info = E.speciesInfo(mon.species);
	const mark = isActive ? '[場]' : '    ';
	const hp = mon.hp > 0 ? `HP ${mon.hp}/${info.stats.hp}` : 'ひんし';
	return `${mark} ${speciesName(mon.species)} (${info.types.map(typeName).join('/')})  ${hp}  素早さ ${info.stats.spe}`;
}

function moveLabel(moveId) {
	const m = E.moveInfo(moveId);
	const pri = m.priority ? `  優先度 ${m.priority > 0 ? '+' : ''}${m.priority}` : '';
	return `${moveName(moveId)} (${typeName(m.type)}・${m.category === 'Physical' ? '物理' : '特殊'}・威力 ${m.basePower}${pri})`;
}

// mon の技ごとに、相手の場のポケモンへのダメージ（固定乱数での値）を添えた行を返す。
// 控えのポケモンも、交代したときの参考に同じ相手への値を出す。
function movesWithDamage(state, sideIndex, mon) {
	const foe = E.activeMon(state.sides[1 - sideIndex]);
	const foeMax = E.speciesInfo(foe.species).stats.hp;
	return mon.moves.map(id => {
		const d = E.calcDamage(mon.species, foe.species, id, E.rollFor(sideIndex));
		const pct = (100 * d / foeMax).toFixed(1);
		return `        ${moveLabel(id)}  → ${speciesName(foe.species)} に ${d} ダメージ（${pct}%）`;
	});
}

function showSide(state, sideIndex, title) {
	const out = [title];
	const side = state.sides[sideIndex];
	// 場のポケモンを一番上に、控えはその下に元の並びで出す。
	const order = [side.active, ...side.mons.map((_, i) => i).filter(i => i !== side.active)];
	for (const i of order) {
		const m = side.mons[i];
		out.push(monLine(m, i === side.active));
		if (m.hp > 0) out.push(...movesWithDamage(state, sideIndex, m));
	}
	return out;
}

function showState(state) {
	const out = [
		...showSide(state, 1, '--- 相手（p2）　相手の技は最高乱数で計算 ---'),
		...showSide(state, 0, '--- あなた（p1）　あなたの技は最低乱数で計算 ---'),
	];
	console.log(out.join('\n'));
}

function actionLabel(state, sideIndex, a) {
	const side = state.sides[sideIndex];
	if (a.type === 'move') return moveLabel(E.activeMon(side).moves[a.index]);
	return `交代 → ${speciesName(side.mons[a.index].species)}`;
}

function showLog(log) {
	for (const ev of log) {
		const who = ev.side === 0 ? 'あなた' : '相手';
		if (ev.kind === 'switch') {
			console.log(`  ${who}は ${speciesName(ev.from)} を引っ込めて ${speciesName(ev.to)} を出した`);
		} else if (ev.kind === 'move') {
			console.log(`  ${who}の ${speciesName(ev.user)} の ${moveName(ev.move)}！ ` +
				`${speciesName(ev.target)} に ${ev.damage} ダメージ（残り HP ${ev.hpLeft}）`);
		} else if (ev.kind === 'faint') {
			console.log(`  ${who}の ${speciesName(ev.mon)} は倒れた`);
		}
	}
}

// 解答の手順を表示する。相手は毎ターン最長の受けを選ぶ。
function showAnswer(puzzle) {
	const solver = new Solver();
	let state = puzzle.state;
	let remaining = puzzle.length;
	for (let turn = 1; remaining > 0; turn++, remaining--) {
		// 残りターン数以内に勝てる手のうち、最初に見つかった手を出す。
		// 唯一解なのは初手だけで、2ターン目以降は複数ありうる。
		const a1 = E.legalActions(state, 0).find(a => solver.actionWinsWithin(state, a, remaining));
		const def = bestDefense(solver, state, a1, remaining);
		console.log(`${turn}ターン目：あなた「${actionLabel(state, 0, a1)}」／相手「${actionLabel(state, 1, def.action)}」`);
		showLog(def.result.log);
		if (def.result.winner === 0) {
			console.log('  → あなたの勝ち');
			return;
		}
		state = def.result.state;
		if (def.result.replace === 1) {
			const rep = bestReplacement(solver, state, remaining - 1);
			console.log(`  相手は ${speciesName(state.sides[1].mons[rep.index].species)} を出した`);
			state = E.applyReplacement(state, 1, rep.index);
		} else if (def.result.replace === 0) {
			const i = E.replacementChoices(state, 0).find(j => solver.winWithin(E.applyReplacement(state, 0, j), remaining - 1));
			console.log(`  あなたは ${speciesName(state.sides[0].mons[i].species)} を出す`);
			state = E.applyReplacement(state, 0, i);
		}
	}
}

// 入力を1行ずつ読む。readline/promises の question はパイプで渡すと質問前に届いた行を捨てるので、自前でためておく。
function makeLineReader() {
	const rl = readline.createInterface({ input: process.stdin });
	const lines = [];
	const waiters = [];
	let closed = false;
	rl.on('line', line => (waiters.length ? waiters.shift()(line) : lines.push(line)));
	rl.on('close', () => {
		closed = true;
		while (waiters.length) waiters.shift()(null);
	});
	return {
		question(prompt) {
			process.stdout.write(prompt);
			if (lines.length) return Promise.resolve(lines.shift());
			if (closed) return Promise.resolve(null);
			return new Promise(resolve => waiters.push(resolve));
		},
		close: () => rl.close(),
	};
}

// 正解以外の初手ごとに、どう受けられると決められたターン数で勝てなくなるかを表示する。
// 交代でかわされる問題（毒技に鋼タイプを合わせるなど）の狙いが分かる。
function showRefutations(puzzle) {
	const solver = new Solver();
	const cap = puzzle.length + 2;
	console.log('\n正解以外の初手と、それに対する相手の受け:');
	for (const a1 of E.legalActions(puzzle.state, 0)) {
		const def = bestDefense(solver, puzzle.state, a1, cap);
		const total = def.distance === Infinity ? null : def.distance + 1;
		if (total === puzzle.length) continue;
		const verdict = total === null ? `${cap} ターン以内には勝てない` : `最短 ${total} ターンになる`;
		console.log(`  「${actionLabel(puzzle.state, 0, a1)}」→ 相手「${actionLabel(puzzle.state, 1, def.action)}」で${verdict}`);
	}
}

async function askIndex(rl, prompt, n) {
	for (;;) {
		const raw = await rl.question(prompt);
		if (raw === null) {
			console.log('\n入力が終わったので終了します。');
			process.exit(0);
		}
		const ans = raw.trim();
		console.log(ans);
		const k = Number(ans);
		if (Number.isInteger(k) && k >= 1 && k <= n) return k - 1;
		console.log(`1〜${n} の番号で答えてください`);
	}
}

// 1回分の挑戦。勝てば true、失敗すれば false を返す。
async function attempt(rl, puzzle) {
	const solver = new Solver();
	let state = puzzle.state;
	let remaining = puzzle.length;
	for (let turn = 1; ; turn++) {
		console.log(`\n========== ${turn}ターン目（残り ${remaining} ターン以内に勝つ）==========`);
		showState(state);
		const actions = E.legalActions(state, 0);
		actions.forEach((a, i) => console.log(`  ${i + 1}. ${actionLabel(state, 0, a)}`));
		const a1 = actions[await askIndex(rl, 'あなたの行動は？ > ', actions.length)];
		const def = bestDefense(solver, state, a1, remaining);
		console.log(`相手の行動：${actionLabel(state, 1, def.action)}`);
		showLog(def.result.log);
		if (def.result.winner === 0) return true;
		if (def.result.winner === 1 || def.distance > remaining - 1 + 0) {
			// distance はこのターンのあとに必要なターン数。残り remaining - 1 ターンに収まらなければ失敗。
			if (def.result.winner !== 1) console.log(`→ この手では、残り ${remaining - 1} ターン以内に確実に勝つことができなくなった`);
			return false;
		}
		state = def.result.state;
		remaining--;
		if (def.result.replace === 1) {
			const rep = bestReplacement(solver, state, remaining);
			console.log(`相手は ${speciesName(state.sides[1].mons[rep.index].species)} を出した`);
			state = E.applyReplacement(state, 1, rep.index);
		} else if (def.result.replace === 0) {
			const choices = E.replacementChoices(state, 0);
			choices.forEach((j, i) => console.log(`  ${i + 1}. ${speciesName(state.sides[0].mons[j].species)}`));
			const j = choices[await askIndex(rl, '次に出すポケモンは？ > ', choices.length)];
			state = E.applyReplacement(state, 0, j);
			if (!solver.winWithin(state, remaining)) {
				console.log(`→ このポケモンでは、残り ${remaining} ターン以内に確実に勝つことができなくなった`);
				return false;
			}
		}
	}
}

async function main() {
	const puzzles = JSON.parse(fs.readFileSync(PUZZLES, 'utf8'));
	const args = process.argv.slice(2);
	if (args.includes('--list')) {
		for (const p of puzzles) {
			const names = s => s.mons.map(m => speciesName(m.species)).join(', ');
			console.log(`id ${p.id}: ${p.length}ターン  あなた[${names(p.state.sides[0])}] 相手[${names(p.state.sides[1])}]`);
		}
		return;
	}
	const idArg = args.find(a => /^\d+$/.test(a));
	let puzzle;
	if (idArg !== undefined) {
		puzzle = puzzles.find(p => p.id === Number(idArg));
		if (!puzzle) throw new Error(`id ${idArg} の問題がない`);
	} else {
		const maxLen = Math.max(...puzzles.map(p => p.length));
		const longest = puzzles.filter(p => p.length === maxLen);
		puzzle = longest[Math.floor(Math.random() * longest.length)];
	}
	console.log(`問題 id ${puzzle.id}：${puzzle.length}ターン以内に、相手がどう動いても確実に勝つ手順を見つけてください。`);
	if (args.includes('--answer')) {
		showState(puzzle.state);
		console.log('');
		showAnswer(puzzle);
		showRefutations(puzzle);
		return;
	}
	const rl = makeLineReader();
	for (;;) {
		if (await attempt(rl, puzzle)) {
			console.log('\n正解です！');
			break;
		}
		console.log('\n失敗です。最初からやり直します。');
	}
	rl.close();
}

main();

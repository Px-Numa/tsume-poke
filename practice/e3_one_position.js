// 局面を1つだけ選んで、確定勝ちかどうかを調べるスクリプトになっている。
// 詰めポケ/ フォルダで `node practice/e3_one_position.js` と入力すると動く。
// 読むターン数を変えたいときは `node practice/e3_one_position.js 3` のように数字を足す。
//
// 探索の仕組みは `practice/e2_solver.js` に入れてある。ここではそれを読み込んで使うだけにしてあるので、
// 局面を差し替えながら結果を見る用途に向いている。仕組みの説明は `e2.SolverDescription.md` にまとめてある。
//
// 表示の流れは次の3段になっている。
//   2節で、調べる局面の中身（HP、状態異常、素早さ、選べる手）を表示する。
//   3節で、手の組み合わせごとに1ターンの結果を確率つきで表示する。
//   4節で、確定勝ちかどうかの判定と、勝てない場合の負け筋を表示する。

const solver = require('./e2_solver.js');
const { Teams } = require('../pokemon-showdown');

// =====================================================================================
// 1節 調べたい局面をここに書く
// =====================================================================================
//
// 別の局面を試すときは、この節だけを書き換えればよい。
// チームは対戦サイトのチームビルダーと同じ Export 形式で書く。性別は `(F)` のように丸括弧で指定する。
// 技の数を増やすと、調べる組み合わせも増えて時間が延びることになる。

const P1_TEAM = Teams.import(`
Pikachu (F) @ Light Ball
Ability: Static
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot
`);

const P2_TEAM = Teams.import(`
Gyarados (M) @ Leftovers
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Waterfall
- Earthquake
`);

// 対戦が始まった直後の状態を書き換えて、途中の局面を作っている。
// ここでは、ピカチュウの HP を 1 にして、ギャラドスをまひにしてある。
// 書き換えに使える関数は、sethp / setStatus / setBoost / setItem などになる（PS_KNOWHOW.md の §6.3）。
function inject(battle) {
	battle.p1.active[0].sethp(1);
	battle.p2.active[0].setStatus('par');
}

// 何ターン以内の勝ちを探すかを決めている。コマンドラインで数字を渡せば、そちらが優先される。
const DEPTH = Number(process.argv[2]) || 3;

// 局面は探索のたびに作り直すので、関数の形で用意しておく。
const makeBattle = () => solver.makePosition(P1_TEAM, P2_TEAM, inject);

// =====================================================================================
// 2節 局面の中身を表示する
// =====================================================================================

function showPosition(battle) {
	console.log('=== 調べる局面 ===');
	for (const side of battle.sides) {
		const mon = side.active[0];
		const boosts = Object.entries(mon.boosts).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
		console.log(
			`  ${side.id} ${mon.name.padEnd(9)} HP ${mon.hp}/${mon.maxhp}` +
			`  状態異常 ${mon.status || 'なし'}  持ち物 ${mon.item || 'なし'}  特性 ${mon.ability}` +
			`  素早さ ${mon.getStat('spe')}  ランク ${boosts.length ? boosts.join(',') : 'なし'}`
		);
	}
	const label = (side, choice) => solver.choiceLabel(side, choice);
	console.log(`  p1 が選べる手: ${solver.legalChoices(battle.p1).map(c => label(battle.p1, c)).join(' / ')}`);
	console.log(`  p2 が選べる手: ${solver.legalChoices(battle.p2).map(c => label(battle.p2, c)).join(' / ')}`);
	console.log(`  読むターン数: ${DEPTH}`);
}

// =====================================================================================
// 3節 手の組み合わせごとに、1ターンの結果を確率つきで表示する
// =====================================================================================
//
// 乱数の結果を全部たどって、決着した枝は勝者ごとに確率を足し、未決着の枝は局面ごとにまとめている。
// 確率の合計が 1 になっていれば、枝の数え漏れも数えすぎもないと判断することができる。

function showTurnTable(battle) {
	const rootJson = solver.serialize(battle);
	console.log('\n=== 1ターンの結果（手の組み合わせごと）===');
	for (const p1Choice of solver.legalChoices(battle.p1)) {
		for (const p2Choice of solver.legalChoices(battle.p2)) {
			let probSum = 0, leaves = 0;
			const winners = new Map();
			const openStates = new Set();
			let openProb = 0;
			const t0 = Date.now();
			solver.enumerateTurn(rootJson, p1Choice, p2Choice, leaf => {
				leaves++;
				probSum += leaf.prob;
				if (leaf.battle.ended) {
					const name = leaf.battle.winner || '引き分け';
					winners.set(name, (winners.get(name) || 0) + leaf.prob);
				} else {
					openProb += leaf.prob;
					openStates.add(solver.stateKey(leaf.battle));
				}
			});
			const ends = [...winners].map(([name, p]) => `${name} ${(p * 100).toFixed(2)}%`).join(' / ') || 'なし';
			console.log(
				`  p1 ${solver.choiceLabel(battle.p1, p1Choice).padEnd(24)} p2 ${solver.choiceLabel(battle.p2, p2Choice).padEnd(24)}\n` +
				`      決着 ${ends}  未決着 ${(openProb * 100).toFixed(2)}%（${openStates.size} 通りの局面）\n` +
				`      枝 ${leaves} 本、確率の合計 ${probSum.toFixed(12)}、${((Date.now() - t0) / 1000).toFixed(1)} 秒`
			);
		}
	}
}

// =====================================================================================
// 4節 確定勝ちかどうかを判定する
// =====================================================================================
//
// p1 の手ごとに、p2 のすべての手と、すべての乱数の結果に勝てるかを調べている。
// 勝てない手には、その手を崩す p2 の手と乱数の結果を1つ添えて表示するようにした。

function showVerdict(battle) {
	console.log(`\n=== ${DEPTH} ターン以内に確定勝ちがあるか ===`);
	const { rows, stats, seconds } = solver.explain(battle, DEPTH);
	for (const row of rows) {
		console.log(`  p1 ${row.p1.padEnd(24)} ${row.proven ? '確定勝ち' : '確定勝ちではない'}`);
		if (row.counterexample) console.log(`      負け筋の例: ${row.counterexample}`);
	}
	const proven = rows.filter(r => r.proven).map(r => r.p1);
	console.log(proven.length ?
		`  → この局面は詰み。正解の手は ${proven.join(' と ')} になる。` :
		`  → この局面は ${DEPTH} ターン以内の詰みではない。`);
	console.log(`  （${seconds.toFixed(1)} 秒、ターン処理 ${stats.turnSimulations} 回、` +
		`2ターン目以降に読んだ局面 ${stats.nodes} 個、結果の使い回し ${stats.cacheHits} 回）`);
}

// =====================================================================================
// 5節 上から順に実行する
// =====================================================================================

solver.installPatch();
showPosition(makeBattle());
showTurnTable(makeBattle());
showVerdict(makeBattle());

// 段階E-1: toJSON / fromJSON で局面を複製する
// 実行: node practice/e_clone.js   （詰めポケ/ フォルダで）
//
// 確かめること:
//   1. 複製した局面から続きを指すと、元の局面から指したのと同じ結果になるか
//   2. 複製は元の局面と独立しているか（落とし穴あり）
//   3. 複製と1ターンの処理にどれくらい時間がかかるか（探索に使える速さか）
//   4. 1ターンの中で、乱数が「どこで・何回・何通りの範囲で」引かれているか（段階E-2への準備）
const { Battle, Teams, PRNG } = require('../pokemon-showdown');

const p1Team = Teams.import(`
Pikachu (F) @ Light Ball
Ability: Static
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot
`);
const p2Team = Teams.import(`
Gyarados (M) @ Leftovers
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Waterfall
- Earthquake
`);

// 段階D 5-4 の局面: HP1 のピカチュウ vs まひのギャラドス
function makePosition(seed = [1, 2, 3, 4]) {
	const battle = new Battle({ formatid: 'gen9customgame', seed, strictChoices: true });
	battle.setPlayer('p1', { name: 'Alice', team: p1Team });
	battle.setPlayer('p2', { name: 'Bob', team: p2Team });
	battle.makeChoices('team 1', 'team 1');
	battle.p1.active[0].sethp(1);
	battle.p2.active[0].setStatus('par');
	return battle;
}

// 複製: 文字列を経由する（理由は 2節）
const clone = battle => Battle.fromJSON(JSON.stringify(battle.toJSON()));
const hp = battle => battle.sides.map(s => `${s.active[0].name} ${s.active[0].hp}/${s.active[0].maxhp}${s.active[0].status ? ' ' + s.active[0].status : ''}`).join(' vs ');

// ---- 1. 複製から続きを指す --------------------------------------------------
console.log('=== 1. 複製から続きを指す ===');
{
	const original = makePosition();
	const copy = clone(original);
	console.log('複製直後 :', hp(copy), '/ turn', copy.turn, '/ 注入した HP1・まひ も残っているか');
	original.makeChoices('move Grass Knot', 'move Waterfall');
	copy.makeChoices('move Grass Knot', 'move Waterfall');
	console.log('元の局面 :', hp(original), '/ winner', original.winner);
	console.log('複製     :', hp(copy), '/ winner', copy.winner);
	// 乱数の状態（seed）も複製されるので、同じ手を指せば同じ乱数が出て同じ結果になる
	console.log('乱数の状態も同じか:', original.prng.getSeed() === copy.prng.getSeed());
}

// ---- 2. 独立しているか（落とし穴）---------------------------------------------
console.log('\n=== 2. 複製の独立性 ===');
{
	// (a) 文字列を経由した場合
	const a = makePosition();
	const aCopy = clone(a);
	aCopy.makeChoices('move Thunderbolt', 'move Waterfall');
	console.log('(a) 文字列経由    : 元の局面 ended =', a.ended, '/ log の配列は別物か:', a.log !== aCopy.log);

	// (b) toJSON() のオブジェクトをそのまま fromJSON に渡した場合
	const b = makePosition();
	const bCopy = Battle.fromJSON(b.toJSON());
	const before = b.log.length;
	bCopy.makeChoices('move Thunderbolt', 'move Waterfall');
	console.log('(b) オブジェクト直: 元の局面 ended =', b.ended, '/ log の配列は別物か:', b.log !== bCopy.log,
		`/ 複製だけ進めたのに、元の log が ${before} → ${b.log.length} 行に増えた`);
}

// ---- 3. 速さ --------------------------------------------------------------------
console.log('\n=== 3. 速さ（1回あたりの平均）===');
{
	const N = 2000;
	const base = makePosition();
	const time = (label, fn) => {
		fn(); // 1回目はJITの準備なので捨てる
		const t0 = performance.now();
		for (let i = 0; i < N; i++) fn();
		const ms = (performance.now() - t0) / N;
		console.log(`${label.padEnd(28)} ${ms.toFixed(3)} ms  (1秒に約 ${Math.round(1000 / ms)} 回)`);
	};
	const json = JSON.stringify(base.toJSON());
	console.log(`局面の JSON の大きさ: ${(json.length / 1024).toFixed(1)} KB`);
	time('toJSON + stringify', () => JSON.stringify(base.toJSON()));
	time('fromJSON(文字列)', () => Battle.fromJSON(json));
	time('makePosition（作り直し）', () => makePosition());
	time('fromJSON + 1ターン処理', () => Battle.fromJSON(json).makeChoices('move Grass Knot', 'move Waterfall'));
}

// ---- 4. 乱数の呼び出しを記録する -----------------------------------------------
// battle.random / randomChance / sample / shuffle はすべて battle.prng.random(from, to) を通る（sim/prng.ts）。
// そこで、複製の prng を「呼ばれた範囲と呼び出し元を記録する PRNG」に差し替える。
console.log('\n=== 4. 1ターン中の乱数の呼び出し（くさむすび / たきのぼり）===');
class TracingPRNG extends PRNG {
	constructor(seed, calls) {
		super(seed);
		this.calls = calls;
	}
	random(from, to) {
		// 呼び出し元の関数名をスタックトレースから取り出す（PRNG と Battle の中継関数は飛ばす）
		const caller = new Error().stack.split('\n').slice(2)
			.map(l => (l.match(/at (?:\S+\.)?(\w+) \(/) || [])[1])
			.find(name => name && !['random', 'randomChance', 'sample', 'shuffle', 'randomizer'].includes(name));
		const range = to === undefined ? (from === undefined ? '[0,1) の実数' : `${from}通り`) : `${to - from}通り`;
		this.calls.push(`${range.padEnd(12)} ← ${caller}`);
		return super.random(from, to);
	}
}
{
	const battle = clone(makePosition());
	const calls = [];
	battle.prng = new TracingPRNG(battle.prng.getSeed(), calls);
	battle.makeChoices('move Grass Knot', 'move Waterfall');
	calls.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c}`));
	console.log('  結果:', hp(battle), '/ winner', battle.winner || '(未決着)');
}

// ---- 5. 練習問題1: AND/OR 探索（乱数は seed で固定したまま）---------------------
// 1対1（交代なし）の局面だけを想定している。交代や forceSwitch の request は扱わない。
console.log('\n=== 5. solve(battle, depth) ===');
const legalMoves = side => side.activeRequest.active[0].moves.filter(m => !m.disabled).map(m => m.move);
let nodes = 0; // makeChoices を呼んだ回数（探索の大きさの目安）

// AND: p2 のどの手に対しても、depth ターン以内に p1 の勝ちにつながるか
function winsAgainstAll(battle, p1Move, depth) {
	return legalMoves(battle.p2).every(p2Move => {
		const next = clone(battle);
		next.makeChoices(`move ${p1Move}`, `move ${p2Move}`);
		nodes++;
		if (next.ended) return next.winner === 'Alice';
		return depth > 1 && solve(next, depth - 1) !== null;
	});
}
// OR: p1 の手のうち1つでも勝ちにつながれば、その手を返す（なければ null）
function solve(battle, depth) {
	return legalMoves(battle.p1).find(p1Move => winsAgainstAll(battle, p1Move, depth)) ?? null;
}

{
	const position = makePosition();
	for (const depth of [1, 2, 3]) {
		const best = solve(position, depth);
		nodes = 0;
		const t0 = performance.now();
		const perMove = legalMoves(position.p1).map(m => `${m}:${winsAgainstAll(position, m, depth) ? '勝ち' : '×'}`);
		const ms = performance.now() - t0;
		console.log(`depth=${depth}  solve → ${best}  / 初手ごと ${perMove.join(' ')}  / ${nodes} ノード ${ms.toFixed(0)} ms`);
	}
	// 同じ局面でも seed を変えると、くさむすびの評価が変わる
	let gkWins = 0;
	const S = 200;
	for (let i = 1; i <= S; i++) {
		if (winsAgainstAll(makePosition([i, i * 3 + 1, i * 7 + 2, i * 11 + 3]), 'Grass Knot', 2)) gkWins++;
	}
	console.log(`くさむすび(depth=2)を「勝ち」と判定した seed: ${gkWins}/${S}`);
}
// → depth=1: 10まんボルトだけ「勝ち」。くさむすびはギャラドスを倒しきれない。
//   depth=2: くさむすびも「勝ち」になった。seed [1,2,3,4] ではターン1にギャラドスがしびれて動けず、
//            ターン2に10まんボルトで倒せるから。depth=3 は depth=2 と同じ（ノード数も増えない。
//            10まんボルトの枝はすぐ決着し、くさむすびの枝も2ターン目で決着するため）。
//
// 考察: この solve が「詰み」と答えても証明にならない理由
//   - clone は乱数の状態ごと複製するので、どの枝も「決まった1つの未来の乱数」を引く。
//     solve が調べているのは「この seed の乱数の結果が1通りに決まった世界」だけで、
//     段階Cで seed を1つ選んで回したのと本質的に同じ（標本1個）。
//   - さらに悪いことに、p1 の手の選び方が「未来の乱数を知っている」ことになる。
//     くさむすび(depth=2)を「勝ち」と判定したのは、ギャラドスがしびれると知っているから。
//     seed を変えると 200 個中の約25%でしか「勝ち」にならない（しびれる確率そのもの）。
//   - しかも、同じ seed でも枝ごとに乱数の使われ方がずれる。4節のとおり、1ターンで何回・
//     何のために乱数を引くかは選んだ手で変わる（10まんボルトには追加効果の判定が加わる、など）。
//     だから「同じ seed = 同じ運」ですらない。
//   → 本当の詰み判定には、手の分岐（AND/OR）に加えて、乱数の結果の分岐を全部調べる必要がある（6節）。

// ---- 6. 練習問題2: 1ターンの乱数の結果を全部列挙する設計（実装は段階E-2）-------------
//
// (1) 何回目の呼び出しで何を返すか: 「接頭辞（prefix）を指定して再生する PRNG」
//   - ScriptedPRNG(prefix): i 回目の呼び出しでは prefix[i] 番目の結果を返し、prefix が尽きたら 0 番目を返す。
//     呼ぶたびに { 結果の数, 選んだ番号, 確率 } を trace に記録する。
//   - 1回ぶんの実行 = 「ターン開始の局面を clone → prng を差し替え → makeChoices」。
//     ターンの途中の局面は複製できないので、葉1つにつき1ターン分を最初から再生する（1葉 ≈ 0.64ms）。
//
// (2) どう順番に試すか: 桁上がりカウンタ（深さ優先）
//   - 実行後の trace を後ろから見て、まだ最後の結果まで試していない呼び出し j を探す。
//     次の prefix = trace[0..j-1] の番号 + [trace[j] の番号 + 1]。j が見つからなければ全部試し終わり。
//   - 呼び出しの回数や範囲は前の結果で変わる（ギャラドスがしびれると、たきのぼりの4回ぶんが消える）。
//     つまり分岐は「掛け算の表」ではなく「木」になる。prefix を再生する方法なら、この木をそのまま辿れる。
//
// (3) 各分岐の確率: 葉までの呼び出しの確率の積
//   - random(k) の各値: 1/k
//   - randomChance(n, d) を2通りにまとめる: true が n/d、false が (d-n)/d。
//     n >= d（命中100の技）や n <= 0 は分岐しない（確率1で1通り。ただし乱数は1回消費される）
//   - 全ての葉の確率の和が 1 になることで、列挙の漏れを確認できる。
//   - 実装上の注意: Battle.randomChance は prng.randomChance を呼ぶ（battle.ts:351）ので、PRNG のサブクラスで
//     randomChance を上書きすれば n, d が見える。一方、追加効果の判定は random(100) を呼んで、比較は
//     呼び出し元で行っている（battle-actions.ts:1343 secondaries）。PRNG からは確率が見えないので、
//     secondaries を「randomChance(chance, 100) を使う版」に差し替える必要がある。
//
// (4) 何通りになるか（段階Dの局面。試作して数えた。確率の和はすべて 1.000000）
//   ギャラドスがしびれるかどうかで、その後の呼び出しが変わる:
//     しびれる  : 命中(100) → 急所(24) → ダメージ(16) → まひ(4)
//     動ける    : ↑の後に たきのぼりの 命中(100) → 急所(24) → ダメージ(16) → ひるみ(100) → せいでんき(10)
//   - まとめない（random の値を全部）: 100×24×16 × (1 + 3×100×24×16×100×10) ≈ 4.4兆通り。0.64ms だと約90年。
//   - randomChance だけ2通りにまとめる: くさむすび/たきのぼり で 2×16×(1 + 2×16×100×2) = 204,832通り、
//     実測 136秒。2×2の表の4マス合計で 212,288通り（約140秒）。ひるみ判定の random(100) が残るのが大きい。
//   - 追加効果の random(100) も2通りにまとめる: くさむすび/たきのぼり で 2×16×(1 + 2×16×2×2) = 4,128通り（約2.6秒）。
//     4マス合計で 5,312通り（約3.4秒）。
//   - さらに「ターン後の局面が同じ葉」を合流させると 64通りの局面になる（ギャラドスの残りHP 32通り × しびれた/動けた）。
//     HP1 のピカチュウはたきのぼりが当たれば急所・乱数に関係なく倒れるので、その先の分岐は結果を変えない。
//
// (5) 探索との組み合わせで効くこと
//   - 次のターンに進むのは合流後の局面だけにする（4,128 ではなく 64 から分岐する）。
//   - 「確定で勝てるか」だけを知りたいなら、確率が0でない負けの葉が1つ見つかった時点でその手を打ち切れる。
//     確率（何%で勝てるか）まで出したいときだけ、全部の葉を数える。
//   - それでも深さを増やすと、(手の組み合わせ × 合流後の局面数) のターン数乗で増える。エンジンの速さが上限を決める。

// ---- 7. 練習問題3: 手を変えて乱数の呼び出しを記録する ---------------------------
console.log('\n=== 7. 乱数の呼び出し（手や seed を変える）===');
function trace(seed, p1Move, p2Move) {
	const battle = clone(makePosition(seed));
	const calls = [];
	battle.prng = new TracingPRNG(battle.prng.getSeed(), calls);
	battle.makeChoices(`move ${p1Move}`, `move ${p2Move}`);
	console.log(`\n  seed [${seed}]  ${p1Move} / ${p2Move}`);
	calls.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c}`));
	console.log('  結果:', hp(battle), '/ winner', battle.winner || '(未決着)');
}
trace([1, 2, 3, 4], 'Thunderbolt', 'Waterfall');
// ギャラドスがしびれずに動ける seed を探す（くさむすびでは倒せないので、動ければ Bob の勝ち）
for (let i = 1; ; i++) {
	const seed = [i, i * 3 + 1, i * 7 + 2, i * 11 + 3];
	const battle = makePosition(seed);
	battle.makeChoices('move Grass Knot', 'move Waterfall');
	if (battle.winner === 'Bob') {
		trace(seed, 'Grass Knot', 'Waterfall');
		trace(seed, 'Grass Knot', 'Earthquake');
		break;
	}
}
// → 10まんボルト: 4回目が secondaries の 100通り（10% のまひ判定）に変わる。ギャラドスはもう まひ で、
//   しかも倒れているのに、判定の乱数は引かれる。結果に影響しない乱数も分岐として数えてしまう例。
// → ギャラドスが動ける seed（[1,4,9,14] が最初に見つかった）では、しびれ判定の後に たきのぼりの分が続く:
//   命中(100) → 急所(24) → ダメージ(16) → ひるみ判定(secondaries, 100) → せいでんき(onDamagingHit, 10 = 30%)。
//   じしんは接触技でも追加効果のある技でもないので、命中・急所・ダメージの3回で終わる。
//   ピカチュウは HP1 なので、この5回の乱数は勝敗に何の影響もない。6節(4)の「合流」で消したいのはこういう分岐。

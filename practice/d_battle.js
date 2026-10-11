// 段階D: Battle オブジェクトを直接操作する
// 実行: node practice/d_battle.js   （詰めポケ/ フォルダで）
//
// BattleStream（段階C）との違い:
//   - 文字列をやりとりせず、battle.p1.active[0].hp のように内部状態を直接読み書きできる
//   - 1ターン進めるのも battle.makeChoices(p1の手, p2の手) を呼ぶだけで、同期的に終わる（await 不要）
//   - その代わり文書化されていないAPIなので、PSのバージョンを固定して使う
//
// 題材:「超簡易版 詰めポケ」
//   p1 ピカチュウ（HP 1、でんきだま、素早さ306）vs p2 ギャラドス（HP満タン、素早さ199）
//   ピカチュウが先に動けるが、HP 1 なので倒しきれなければ反撃で負ける。
//   Q. p1 はどちらの技を選べば、p2 がどの技を選んでも勝てるか？（10まんボルト / くさむすび）
const { Battle, Teams } = require('../pokemon-showdown');

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

// ---- 1. 局面を作る ----------------------------------------------------------
// ここでは毎回ゼロから対戦を作り直している（段階Eでは toJSON/fromJSON で「複製」する）
// inject: 練習問題（5節）で sethp(1) の後に1行足すためのフック
function makePosition(seed = [1, 2, 3, 4], inject = () => {}) {
	// strictChoices: true にすると、不正な手を送ったときに例外が出る（黙って無視されない）
	const battle = new Battle({ formatid: 'gen9customgame', seed, strictChoices: true });
	battle.setPlayer('p1', { name: 'Alice', team: p1Team }); // team は JSON形式のまま渡せる
	battle.setPlayer('p2', { name: 'Bob', team: p2Team });
	battle.makeChoices('team 1', 'team 1'); // Team Preview → ここで turn 1 の選択待ちになる

	// ★ 局面の注入: 内部状態を直接書き換える
	battle.p1.active[0].sethp(1); // sethp は 1 未満にならない・最大HPを超えない
	inject(battle);
	return battle;
}

// ---- 2. 状態を読む ----------------------------------------------------------
function describe(battle) {
	const lines = [`turn=${battle.turn} ended=${battle.ended} winner=${JSON.stringify(battle.winner)}`];
	for (const side of battle.sides) {
		for (const p of side.pokemon) {
			lines.push(
				`  ${side.id} ${p.name.padEnd(9)} HP ${p.hp}/${p.maxhp}` +
				` status=${p.status || '-'} item=${p.item || '-'} ability=${p.ability}` +
				` spe=${p.getStat('spe')} boosts=${JSON.stringify(Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v)))}` +
				` PP=${p.moveSlots.map(m => `${m.id}:${m.pp}`).join(',')}`
			);
		}
	}
	return lines.join('\n');
}

const start = makePosition();
console.log('=== 2. 注入後の局面 ===');
console.log(describe(start));
// いかく で ピカチュウの攻撃が -1 されている（boosts に atk:-1）ことにも注目

// p1 に今届いている request（BattleStream で |request| として届くものと同じ中身）
console.log('p1 の選択肢:', start.p1.activeRequest.active[0].moves.map(m => m.move));

// ---- 3. 1ターン進める --------------------------------------------------------
// makeChoices(p1の手, p2の手)。両者の手が揃うので即座にターンが処理される。
console.log('\n=== 3. 全ての手の組み合わせ（2×2）を試す ===');
function printTable(inject, seed) {
	for (const p1Move of ['Thunderbolt', 'Grass Knot']) {
		for (const p2Move of ['Waterfall', 'Earthquake']) {
			const battle = makePosition(seed, inject);
			const logStart = battle.log.length;
			battle.makeChoices(`move ${p1Move}`, `move ${p2Move}`);
			// battle.log にこのターンのプロトコル行が溜まっている（|split| の後は secret と shared の2行が続く）
			const turnLog = battle.log.slice(logStart).filter(l => /^\|(move|-damage|faint|win|-crit|-miss|-enditem|cant|-status)\|/.test(l));
			console.log(`\np1:${p1Move} / p2:${p2Move} → 勝者: ${battle.winner || '(未決着)'}`);
			console.log(turnLog.map(l => `    ${l}`).join('\n'));
		}
	}
}
printTable();

// ---- 4. 不正な手 --------------------------------------------------------------
console.log('\n=== 4. strictChoices で不正な手を送る ===');
try {
	makePosition().choose('p1', 'move 3');
} catch (e) {
	console.log('例外:', e.message);
}

// ---- 5. 練習問題 ----------------------------------------------------------------
const gyarados = battle => battle.p2.active[0];

console.log('\n=== 5-1. ギャラドスに setBoost({ spe: 2 }) ===');
printTable(b => gyarados(b).setBoost({ spe: 2 }));
// → 4マスすべて Bob の勝ち。ギャラドスの素早さが 199×2=398 になり、ピカチュウ（306）より先に動く。
//   HP 1 のピカチュウは、たきのぼりでもじしんでも（どちらも命中100%）先に倒されて技を撃てない。
//   p1 に勝てる手は1つもないので、p1 から見た「詰み」ではない。むしろ乱数に関係なく
//   p2 が必ず勝つ（p1 から見て必敗）局面になった。

console.log('\n=== 5-2. ギャラドスの持ち物を focussash に ===');
printTable(b => gyarados(b).setItem('focussash'));
{
	const results = {};
	for (let i = 1; i <= 4000; i++) {
		const battle = makePosition([i, i * 3 + 1, i * 7 + 2, i * 11 + 3], b => gyarados(b).setItem('focussash'));
		battle.makeChoices('move Thunderbolt', 'move Waterfall');
		const key = battle.winner || '(未決着)';
		results[key] = (results[key] || 0) + 1;
	}
	console.log('\n10まんボルト / たきのぼり を 4000 seed:', results);
}
// → 10まんボルトの行が `|-enditem|p2a: Gyarados|Focus Sash` → `|-damage|p2a: Gyarados|1/394` になる。
//   本来は一撃で倒せるダメージだが、HP満タンからなのでタスキで HP 1 残り、
//   反撃でピカチュウが倒される。くさむすびは元から倒しきれない（241/394）ので、表は4マスとも Bob。
//   ただし 4000 seed で回すと、10まんボルトでは約2.7%が「未決着」になった。
//   10まんボルトの追加効果（10%でまひ）× まひで動けない（25%）= 2.5% のとき、ギャラドスが
//   反撃できずにターンが終わるため。seed [1,2,3,4] の表だけを見ると「必ず負け」に見えるが、
//   それは乱数の結果を1つ選んだだけ。p1 は必ず勝てはしないが、必ず負けるわけでもない。

console.log('\n=== 5-3. くさむすびのダメージ分布 ===');
// (a) seed を回して観測する（満タンのギャラドスに1回撃ち、最初の -damage 行からダメージを読む）
const observed = { normal: new Set(), crit: new Set() };
for (let i = 1; i <= 2000; i++) {
	const battle = makePosition([i, i * 3 + 1, i * 7 + 2, i * 11 + 3]);
	const logStart = battle.log.length;
	battle.makeChoices('move Grass Knot', 'move Waterfall');
	const turnLog = battle.log.slice(logStart);
	const hpLine = turnLog.find(l => l.startsWith('|-damage|p2a: Gyarados|'));
	const damage = 394 - parseInt(hpLine.split('|')[3]);
	// '|-crit|' だけで判定すると、たきのぼりがピカチュウに急所に当たった行まで拾ってしまう
	observed[turnLog.some(l => l.startsWith('|-crit|p2a: Gyarados')) ? 'crit' : 'normal'].add(damage);
}
const sorted = s => [...s].sort((a, b) => a - b);
console.log(`観測（2000 seed）急所なし ${observed.normal.size}通り:`, sorted(observed.normal));
console.log(`観測（2000 seed）急所あり ${observed.crit.size}通り:`, sorted(observed.crit));

// (b) 計算で列挙する（battle-actions.ts の getDamage と battle.ts の randomizer を追う）
//   Lv100 → floor(2*100/5+2) = 42
//   威力: くさむすびは相手の重さで決まる。ギャラドス 235kg（200kg以上）→ 120
//   特攻: ピカチュウ 199 × でんきだま 2倍 = 398、特防: ギャラドス 236
//   基礎ダメージ B = floor(floor(42*120*398/236)/50) + 2
//   急所: B = trunc(B*1.5)（乱数より前に掛かる）
//   乱数: floor(B * (100 - random(16)) / 100)（16段階が等確率）
//   タイプ相性: くさ → みず/ひこう = 1倍、タイプ一致なし → 以降の補正なし
const B = Math.floor(Math.floor(42 * 120 * 398 / 236) / 50) + 2;
const rolls = base => Array.from({ length: 16 }, (_, r) => Math.floor(base * (100 - r) / 100));
const normalRolls = rolls(B);
const critRolls = rolls(Math.trunc(B * 1.5));
console.log(`計算 B=${B} 急所なし:`, sorted(normalRolls));
console.log(`計算 急所あり:`, sorted(critRolls));

// (c) HP=X のとき倒せる確率を計算 → seed を回した結果と比べる
const X = 160;
const killRate = (1 - 1 / 24) * normalRolls.filter(d => d >= X).length / 16
	+ (1 / 24) * critRolls.filter(d => d >= X).length / 16;
let wins = 0;
const N = 4000;
for (let i = 1; i <= N; i++) {
	const battle = makePosition([i, i * 3 + 1, i * 7 + 2, i * 11 + 3], b => gyarados(b).sethp(X));
	battle.makeChoices('move Grass Knot', 'move Waterfall');
	if (battle.winner === 'Alice') wins++;
}
console.log(`HP=${X}: 計算 ${(killRate * 100).toFixed(2)}%  /  ${N} seed の実測 ${(wins / N * 100).toFixed(2)}%`);
// → 急所なし 145〜171 の16通り、急所あり 217〜256 の16通り。観測と計算が一致した
//   （PS_KNOWHOW §6.6 の「急所 220〜225」は、300 seed では急所が少なすぎて一部しか見えていなかった）。
//   HP=160 なら、急所なしで倒せるのは 160 以上の7通り、急所ありは16通りすべて:
//     (23/24)×(7/16) + (1/24)×(16/16) = 177/384 ≈ 46.09%
//   4000 seed の実測 46.13% とほぼ一致。seed を回さなくても、乱数の結果を列挙すれば確率は正確に出せる。
//   なお今回は16段階のダメージがすべて違う値だったが、B が小さいと同じ値が重なる。
//   その場合も「値」ではなく「16段階のそれぞれ」を 1/16 として数えること。

console.log('\n=== 5-4. ギャラドスを setStatus(\'par\') にしてくさむすび ===');
let unresolved = 0;
let example = null;
for (let i = 1; i <= 2000; i++) {
	const battle = makePosition([i, i * 3 + 1, i * 7 + 2, i * 11 + 3], b => gyarados(b).setStatus('par'));
	const logStart = battle.log.length;
	battle.makeChoices('move Grass Knot', 'move Waterfall');
	if (!battle.ended) {
		unresolved++;
		example ??= battle.log.slice(logStart).filter(l => /^\|(move|-damage|cant|-heal|turn)\|/.test(l));
	}
}
console.log(`未決着: ${unresolved}/2000 (${(unresolved / 20).toFixed(1)}%)`);
console.log('未決着になったターンのログ例:\n' + example.map(l => `    ${l}`).join('\n'));
// → まひ状態のポケモンは、行動のたびに 25% で「しびれて動けない」（`|cant|p2a: Gyarados|par`）。
//   くさむすびで倒しきれず、ギャラドスもしびれて反撃できないと、どちらも倒れないままターンが終わる。
//   実測でも 2000 回中 25.0% が未決着になった。
//
//   「詰み」の判定への影響:
//   - 1ターンの2×2表では「勝ち／負け」の2値で決まらないマスが出る。未決着のマスは、次のターン以降を
//     さらに読まないと勝ち負けを決められない（たべのこしで回復もするので、局面自体も変わっている）。
//   - しかも、どの結果になるかは乱数で決まる。つまり探索は「p1 の手 → p2 の手 → 乱数の結果 → 次のターン…」
//     という木になり、「p2 のどの手に対しても、どの乱数の結果に対しても勝てる p1 の手があるか」を
//     末端まで調べる必要がある。
//   - この局面では、10まんボルトならギャラドスより先に一撃で倒せるので、まひに関係なく詰みのまま。
//     まひで変わるのは くさむすび の枝の評価（負け → 何ターンか続く確率的な枝）だけ。
//   - 数ターン先まで読むと、毎回 makePosition() で作り直す方法では組み合わせが爆発する。
//     分岐の途中の局面を複製して続きを試す仕組み（段階E: toJSON/fromJSON）が必要になる。

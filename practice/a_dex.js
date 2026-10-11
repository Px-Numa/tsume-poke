// 段階A: Dex でデータを引く
// 実行: node practice/a_dex.js   （詰めポケ/ フォルダで）
//
// clone した本体を直接 require する。package.json の "main" が dist/sim/index.js を指しているので
// フォルダを指定するだけで読み込める（npm install pokemon-showdown した場合の require('pokemon-showdown') と同じ）。
const { Dex } = require('../pokemon-showdown');

// ---- 1. ポケモン ----------------------------------------------------------
// 名前は英語。大文字小文字や空白は無視される（'pikachu' でも 'Gar pikachu' でもOK）
const pikachu = Dex.species.get('pikachu');
console.log('=== 1. species ===');
console.log(pikachu.name, pikachu.types, pikachu.baseStats);
console.log('特性:', pikachu.abilities);

// ---- 2. 技 ----------------------------------------------------------------
const eq = Dex.moves.get('Earthquake');
console.log('\n=== 2. moves ===');
console.log({
	name: eq.name,
	type: eq.type,
	category: eq.category, // Physical / Special / Status
	basePower: eq.basePower,
	accuracy: eq.accuracy, // 必中技は true
	priority: eq.priority,
	target: eq.target, // allAdjacent = 自分以外の隣接全体
});

// ---- 3. タイプ相性 --------------------------------------------------------
// getEffectiveness は倍率ではなく「2の指数」を返す: 1 → 2倍, -1 → 0.5倍, 2 → 4倍
// 無効（0倍）は別関数 getImmunity で判定する（false なら無効）
console.log('\n=== 3. type chart ===');
const cases = [
	['Ground', ['Fire']],
	['Ground', ['Water', 'Flying']],
	['Ice', ['Dragon', 'Ground']], // ガブリアス
];
for (const [atk, def] of cases) {
	const immune = !Dex.getImmunity(atk, def);
	const mult = immune ? 0 : 2 ** Dex.getEffectiveness(atk, def);
	console.log(`${atk} → ${def.join('/')}: x${mult}`);
}

// ---- 4. 世代による違い ----------------------------------------------------
console.log('\n=== 4. generations ===');
for (const gen of [1, 3, 4, 9]) {
	const move = Dex.forGen(gen).moves.get('Bite');
	console.log(`gen${gen} Bite: type=${move.type}, category=${move.category}`);
}

// ---- 5. 存在しない名前 ----------------------------------------------------
// タイプミスしてもエラーにならず exists:false が返る → 必ずチェックする習慣を
console.log('\n=== 5. typo ===');
console.log('Garchmop exists?', Dex.species.get('Garchmop').exists);

// ---- 6. Dex.moves.all() ----------------------------------------------------
// get() が1件を引くのに対し、all() は「知っている技を全部」readonly Move[] で返す。
// 中身は get() で返るのと同じ Move オブジェクト（1回計算したら内部キャッシュされる）。
// species.all() / abilities.all() / items.all() も同じ考え方。
console.log('\n=== 6. moves.all() ===');
const allMoves = Dex.moves.all();
console.log('技の総数:', allMoves.length);

// isNonstandard: 'Past' | 'Future' | 'CAP' | 'LGPE' | 'Custom' | null など。
// 現行世代の対戦で使える技だけに絞りたいときは null（=standard）でフィルタする。
// （Zワザ・ダイマックス技はそもそも moves.all() に含まれないので気にしなくてよい）
const standardMoves = allMoves.filter(m => !m.isNonstandard);
console.log('うち現行世代で使える技:', standardMoves.length);

// 例1: 「威力100以上」かつ「命中100未満」の技を列挙
// accuracy は 必中技だと数値ではなく true が入っているので、
// typeof でチェックしないと true < 100 (=1 < 100 で true になる) に化けて誤判定する
const strongButInaccurate = standardMoves
	.filter(m => m.basePower >= 100 && typeof m.accuracy === 'number' && m.accuracy < 100)
	.map(m => `${m.name}(power:${m.basePower}, acc:${m.accuracy})`);
console.log('威力100以上・命中100未満:', strongButInaccurate);

// 例2: 命中率が必中(true)ではない技の中で、最も威力が高い技トップ3
const topPower = standardMoves
	.filter(m => typeof m.accuracy === 'number' && m.basePower > 0)
	.sort((a, b) => b.basePower - a.basePower)
	.slice(0, 3)
	.map(m => `${m.name}(${m.basePower})`);
console.log('威力トップ3:', topPower);

// forGen(gen).moves.all() で世代を指定しても all() 自体の件数(954件)は変わらない。
// まだ存在しない技は isNonstandard: 'Future' になるので、standardだけ数えると世代差が見える。
const gen1Moves = Dex.forGen(1).moves.all().filter(m => !m.isNonstandard);
const gen9Moves = Dex.forGen(9).moves.all().filter(m => !m.isNonstandard);
console.log('第1世代で使えた技数:', gen1Moves.length, '/ 第9世代:', gen9Moves.length);
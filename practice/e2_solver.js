// 段階E-2では、乱数の結果を全部たどって「確定勝ち」かどうかを判定するプログラムを作っている。
// 詰めポケ/ フォルダで `node practice/e2_solver.js` と入力すると、8節のテストが順に動くようにしてある。
//
// このファイルは、上から順に読めば流れが分かるように並べてある。
//   1節では、段階Dと同じ HP1 のピカチュウなどの局面を作る関数を用意している。
//   2節では、局面を文字列で複製する関数と、局面どうしを比べるキーを作る関数を用意している。
//   3節では、PS の追加効果の判定を、当たりと外れの2本の枝で数えられる形に差し替えている。
//   4節では、何回目の乱数で何を返すかを外から指定できる PRNG を作っている。
//   5節では、1ターンの中の乱数の分岐を、桁上がりカウンタの要領で全部たどっている。
//   6節では、選べる手を request から取り出している。
//   7節では、p1 の手を OR、p2 の手と乱数の結果を AND として、確定勝ちを探索している。
//   8節では、ここまでの関数が正しく動くかをテストで確かめている。
//
// このファイルで「確定勝ち」と呼んでいるのは、depth ターン以内に、p2 がどの手を選んでも、
// どんな乱数の結果になっても p1 が勝つような p1 の手が存在する、という状態のことを指している。
// 勝率が 99% の手があっても、1% の負け筋が残っていれば確定勝ちとは扱わないことになる。

const { Battle, Teams, PRNG } = require('../pokemon-showdown');
const { BattleActions } = require('../pokemon-showdown/dist/sim/battle-actions');

// =====================================================================================
// 1節 局面を作る関数を用意しておく
// =====================================================================================

const PIKACHU = Teams.import(`
Pikachu (F) @ Light Ball
Ability: Static
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot
`);

const GYARADOS_P2 = Teams.import(`
Gyarados (M) @ Leftovers
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Waterfall
- Earthquake
`);

// 8節の「3ターンかけて勝つ局面」で、p1 側に置くギャラドスを用意している。
// こおりのキバは命中95%なので、外れる枝が残るかぎり確定勝ちの手にはならないはずだと考えている。
const GYARADOS_P1 = Teams.import(`
Gyarados (M) @ Leftovers
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Waterfall
- Ice Fang
`);

// じしんしか持たないガブリアスは、ひこうタイプのギャラドスにダメージを与えることができない。
// ギャラドスの HP が減るのは、さめはだの反動（最大HPの1/8、つまり49）を受けたときだけということになる。
const GARCHOMP_EQ_ONLY = Teams.import(`
Garchomp (F)
Ability: Rough Skin
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
`);

// チームを2つ受け取って、ターン1の手を選ぶ直前まで進めた Battle を返すようにしている。
// inject には、局面を書き換える関数を渡すことができる（例えば b => b.p1.active[0].sethp(1) のような関数）。
// seed は、この局面を作るときに性別などを決めるためだけに使っている。
// 探索中は4節の PRNG に差し替えるので、探索の結果が seed に左右されることはないというわけである。
function makePosition(p1Team, p2Team, inject = () => {}, seed = [1, 2, 3, 4]) {
	const battle = new Battle({ formatid: 'gen9customgame', seed, strictChoices: true });
	battle.setPlayer('p1', { name: 'Alice', team: p1Team });
	battle.setPlayer('p2', { name: 'Bob', team: p2Team });
	battle.makeChoices('team 1', 'team 1');
	inject(battle);
	return battle;
}

// 8節で使う局面を、名前をつけてまとめておく。どれも段階C・Dで一度扱った局面をもとにしている。
const POSITIONS = {
	// HP1 のピカチュウと、まひ状態で HP 満タンのギャラドスが向かい合う局面を作っている。
	par: () => makePosition(PIKACHU, GYARADOS_P2, b => {
		b.p1.active[0].sethp(1);
		b.p2.active[0].setStatus('par');
	}),
	// HP1 のピカチュウと、きあいのタスキを持ったギャラドスが向かい合う局面になっている。
	sash: () => makePosition(PIKACHU, GYARADOS_P2, b => {
		b.p1.active[0].sethp(1);
		b.p2.active[0].setItem('focussash');
	}),
	// ギャラドスの HP を 160 にしてあり、くさむすびで倒せる確率は段階Dで 177/384 と計算してある。
	gk160: () => makePosition(PIKACHU, GYARADOS_P2, b => {
		b.p1.active[0].sethp(1);
		b.p2.active[0].sethp(160);
	}),
	// p1 のギャラドスと、じしんしか持たないガブリアスが向かい合う局面を用意している。
	chomp: () => makePosition(GYARADOS_P1, GARCHOMP_EQ_ONLY),
};

// =====================================================================================
// 2節 局面の複製と、局面を比べるキーを作る関数を用意しておく
// =====================================================================================

// 局面を文字列に変換する関数を用意している。
// toJSON() のオブジェクトをそのまま fromJSON に渡すと log の配列が共有されてしまうことを、
// PS_KNOWHOW.md の §6.5 で確かめてある。そのため、必ず JSON.stringify を通すようにした。
// log は探索の結果に関係しないうえに、ターンが進むほど長くなって複製が遅くなる。空の配列にしておくのはそのためである。
function serialize(battle) {
	const state = battle.toJSON();
	state.log = [];
	return JSON.stringify(state);
}

function restore(json) {
	return Battle.fromJSON(json);
}

// 2つの局面が同じかどうかを判定するためのキーを作っている。
// HP や状態異常だけを並べた簡易キーでは、PP やねむりの残りターンの違いを見落とす恐れがある。
// そこで、toJSON() の全情報から、局面の中身に関係しない項目だけを取り除いて使うことにした。
// 取り除いているのは、ログ（log, inputLog, messageLog）と、送信を管理する数値（sentLogPos など）と、乱数の状態（prng）の3種類になる。
// 乱数の状態は探索中に毎回差し替えているので、比べる必要がないと判断している。
// この方法では、ギャラドスのじしんが急所だったかどうか（lastMove に残る記録）が違うだけでも、別の局面として扱うことになる。
// 間違えて合流させるよりは安全なので、局面の数が簡易キーより増えることは受け入れている（§6.10 では 64 通りが 96 通りに増えた）。
const KEY_IGNORED = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'sentEnd', 'sentRequests', 'prng'];
function stateKey(battle) {
	const state = battle.toJSON();
	for (const k of KEY_IGNORED) delete state[k];
	return JSON.stringify(state);
}

// =====================================================================================
// 3節 追加効果の判定を、2本の枝で数えられる形に差し替える
// =====================================================================================
//
// PS の追加効果（10まんボルトのまひ10%、たきのぼりのひるみ20% など）は、
// battle-actions.ts の secondaries() の中で、次のように判定されている。
//     const secondaryRoll = this.battle.random(100);
//     if (typeof secondary.chance === 'undefined' || secondaryRoll < secondary.chance) { ...効果が出る... }
// random(100) を直接引いているので、4節の PRNG の側からは「何%の判定なのか」を知ることができない。
// このままだと、ひるみの判定だけで100本の枝に分かれてしまう（§6.8 で 204,832 回もターンを処理した原因がこれだった）。
//
// そこで、この比較の部分を randomChance(chance, 100) に置き換えることにした。
// PRNG の randomChance(n, d) の中身は `random(d) < n` になっている（sim/prng.ts の 116 行目）。
// したがって普通の PRNG で動かすかぎり、乱数を引く回数も、効果が出るかどうかも、元のコードと同じになるはずである。
// 置き換えても挙動が変わらないことは、8節の test0 で対戦ログを比べて確かめるようにしている。
//
// 同じ形の判定が selfDrops()（自分の能力が上がる追加効果の判定）にもあるので、そちらも置き換えておく。
// PS のバージョンが上がって元のコードの形が変わったときに気づけるように、
// 差し替える前に、元の関数の中身を文字列で確かめる処理も入れてある。

const ORIGINAL = {
	secondaries: BattleActions.prototype.secondaries,
	selfDrops: BattleActions.prototype.selfDrops,
};

function checkOriginalShape() {
	const expected = {
		secondaries: 'secondaryRoll < (secondaryOverflow ? secondary.chance % 256 : secondary.chance)',
		selfDrops: 'secondaryRoll < moveData.self.chance',
	};
	for (const [name, snippet] of Object.entries(expected)) {
		if (!ORIGINAL[name].toString().includes(snippet)) {
			throw new Error(`BattleActions.${name} の中身が想定と違うので、3節の差し替えを見直す必要がある`);
		}
	}
}

// 元の secondaries() を写したうえで、判定の部分だけを randomChance に書き換えている。
// chance が決まっていない追加効果（必ず出る効果）でも、元のコードは乱数を1回引いてから効果を出している。
// 乱数を引く回数を揃えるために、randomChance(100, 100) を呼んで「確率1の枝が1本だけ」という形で扱うことにした。
function patchedSecondaries(targets, source, move, moveData, isSelf) {
	if (!moveData.secondaries) return;
	for (const target of targets) {
		if (target === false) continue;
		const secondaries = this.battle.runEvent('ModifySecondaries', target, source, moveData, moveData.secondaries.slice());
		for (const secondary of secondaries) {
			const secondaryOverflow = (secondary.boosts || secondary.self) && this.battle.gen <= 8;
			const chance = typeof secondary.chance === 'undefined' ? 100 :
				(secondaryOverflow ? secondary.chance % 256 : secondary.chance);
			if (this.battle.randomChance(chance, 100)) {
				this.moveHit(target, source, move, secondary, true, isSelf);
			}
		}
	}
}

// selfDrops() も、secondaries() と同じ考え方で書き換えてある。
function patchedSelfDrops(targets, source, move, moveData, isSecondary) {
	for (const target of targets) {
		if (target === false) continue;
		if (moveData.self && !move.selfDropped) {
			if (!isSecondary && moveData.self.boosts) {
				const chance = typeof moveData.self.chance === 'undefined' ? 100 : moveData.self.chance;
				if (this.battle.randomChance(chance, 100)) {
					this.moveHit(source, source, move, moveData.self, isSecondary, true);
				}
				if (!move.multihit) move.selfDropped = true;
			} else {
				this.moveHit(source, source, move, moveData.self, isSecondary, true);
			}
		}
	}
}

function installPatch() {
	checkOriginalShape();
	BattleActions.prototype.secondaries = patchedSecondaries;
	BattleActions.prototype.selfDrops = patchedSelfDrops;
}

function uninstallPatch() {
	BattleActions.prototype.secondaries = ORIGINAL.secondaries;
	BattleActions.prototype.selfDrops = ORIGINAL.selfDrops;
}

// =====================================================================================
// 4節 乱数の値を外から指定できる PRNG を作る
// =====================================================================================
//
// PS の乱数は、すべて battle.prng の random() か randomChance() を通っている（§6.7）。
// この2つを上書きしたクラスを battle.prng に代入すれば、何回目の呼び出しで何を返すかを決めることができる。
//
// script は「i 回目の呼び出しでは script[i] 番目の枝を選ぶ」という意味の番号の並びになっている。
// 例えば script = [0, 1] なら、1回目の呼び出しで 0 番目の枝を、2回目の呼び出しで 1 番目の枝を選ぶことになる。
// script が尽きた後の呼び出しでは、0 番目の枝を選ぶようにしている。
//
// 呼び出しのたびに、枝の数（n）と、選んだ番号（i）と、その枝の確率（p）を trace に記録していく。
// 5節の桁上がりカウンタは、この trace を見て次に試す script を決めている。

class ScriptedPRNG extends PRNG {
	constructor(script, withLabels = false) {
		// 親クラスは seed を渡さないと作れないので、使うことのない seed を渡しておく。
		super('1,2,3,4');
		this.script = script;
		this.trace = [];
		// withLabels を true にすると、呼び出し元の関数名も記録するようにしてある。8節で負け筋を説明するときに使っている。
		// スタックトレースを取る処理は遅いので、探索中は false のままにしておく。
		this.withLabels = withLabels;
	}

	// options には [{ value: 呼び出し元に返す値, p: その枝の確率, text: 説明用の文字列 }, ...] という配列を渡すことになっている。
	pick(options) {
		const step = this.trace.length;
		const i = step < this.script.length ? this.script[step] : 0;
		this.trace.push({
			n: options.length, i, p: options[i].p, text: options[i].text,
			caller: this.withLabels ? callerName() : '',
		});
		return options[i].value;
	}

	// randomChance(k, d) は、k/d の確率で true を返す関数として使われている。
	// 命中や急所は当たりか外れかしか意味を持たないので、d 本ではなく2本の枝として扱うようにした。
	// 確率が 0 になる側の枝は作らないので、命中100%の技の命中判定は1本の枝で済むことになる。
	// 説明用の文字列には true / false をそのまま残してある。true の意味が呼び出し元によって違うためである。
	// 例えば hitStepAccuracy の true は「命中した」、getDamage の true は「急所に当たった」、
	// まひの判定（onBeforeMove）の true は「しびれて動けなかった」という意味を表している。
	randomChance(k, d) {
		const options = [];
		const hit = Math.max(0, Math.min(k, d));
		if (hit > 0) options.push({ value: true, p: hit / d, text: `true(${hit}/${d})` });
		if (hit < d) options.push({ value: false, p: (d - hit) / d, text: `false(${d - hit}/${d})` });
		return this.pick(options);
	}

	// random(n) は 0 以上 n 未満の整数を、random(m, n) は m 以上 n 未満の整数を、等確率で返す関数として使われている。
	// ダメージの乱数（16通り）や、素早さが同じときの行動順の決定がここを通るので、値の数だけ枝を作るようにした。
	// 引数なしの random()（0 以上 1 未満の実数を返す使い方）は、sim と data のどこからも呼ばれていないことを確かめてある（§6.7）。
	random(from, to) {
		if (from === undefined) throw new Error('random() の実数版は想定していない');
		const lo = to === undefined ? 0 : Math.floor(from);
		const hi = to === undefined ? Math.floor(from) : Math.floor(to);
		const n = hi - lo;
		return this.pick(Array.from({ length: n }, (_, j) => ({ value: lo + j, p: 1 / n, text: `${lo + j}(1/${n})` })));
	}
}

// スタックトレースから、PRNG を呼んだ PS の関数の名前を取り出している。
// 命中判定なら hitStepAccuracy、急所の判定なら getDamage という名前が返ってくるはずである。
const RELAY_FUNCTIONS = ['pick', 'random', 'randomChance', 'sample', 'shuffle', 'randomizer', 'callerName'];
function callerName() {
	return new Error().stack.split('\n').slice(1)
		.map(line => (line.match(/at (?:\S+\.)?(\w+) \(/) || [])[1])
		.find(name => name && !RELAY_FUNCTIONS.includes(name)) || '?';
}

// =====================================================================================
// 5節 1ターンの乱数の分岐を全部たどる
// =====================================================================================
//
// enumerateTurn は、手の組み合わせ（p1Choice と p2Choice）を固定したうえで、1ターンの中で起こりうる乱数の結果を全部たどる関数になっている。
// 1本の枝ごとに、ターン開始の局面を複製し、PRNG を差し替え、makeChoices で1ターンを処理するという手順を繰り返している。
// PS はターンの途中で処理を止めて複製することができないので、枝ごとに1ターンを最初からやり直す必要がある。
//
// 次に試す script は、桁上がりカウンタと同じ仕組みで決めている。
// trace を後ろから見ていき、まだ最後の枝まで試していない呼び出し j を探す。
// j より前の選び方はそのままにして、j 番目の番号だけを1つ進めたものが、次の script になるというわけである。
// j が見つからなければ、全部の枝を試し終わったことになる。
//
// 呼び出しが「命中(1本) → 急所(2本) → ダメージ(16本)」の3回だった場合で考えてみる。
// このときは [0,0,0], [0,0,1], ..., [0,0,15], [0,1,0], ..., [0,1,15] の32本を順に試すことになる。
// まひで動けなかった枝ではたきのぼりの判定が消えるように、前の乱数の結果によって後の呼び出しが変わることもある。
// その場合でも、trace にはその枝で実際に起きた呼び出しだけが記録されるので、木の形のまま正しくたどることができる。
//
// onLeaf(leaf) は、枝を1本処理するたびに呼ばれる関数として渡してもらう。false を返すと、残りの枝を試さずに打ち切るようにしてある。
// leaf には { battle: ターン後の Battle, prob: その枝の確率, script: その枝での選び方 } を入れて渡している。
// 戻り値は { leaves: 処理した枝の数, completed: 最後までたどったかどうか } という形にした。

function enumerateTurn(rootJson, p1Choice, p2Choice, onLeaf, stats = null) {
	let script = [];
	let leaves = 0;
	while (true) {
		const battle = restore(rootJson);
		const prng = new ScriptedPRNG(script);
		battle.prng = prng;
		battle.makeChoices(p1Choice, p2Choice);
		leaves++;
		if (stats) stats.turnSimulations++;

		const prob = prng.trace.reduce((acc, call) => acc * call.p, 1);
		const leafScript = prng.trace.map(call => call.i);
		if (onLeaf({ battle, prob, script: leafScript }) === false) {
			return { leaves, completed: false };
		}

		let j = prng.trace.length - 1;
		while (j >= 0 && prng.trace[j].i === prng.trace[j].n - 1) j--;
		if (j < 0) return { leaves, completed: true };
		script = [...leafScript.slice(0, j), leafScript[j] + 1];
	}
}

// 1本の枝を、呼び出し元の関数名つきでもう一度再生して、何が起きたかを文字列にまとめている。
// 8節で、ある手が確定勝ちにならない理由を表示するときに使うことにしている。
function describeLeaf(rootJson, p1Choice, p2Choice, script) {
	const battle = restore(rootJson);
	const prng = new ScriptedPRNG(script, true);
	battle.prng = prng;
	battle.makeChoices(p1Choice, p2Choice);
	const calls = prng.trace.map(call => `${call.caller}:${call.text}`).join(' → ');
	const mons = battle.sides.map(s => `${s.active[0].name} ${s.active[0].hp}/${s.active[0].maxhp}${s.active[0].status ? ' ' + s.active[0].status : ''}`).join(' vs ');
	return `${calls}  ⇒  ${mons}${battle.ended ? ` / 勝者 ${battle.winner || '引き分け'}` : ' / 未決着'}`;
}

// =====================================================================================
// 6節 選べる手を request から取り出す
// =====================================================================================
//
// side.activeRequest には、BattleStream の |request| と同じ中身が入っている（§6.1）。
// ここから、makeChoices に渡す文字列（'move 1' や 'switch 2'）の配列を作るようにしている。
// 技を名前ではなく番号で指定しているのは、同じ名前の技を2つ持たせた構成でも取り違えないようにするためである。
//
// テラスタルやメガシンカの選択肢は、今のところ作っていない。
// 交代の選択肢は作ってあるものの、8節の局面はすべて1対1なので、交代を含む局面ではまだ動作を確かめていない。

function legalChoices(side) {
	const request = side.activeRequest;
	// request がないときや、相手の交代を待っているとき（wait）は、何も選ばないことを空文字で表している。
	// battle.ts の makeChoices は、空文字を受け取るとその側の選択を飛ばすように書かれている。
	if (!request || request.wait) return [''];

	const switches = request.side.pokemon
		.map((mon, index) => ({ mon, index }))
		.filter(({ mon }) => !mon.active && !mon.condition.endsWith(' fnt'))
		.map(({ index }) => `switch ${index + 1}`);

	if (request.forceSwitch) return switches.length ? switches : ['pass'];

	const active = request.active[0];
	const moves = active.moves
		.map((move, index) => (move.disabled ? null : `move ${index + 1}`))
		.filter(Boolean);
	return active.trapped ? moves : [...moves, ...switches];
}

// 'move 1' のような選択を、表示用に 'move 1 (Thunderbolt)' という形へ直している。
function choiceLabel(side, choice) {
	const m = choice.match(/^move (\d+)$/);
	if (!m || !side.activeRequest?.active) return choice || '(選択なし)';
	return `${choice} (${side.activeRequest.active[0].moves[Number(m[1]) - 1].move})`;
}

// =====================================================================================
// 7節 確定勝ちを判定する探索を書く
// =====================================================================================
//
// 詰将棋の AND/OR 木と同じ形で探索している。1ターンは、次の3段の分岐でできていると考えることにした。
//   p1 の手は、どれか1つで勝てればよいので OR として扱う。
//   p2 の手は、全部に勝つ必要があるので AND として扱う。
//   乱数の結果も、全部で勝つ必要があるので AND として扱う。
// 実際の対戦では、p2 は p1 の手を見てから手を選ぶことができない。
// それでも、確定勝ちかどうかを判定するだけなら、p1 の手ごとに p2 の全ての手を調べれば足りるはずである。
// 手をランダムに選ぶ混合戦略を考えても、確率1で勝てる局面が増えることはないためである。
//
// 枝を打ち切る場所は3か所に分けてある。
// 乱数の枝で勝てない結果が1つ出たら、その手の組み合わせを調べるのをやめている。
// p2 の手の中に勝てないものが1つ見つかったら、その p1 の手は確定勝ちではないと判断する。
// p1 の手の中に確定勝ちになるものが1つ見つかった時点で、その局面は調べ終わりにしてある。
//
// 未決着の枝については、残りのターン数が1以上あれば次のターンを読みにいくことにした。
// 残りのターン数がなくなっても未決着なら、「このターン数では証明できなかった」として、勝てない枝と同じ扱いにしている。
//
// 同じ局面を何度も調べないように、判定の結果を cache に覚えさせている。
// キーは「残りターン数」と「2節の stateKey」をつなげたもので、例えばくさむすびのダメージが同じになった別々の枝は1回だけ調べれば済むことになる。

function newStats() {
	return { turnSimulations: 0, cacheHits: 0, nodes: 0, startedAt: performance.now() };
}

// rootJson の局面が depth ターン以内に確定勝ちかどうかを判定している。
// 戻り値は { proven: true または false, choice: 確定勝ちになる p1 の手（なければ null） } という形にしてある。
function solve(rootJson, depth, cache, stats) {
	stats.nodes++;
	const battle = restore(rootJson);
	for (const p1Choice of legalChoices(battle.p1)) {
		if (checkP1Choice(rootJson, battle, p1Choice, depth, cache, stats).proven) {
			return { proven: true, choice: p1Choice };
		}
	}
	return { proven: false, choice: null };
}

// p1 の手を1つ固定して、p2 の全ての手と全ての乱数の結果に勝てるかを調べている。
// 勝てないときは、見つかった負け筋（p2 の手と、その枝の script）も一緒に返すようにした。
function checkP1Choice(rootJson, battle, p1Choice, depth, cache, stats) {
	const p1Name = battle.p1.name;
	for (const p2Choice of legalChoices(battle.p2)) {
		let failedScript = null;
		const result = enumerateTurn(rootJson, p1Choice, p2Choice, leaf => {
			const ok = leafIsWin(leaf.battle, p1Name, depth, cache, stats);
			if (!ok) failedScript = leaf.script;
			return ok;
		}, stats);
		if (!result.completed) {
			return { proven: false, p2Choice, failedScript };
		}
	}
	return { proven: true };
}

// ターン後の局面を「勝ち」として扱ってよいかを判定している。
// 決着していれば勝者だけを見ることにしてある。未決着なら、残りのターン数を1つ減らして solve を呼ぶ形になっている。
function leafIsWin(battle, p1Name, depth, cache, stats) {
	if (battle.ended) return battle.winner === p1Name;
	if (depth <= 1) return false;

	const key = `${depth - 1}|${stateKey(battle)}`;
	if (cache.has(key)) {
		stats.cacheHits++;
		return cache.get(key);
	}
	const proven = solve(serialize(battle), depth - 1, cache, stats).proven;
	cache.set(key, proven);
	return proven;
}

// Battle を受け取って、p1 の手ごとの判定結果をまとめて返している。
// solve は確定勝ちの手が1つ見つかった時点で止まるが、こちらは説明に使うので全部の手を調べるようにした。
//
// 確定勝ちにならなかった手には、見つかった負け筋を1つ添えることにしている。
// 表示しているのは1ターン目の枝だけで、その枝の終わり方には2種類ある。
// 1ターン目で p2 が勝った場合は、表示した枝がそのまま負け筋になっている。
// 1ターン目が未決着だった場合は、その局面から残りのターン数では確定勝ちを証明できなかった、という意味に読むことになる。
// 2ターン目以降のどの枝で負けたのかまでは、今のところ表示できていない。
function explain(battle, depth) {
	const rootJson = serialize(battle);
	const cache = new Map();
	const stats = newStats();
	const rows = legalChoices(battle.p1).map(p1Choice => {
		const r = checkP1Choice(rootJson, battle, p1Choice, depth, cache, stats);
		let counterexample = null;
		if (!r.proven) {
			const leafText = describeLeaf(rootJson, p1Choice, r.p2Choice, r.failedScript);
			const suffix = leafText.endsWith('未決着') ?
				(depth > 1 ? `（この局面から残り ${depth - 1} ターンでは証明できなかった）` : '（1ターンで決着しなかった）') : '';
			counterexample = `p2 が ${choiceLabel(battle.p2, r.p2Choice)} を選び、1ターン目が ${leafText}${suffix}`;
		}
		return { p1: choiceLabel(battle.p1, p1Choice), proven: r.proven, counterexample };
	});
	return { rows, stats, seconds: (performance.now() - stats.startedAt) / 1000 };
}

// =====================================================================================
// 8節 動作を確かめるテストを並べておく
// =====================================================================================

// test0 では、3節の差し替えで PS の挙動が変わっていないことを確かめている。
// 追加効果の判定がある手（10まんボルトのまひ、たきのぼりのひるみ、こおりのキバのこおりとひるみ）を含む対戦を、
// 同じ seed のまま「差し替え前」と「差し替え後」で2回ずつ動かし、ターン後の対戦ログが1文字でも違うかを比べるようにした。
// ログの |t:| 行には実行した時刻が入ってしまうので、比べる前に取り除いておく必要がある。
function test0PatchIsTransparent() {
	const cases = [
		// p1 が10まんボルト、p2 がたきのぼりを選ぶ組み合わせを試している。
		[POSITIONS.gk160, 'move 1', 'move 1'],
		// p1 がくさむすびを選ぶと、たきのぼりのひるみ判定と、せいでんきの判定も発生することになる。
		[POSITIONS.gk160, 'move 2', 'move 1'],
		// こおりのキバには追加効果が2つ（こおり10%、ひるみ10%）あるので、判定が2回続く場合も確かめられる。
		[POSITIONS.chomp, 'move 2', 'move 1'],
	];
	const SEEDS = 300;
	const runAll = () => cases.flatMap(([make, c1, c2]) => Array.from({ length: SEEDS }, (_, s) => {
		const battle = make();
		battle.prng = new PRNG([s + 1, s * 3 + 7, s * 7 + 11, s * 11 + 13].join(','));
		battle.makeChoices(c1, c2);
		return battle.log.filter(line => !line.startsWith('|t:|')).join('\n');
	}));

	uninstallPatch();
	const before = runAll();
	installPatch();
	const after = runAll();
	const differ = before.filter((log, i) => log !== after[i]).length;
	console.log(`test0 差し替え前後の対戦ログ: ${before.length} 対戦中 ${differ} 対戦で違いがあった`);
}

// test1 では、1ターンの枝の数と確率を、段階E-1で予測した数と比べている。
// まひの局面では、追加効果も2本の枝にまとめた場合の枝の数を 64, 64, 1,056, 4,128 と予測していた。
// 確率の合計が1になっていれば、枝の数え漏れも数えすぎもないと判断することができる。
// 決着した枝は勝者ごとに確率を足し、未決着の枝は stateKey で合流させて、結果の局面の数も数えるようにした。
function test1CountBranches() {
	const battle = POSITIONS.par();
	const rootJson = serialize(battle);
	console.log('\ntest1 まひの局面で、1ターンの枝の数を数える');
	for (const p1Choice of legalChoices(battle.p1)) {
		for (const p2Choice of legalChoices(battle.p2)) {
			let probSum = 0;
			const terminal = new Map(), open = new Set();
			const t0 = performance.now();
			const { leaves } = enumerateTurn(rootJson, p1Choice, p2Choice, leaf => {
				probSum += leaf.prob;
				if (leaf.battle.ended) {
					terminal.set(leaf.battle.winner, (terminal.get(leaf.battle.winner) || 0) + leaf.prob);
				} else {
					open.add(stateKey(leaf.battle));
				}
			});
			const ms = performance.now() - t0;
			const ends = [...terminal].map(([w, p]) => `${w} ${(p * 100).toFixed(2)}%`).join(', ');
			console.log(`  ${choiceLabel(battle.p1, p1Choice).padEnd(24)} / ${choiceLabel(battle.p2, p2Choice).padEnd(22)}` +
				` 枝 ${String(leaves).padStart(5)} 本 (${ms.toFixed(0)} ms)  確率の合計 ${probSum.toFixed(12)}` +
				`  決着: ${ends || 'なし'}  未決着の局面 ${open.size} 通り`);
		}
	}
}

// test2 では、列挙で求めた確率が、段階Dの手計算と一致するかを確かめている。
// ギャラドスの HP が 160 のとき、くさむすびで倒せる確率は (23/24)×(7/16) + (1/24)×(16/16) = 177/384 になるはずである。
// この局面では、倒せなければたきのぼりで HP1 のピカチュウが倒されるので、1ターン後の p1 の勝率が、そのまま倒せる確率と等しくなる。
function test2ExactProbability() {
	const battle = POSITIONS.gk160();
	let p1Win = 0;
	enumerateTurn(serialize(battle), 'move 2', 'move 1', leaf => {
		if (leaf.battle.winner === 'Alice') p1Win += leaf.prob;
	});
	console.log(`\ntest2 HP160 のギャラドスをくさむすびで倒す確率: 列挙 ${p1Win.toFixed(12)} / 手計算 177/384 = ${(177 / 384).toFixed(12)}`);
}

// test3 では、結果が予想できる局面を使って、確定勝ちの判定を確かめている。
function test3Solve() {
	const cases = [
		// まひの局面では、10まんボルトを選べば、ギャラドスがしびれるかどうかに関係なく1ターンで勝てるはずだと考えている。
		['par', 1],
		// タスキの局面では、どちらの手を選んでも p2 が勝つ枝が残るので、何ターン読んでも確定勝ちにはならないと予想している。
		['sash', 1], ['sash', 3],
		// ガブリアスはギャラドスにダメージを与えることができない。たきのぼり1発のダメージを列挙して確かめたところ、
		// 急所なしで 145〜172、急所ありで 219〜258 という結果になった。急所なしの2発では最大でも 344 で 357HP に届かないが、
		// 3発なら最小でも 435 になる。
		// そのため、1〜2ターンでは証明できず、3ターン読んだところで初めて確定勝ちになると予想している。
		// こおりのキバは命中95%なので、外れが続く枝がいつまでも残り、何ターン読んでも確定勝ちにはならないはずである。
		['chomp', 1], ['chomp', 2], ['chomp', 3],
	];
	console.log('\ntest3 確定勝ちの判定');
	for (const [name, depth] of cases) {
		const { rows, stats, seconds } = explain(POSITIONS[name](), depth);
		// 表示している数は、1ターンを処理した回数と、2ターン目以降で solve を呼んだ局面の数と、
		// cache に覚えた結果を使い回した回数の3つになっている。
		console.log(`\n  局面 ${name} / ${depth} ターン以内  （${seconds.toFixed(1)} 秒、ターン処理 ${stats.turnSimulations} 回、` +
			`2ターン目以降に読んだ局面 ${stats.nodes} 個、結果の使い回し ${stats.cacheHits} 回）`);
		for (const row of rows) {
			console.log(`    p1 ${row.p1.padEnd(24)} ${row.proven ? '確定勝ち' : '確定勝ちではない'}`);
			if (row.counterexample) console.log(`       負け筋の例: ${row.counterexample}`);
		}
	}
}

module.exports = {
	POSITIONS, makePosition, serialize, restore, stateKey,
	installPatch, uninstallPatch, ScriptedPRNG, enumerateTurn, describeLeaf,
	legalChoices, choiceLabel, solve, explain, newStats,
};

if (require.main === module) {
	installPatch();
	test0PatchIsTransparent();
	test1CountBranches();
	test2ExactProbability();
	test3Solve();
}

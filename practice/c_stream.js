// 段階C: BattleStream で自分で手を送って1戦する
// 実行: node practice/c_stream.js   （詰めポケ/ フォルダで）
//
// 登場する流れ:
//   ターン1: ピカチュウ(遅い) vs スカーフガブリアス(速い) → じしんでピカチュウが倒れる
//   → p1 に「交代しかできない request（forceSwitch）」が届く
//   ターン2: ギャラドスに交代。ガブリアスはこだわりスカーフで じしん 固定なのに、
//           わざと ドラゴンクロー を送って |error| を起こしてみる
const { Teams, BattleStream, getPlayerStreams } = require('../pokemon-showdown');

const p1Team = Teams.import(`
Pikachu (F) @ Light Ball
Ability: Static
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot

Gyarados (M) @ Leftovers
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Waterfall
- Ice Fang
`);

const p2Team = Teams.import(`
Garchomp (F) @ Choice Scarf
Ability: Rough Skin
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
`);

const streams = getPlayerStreams(new BattleStream());

// ---- 1. 全体ログ（omniscient = 全部見える視点）------------------------------
// mainBattleDone: 本編の対戦が終わるまで練習問題(3節)の対戦を始めないための合図
const mainBattleDone = (async () => {
	for await (const chunk of streams.omniscient) {
		console.log(chunk.split('\n').map(l => `  [全体] ${l}`).join('\n'));
		// 注意: chunk.includes('|tie') だと "|tier|[Gen 9] Custom Game" にも一致してしまい、開始直後に終了する。
		// ログは必ず行単位・コマンド名単位で判定すること
		const cmds = chunk.split('\n').map(l => l.split('|')[1]);
		if (cmds.includes('win') || cmds.includes('tie')) void streams.omniscient.writeEnd();
	}
})();

// ---- 2. プレイヤー: request が来たら、用意した手を順番に送る ----------------
// choices は「送る手のキュー」。request か error が来るたびに先頭から1つ使う。
function scriptedPlayer(id, stream, choices) {
	const send = why => {
		const choice = choices.shift() ?? 'default';
		console.log(`>>> ${id} が送信: "${choice}"  (${why})`);
		void stream.write(choice);
	};
	void (async () => {
		for await (const chunk of stream) {
			for (const line of chunk.split('\n')) {
				if (line.startsWith('|request|')) {
					const req = JSON.parse(line.slice('|request|'.length));
					// request には3種類ある
					if (req.wait) continue; // 相手の交代待ち。何も送らない
					if (req.teamPreview) { send('teamPreview'); continue; }
					if (req.forceSwitch) { send(`forceSwitch ${JSON.stringify(req.forceSwitch)}`); continue; }
					const moves = req.active[0].moves.map(m => `${m.move}${m.disabled ? '(使用不可)' : ''}`);
					send(`通常の request: 技=${moves.join(', ')}`);
				} else if (line.startsWith('|error|')) {
					console.log(`!!! ${id} にエラー: ${line}`);
					// [Invalid choice]     → 新しい request は来ない。こちらから送り直す
					// [Unavailable choice] → 直後に新しい |request| が届くので、そちらで送る（ここで送ると二重送信になる）
					if (line.startsWith('|error|[Invalid choice]')) send('エラー後の再送');
				} else if (id === 'p2' && line.startsWith('|-damage|')) {
					// プレイヤー視点では、相手のHPは割合（/100）でしか見えない
					console.log(`  [p2視点] ${line}`);
				}
			}
		}
	})();
}

scriptedPlayer('p1', streams.p1, ['team 12', 'move Thunderbolt', 'switch 2', 'move Ice Fang', 'move Ice Fang']);
scriptedPlayer('p2', streams.p2, ['team 1', 'move Earthquake', 'move Dragon Claw', 'move Earthquake', 'move Earthquake']);

// 注意: formatid が gen9customgame だと、フォーマット設定の debug:true により reportExactHP が有効になり、
// 相手視点でも HP が実数で見える（sim/battle.ts の reportExactHP, sim/pokemon.ts の getHealth）。
// gen9ou などにすると相手のHPは "88/100" のような割合になる。

void streams.omniscient.write(`>start {"formatid":"gen9customgame","seed":[1,2,3,4]}
>player p1 {"name":"Alice","team":"${Teams.pack(p1Team)}"}
>player p2 {"name":"Bob","team":"${Teams.pack(p2Team)}"}`);

// ---- 3. 練習問題 ------------------------------------------------------------
//
// 3-1. なぜ |-ability|...Intimidate|boost が |turn|2 より前に出るのか（PROTOCOL.md参照）
//   ピカチュウが倒れた後の「交代」は turn 1 の中の後始末（faintの結果としてのforceSwitch）であって、
//   turn 2 そのものではない。ギャラドスが場に出た瞬間に特性Intimidateが即座に発動し、
//   その結果（-unboost）まで解決してからようやく「次のターンの選択を受け付ける」合図として
//   |turn|2 が送られる。つまり |turn|N はターン番号の表示ではなく「これから行動選択フェーズに
//   入る」の合図で、場に出た瞬間に発動する効果（特性・とくせい起動型アイテムなど）は
//   必ずそれより前に解決済みになる。
//
//   sim/SIM-PROTOCOL.md の定義:
//   - Major actions（227行目〜）: `|ACTION|POKEMON|DETAILS` の形。|move| や |switch| など
//     「何をしたか」という主要な出来事そのもの。クライアントでは通常サイズで表示される。
//   - Minor actions（308行目〜）: 先頭に `-` が付く。ダメージ・能力ランク変化・特性発動など、
//     主要な行動に付随する「結果・効果」。クライアントでは小さいフォントで表示される。
//   → |move|p1a: Gyarados|Ice Fang|p2a: Garchomp は major、続く |-supereffective| や
//     |-damage| はその move が引き起こした minor。|-ability|...Intimidate|boost も
//     「switchという行動の結果として特性が起きた」ので minor 扱い。
//
// 3-2. p2の最初の手を 'move 3'（存在しない技番号）にすると？
const q2Done = mainBattleDone.then(() => {
	console.log('\n=== 3-2. 無効な技番号を送った場合 ===');
	const streamsQ2 = getPlayerStreams(new BattleStream());
	const done = (async () => {
		for await (const chunk of streamsQ2.omniscient) {
			const cmds = chunk.split('\n').map(l => l.split('|')[1]);
			if (cmds.includes('win') || cmds.includes('tie')) void streamsQ2.omniscient.writeEnd();
		}
	})();
	scriptedPlayer('p1(Q2)', streamsQ2.p1, ['team 12', 'move Thunderbolt', 'switch 2', 'move Ice Fang', 'move Ice Fang']);
	// 最初の手を 'move 3' に変更（Garchompは技を2つしか持たないので存在しない番号）
	scriptedPlayer('p2(Q2)', streamsQ2.p2, ['team 1', 'move 3', 'move Dragon Claw', 'move Earthquake', 'move Earthquake']);
	void streamsQ2.omniscient.write(`>start {"formatid":"gen9customgame","seed":[1,2,3,4]}
>player p1 {"name":"Alice","team":"${Teams.pack(p1Team)}"}
>player p2 {"name":"Bob","team":"${Teams.pack(p2Team)}"}`);
	return done;
});
// → 出るのは [Invalid choice]（[Unavailable choice] ではない）。
//   理由: [Unavailable choice] は「今のrequestの範囲では選べない手」（今回のDragon Clawのような、
//   こだわりロックで一時的に選べない技）に対して出る。それに対し 'move 3' はrequestの技リストと
//   無関係に「そもそも存在しない技番号」を送っているため、requestを再送してもらう必要がなく、
//   同じrequestに対してこちらが送り直せばよい[Invalid choice]になる。
//   scriptedPlayer は [Invalid choice] のときだけ choices.shift() して送り直す作りなので、
//   ここでも正しく1回だけ再送し、1ターンに2回送ってしまうことはない
//   （ただしキューの先頭が1つ消費されるので、後続の手の対応がひとつズレる点には注意）。

// 3-3. seedを20通り変えて、turn2の こおりのキバ 直後のガブリアスのHPを集計する
async function runForHp(seed) {
	const streamsQ3 = getPlayerStreams(new BattleStream());
	let hp = null;
	let winner = null;
	const done = (async () => {
		for await (const chunk of streamsQ3.omniscient) {
			let sawIceFang = false;
			for (const line of chunk.split('\n')) {
				if (line.startsWith('|move|p1a: Gyarados|Ice Fang')) sawIceFang = true;
				if (sawIceFang && hp === null && line.startsWith('|-damage|p2a: Garchomp|')) {
					hp = line.split('|')[3]; // 例: "17/357" または "0 fnt"
				}
				if (line.startsWith('|win|')) winner = line.split('|')[2];
			}
			const cmds = chunk.split('\n').map(l => l.split('|')[1]);
			if (cmds.includes('win') || cmds.includes('tie')) void streamsQ3.omniscient.writeEnd();
		}
	})();
	// このQ3専用ループでは |error| ログを表示しないよう、scriptedPlayerではなく簡易版で送る
	for (const [stream, choices] of [
		[streamsQ3.p1, ['team 12', 'move Thunderbolt', 'switch 2', 'move Ice Fang', 'move Ice Fang']],
		[streamsQ3.p2, ['team 1', 'move Earthquake', 'move Dragon Claw', 'move Earthquake', 'move Earthquake']],
	]) {
		void (async () => {
			for await (const chunk of stream) {
				for (const line of chunk.split('\n')) {
					if (line.startsWith('|request|')) {
						const req = JSON.parse(line.slice('|request|'.length));
						if (req.wait) continue;
						void stream.write(choices.shift() ?? 'default');
					} else if (line.startsWith('|error|[Invalid choice]')) {
						void stream.write(choices.shift() ?? 'default');
					}
				}
			}
		})();
	}
	void streamsQ3.omniscient.write(`>start {"formatid":"gen9customgame","seed":[${seed.join(',')}]}
>player p1 {"name":"Alice","team":"${Teams.pack(p1Team)}"}
>player p2 {"name":"Bob","team":"${Teams.pack(p2Team)}"}`);
	await done;
	return { hp, winner };
}

void (async () => {
	await q2Done;
	console.log('\n=== 3-3. seed違いによるターン2終了時のガブリアスHP ===');
	const results = [];
	for (let s = 1; s <= 20; s++) {
		const seed = [s, (s * 7) % 65536, (s * 13) % 65536, (s * 101) % 65536];
		results.push(await runForHp(seed));
	}
	console.log('ターン2直後のHP一覧:', results.map(r => r.hp));
	console.log('20サンプル中で観測されたHPの種類数:', new Set(results.map(r => r.hp)).size);
	console.log('ターン2では倒せなかった seed 数:', results.filter(r => !r.hp.startsWith('0')).length, '/', results.length);
	console.log('最終的にp1(Alice)が勝てなかった seed:', results.filter(r => r.winner !== 'Alice').length, '個');
	// → 注意: これは「20個のseedをサンプリングした結果」であり、それ自体は詰みの証明にならない。
	//
	//   標本は証明にならない: 5%程度でしか起きない分岐（急所や命中判定の端）は20回では
	//   1度も出ないことがよくある。「HPの種類数」も、本当の分布の種類数ではなく
	//   「20サンプルの中でたまたま観測できた種類数」でしかない。本当に確認するには、
	//   ダメージ乱数16段階×急所×命中×追加効果（凍結など）を漏れなく列挙する必要がある。
	//
	//   相手の手を固定している: ポケモンは同時手番のゲームなので、詰みとは
	//   「相手がどの手を選んでも勝てる」ことのはず。seedを回すだけでは、p2の手を
	//   （こだわりロックで選ばされる）「じしん」に固定して調べたことにしかならない。
	//
	//   この局面でp1が必ず勝つ本当の理由は乱数ではなく構造にある: ガブリアスは
	//   こだわりスカーフで じしん（じめんタイプ）に固定されていて、ひこう複合の
	//   ギャラドスには絶対に当たらない（無効）。つまりp2には有効な手が1つもない。
	//   だから、こおりのキバが外れても（命中率<100%）ただ打ち直すだけで済み、
	//   ガブリアスから一方的に攻撃され続けるリスクが構造的に存在しない。
	//
	//   「全ての相手の手 × 全ての乱数の結果」を漏れなく確認するには、局面を複製して
	//   一つずつ試す仕組み（Battleの直接操作、toJSON/fromJSON）が必要になる（段階D・E）。
})();

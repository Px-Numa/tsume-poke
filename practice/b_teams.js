// 段階B: チームを文字列で書き、指定した構成で対戦を始める
// 実行: node practice/b_teams.js   （詰めポケ/ フォルダで）
const { Teams, TeamValidator, BattleStream, getPlayerStreams } = require('../pokemon-showdown');

// ---- 1. Export形式（人間が読み書きする形式）で書く ------------------------
// 対戦サイトのチームビルダーでエクスポートした文字列そのまま。詰め問題の局面もこの形で書くと読みやすい。
const p1Export = `
Pikachu @ Light Ball
Ability: Static
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot
`;

const p2Export = `
Garchomp @ Choice Scarf
Ability: Rough Skin
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
`;

// ---- 2. 3つの形式を相互変換する ------------------------------------------
// Export文字列 --import--> JSON(PokemonSet[]) --pack--> Packed文字列
const p1Team = Teams.import(p1Export);
const p2Team = Teams.import(p2Export);
console.log('=== 2a. JSON形式（プログラムで扱う形）===');
console.log(JSON.stringify(p1Team, null, 2));
console.log('\n=== 2b. Packed形式（シミュレータに渡す・ログに残す形）===');
console.log(Teams.pack(p1Team));
console.log('\n=== 2c. Export形式に戻す ===');
console.log(Teams.export(Teams.unpack(Teams.pack(p2Team))));

// ---- 3. バリデーション ----------------------------------------------------
// シミュレータ自体はチームを検証しない（>player に渡したものをそのまま使う）。
// 合法かどうかは TeamValidator で別途確認する。戻り値は「問題点の配列」または null（合法）。
console.log('=== 3. validator ===');
const validator = new TeamValidator('gen9ou');
console.log('p1 gen9ou:', validator.validateTeam(p1Team));

// ---- 4. 作ったチームで対戦を始める ---------------------------------------
// formatid は検証なしの "Custom Game" を使う。ただし Team Preview ルールは入っているので、
// >p1 team 1 / >p2 team 1（先頭にするポケモンの番号）を送らないとターン1が始まらない。
const streams = getPlayerStreams(new BattleStream());

void (async () => {
	for await (const chunk of streams.omniscient) {
		console.log('\n=== 4a. omniscient ===');
		console.log(chunk);
	}
})();

// p1 視点には「今どんな手を選べるか」を表す |request| が JSON で届く（段階Cで詳しく読む）
void (async () => {
	for await (const chunk of streams.p1) {
		for (const line of chunk.split('\n')) {
			if (!line.startsWith('|request|')) continue;
			const req = JSON.parse(line.slice('|request|'.length));
			if (!req.active) continue; // チーム選択時のrequestは飛ばす
			console.log('\n=== 4b. p1 request（ターン1の選択肢）===');
			console.log('技:', req.active[0].moves.map(m => `${m.move} ${m.pp}/${m.maxpp}`));
			console.log('実数値:', req.side.pokemon[0].condition, req.side.pokemon[0].stats);
			void streams.omniscient.writeEnd(); // ここで終了（まだ手は送らない）
		}
	}
})();

void streams.omniscient.write(`>start {"formatid":"gen9customgame","seed":[1,2,3,4]}
>player p1 {"name":"Alice","team":"${Teams.pack(p1Team)}"}
>player p2 {"name":"Bob","team":"${Teams.pack(p2Team)}"}
>p1 team 1
>p2 team 1`);

// ---- 5. 練習問題 ------------------------------------------------------------
// 対戦を1回行って、p1の開始直後のswitchログ（性別・実数値）とバリデータ結果を返す小さなヘルパー。
// gender/追加技/レベル変更の3パターンを試すためにまとめる。
async function runP1Once({ seed = [1, 2, 3, 4], extraMoves = [], level = null } = {}) {
	const p1ExportEx = `
Pikachu @ Light Ball
Ability: Static
${level ? `Level: ${level}\n` : ''}EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Grass Knot
${extraMoves.map(m => `- ${m}`).join('\n')}
`;
	const teamEx = Teams.import(p1ExportEx);
	const errors = validator.validateTeam(teamEx);

	const streamsEx = getPlayerStreams(new BattleStream());
	let switchLine = null;
	const done = (async () => {
		for await (const chunk of streamsEx.omniscient) {
			for (const line of chunk.split('\n')) {
				if (line.startsWith('|switch|p1a')) switchLine = line;
			}
			if (chunk.includes('|turn|1')) void streamsEx.omniscient.writeEnd();
		}
	})();

	void streamsEx.omniscient.write(`>start {"formatid":"gen9customgame","seed":[${seed.join(',')}]}
>player p1 {"name":"Alice","team":"${Teams.pack(teamEx)}"}
>player p2 {"name":"Bob","team":"${Teams.pack(p2Team)}"}
>p1 team 1
>p2 team 1`);

	await done;
	return { errors, switchLine };
}

void (async () => {
	// --- 5-1. seedを変えると性別が変わる -----------------------------------
	// p1Export は性別を指定していないので、gender はチーム読み込み時ではなく
	// 対戦開始時に battle.sample(['M','F'])（＝seedで決まるPRNG、sim/pokemon.ts）で決まる。
	// → 詰め問題の局面を再現するなら、seed任せにせず p1Export 側で性別を明示する
	//   （例: 種族名の直後に "Pikachu, F @ Light Ball" のように書く）のが正しい対処。
	console.log('\n=== 5-1. seed違いで性別が変わる ===');
	console.log('seed [1,2,3,4]:', (await runP1Once({ seed: [1, 2, 3, 4] })).switchLine);
	console.log('seed [5,6,7,8]:', (await runP1Once({ seed: [5, 6, 7, 8] })).switchLine);

	// --- 5-2. Spore を追加 ---------------------------------------------------
	// Pikachuは本来Sporeを覚えられず、Sleep Moves Clauseでも禁止されるためvalidatorはエラーを返す。
	// ただしCustom Gameはバリデーションをしないので、対戦（手順4）自体は問題なく始まる。
	console.log('\n=== 5-2. PikachuにSporeを追加 ===');
	const spore = await runP1Once({ extraMoves: ['Spore'] });
	console.log('validator.validateTeam:', spore.errors);
	console.log('対戦は始まるか:', spore.switchLine ? `始まる → ${spore.switchLine}` : '始まらない');

	// --- 5-3. Level: 50 を追加 ------------------------------------------------
	// HP実数値 = floor((2*種族値+個体値+floor(努力値/4))*Lv/100) + Lv + 10
	// ピカチュウのHP種族値=35、IV=31（省略時デフォルト）、EV=0（HPには振っていない）、Lv=50
	console.log('\n=== 5-3. Level: 50 を追加した場合のHP ===');
	const lv50 = await runP1Once({ level: 50 });
	console.log('実際の実数値:', lv50.switchLine);
	const base = 35, iv = 31, ev = 0, lv = 50;
	const expectedHP = Math.floor((2 * base + iv + Math.floor(ev / 4)) * lv / 100) + lv + 10;
	console.log('計算式（floor((2*35+31+floor(0/4))*50/100)+50+10）の期待値:', expectedHP);
})();

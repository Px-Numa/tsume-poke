'use strict';
// 問題を作るルールの一覧と、いま使うルールの決め方。
//
// ルールは「PS のどのデータを使うか（mod）」「技の候補をどのランダムバトルの型から取るか（sets）」
// 「PS と突き合わせるときの対戦形式（format）」「メガシンカした姿を候補に入れるか（megas）」の組で表す。
// speciesClause は、同じポケモン（メガシンカした姿と元の姿も同じとみなす）を同じ側に2匹入れないかどうか。
// megaLimit は、同じ側に入れられるメガシンカした姿の数（null なら制限なし）。
// 対戦の計算は engine.js で行うので、ここに足せるのは第9世代と同じ仕組みのルールだけになる。
// 足したルールは verify_damage.js と verify_turn.js で PS と一致するのを確かめてから使う。
//
// いま使うルールは環境変数 TSUMEPOKE_RULE と TSUMEPOKE_MEGAS で決める。
// コマンドでは各スクリプトの先頭で readRuleArgs() を呼び、--rule と --megas / --no-megas を環境変数に移す。

const RULES = {
	gen9: {
		label: '第9世代（Ver1 と同じ）',
		mod: 'gen9',
		sets: 'data/random-battles/gen9/sets.json',
		format: 'gen9customgame',
		megas: false,
		speciesClause: false,
		megaLimit: null,
		verified: true,
	},
	champions: {
		label: 'ポケモンチャンピオンズ',
		mod: 'champions',
		sets: 'data/random-battles/champions/sets.json',
		format: 'gen9championscustomgame',
		megas: true,
		speciesClause: true,
		megaLimit: 1,
		verified: true,
	},
};

const DEFAULT_RULE = 'champions';

// コマンドの引数から --rule、--megas、--no-megas を取り除き、環境変数に移す。
function readRuleArgs() {
	const argv = process.argv;
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--rule') {
			process.env.TSUMEPOKE_RULE = argv[i + 1];
			argv.splice(i, 2);
			i--;
		} else if (argv[i] === '--megas' || argv[i] === '--no-megas') {
			process.env.TSUMEPOKE_MEGAS = argv[i] === '--megas' ? '1' : '0';
			argv.splice(i, 1);
			i--;
		}
	}
}

// いま使うルールを返す。tag はファイル名に使う名前で、メガシンカの扱いが初期値と違うときは印を付ける。
function currentRule() {
	const id = process.env.TSUMEPOKE_RULE || DEFAULT_RULE;
	const base = RULES[id];
	if (!base) throw new Error(`知らないルールです：${id}（使えるのは ${Object.keys(RULES).join(', ')}）`);
	if (!base.verified) throw new Error(`ルール ${id} は PS との突き合わせが済んでいない`);
	const env = process.env.TSUMEPOKE_MEGAS;
	const megas = env === undefined ? base.megas : env === '1';
	const tag = id + (megas === base.megas ? '' : megas ? '_megas' : '_nomegas');
	return { id, ...base, megas, tag };
}

module.exports = { RULES, DEFAULT_RULE, readRuleArgs, currentRule };

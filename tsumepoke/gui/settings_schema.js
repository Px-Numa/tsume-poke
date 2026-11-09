'use strict';
// 設定項目の一覧。設定画面はこの一覧から作る。項目を足すときはここに1つ足す。
//
// 各項目：
//   key：設定の名前。group：設定画面の見出し。label、help：設定画面に出す文
//   type：'bool'、'select'（options が要る）、'number'（min、max）、'text'
//   default：初期値
//   requires：エンジンの features の名前。そのエンジンが対応していなければ、設定画面で灰色にして効かなくする
//   scope：'experiment' は実験の条件（記録に写す）、'display' は見た目だけの設定
// ブラウザでもそのまま読めるように、Node の module.exports とブラウザの window の両方に出す。

(function (root) {
	// 画面のフォントの候補。query は Google Fonts の css2 の family= に渡す値で、null は読み込まない。
	const FONTS = [
		{ key: 'zenmaru', label: 'Zen Maru Gothic（丸ゴシック、やわらかい）', family: 'Zen Maru Gothic', query: 'Zen+Maru+Gothic:wght@400;700' },
		{ key: 'mplusrounded', label: 'M PLUS Rounded 1c（丸ゴシック、すっきり）', family: 'M PLUS Rounded 1c', query: 'M+PLUS+Rounded+1c:wght@400;700' },
		{ key: 'kosugimaru', label: 'Kosugi Maru（丸ゴシック、太さは1つだけ）', family: 'Kosugi Maru', query: 'Kosugi+Maru' },
		{ key: 'kiwimaru', label: 'Kiwi Maru（丸みのある明朝寄り、手書きに近い）', family: 'Kiwi Maru', query: 'Kiwi+Maru:wght@400;500' },
		{ key: 'bizud', label: 'BIZ UDPゴシック（読みやすさを重視したユニバーサルデザイン）', family: 'BIZ UDPGothic', query: 'BIZ+UDPGothic:wght@400;700' },
		{ key: 'notosans', label: 'Noto Sans JP（標準的なゴシック）', family: 'Noto Sans JP', query: 'Noto+Sans+JP:wght@400;700' },
		{ key: 'mplus2', label: 'M PLUS 2（ゴシック、明るい印象）', family: 'M PLUS 2', query: 'M+PLUS+2:wght@400;700' },
		{ key: 'zenkaku', label: 'Zen Kaku Gothic New（ゴシック、落ち着いた印象）', family: 'Zen Kaku Gothic New', query: 'Zen+Kaku+Gothic+New:wght@400;700' },
		{ key: 'murecho', label: 'Murecho（ゴシック、細身で軽い）', family: 'Murecho', query: 'Murecho:wght@400;700' },
		{ key: 'sawarabi', label: 'さわらびゴシック（ゴシック、太さは1つだけ）', family: 'Sawarabi Gothic', query: 'Sawarabi+Gothic' },
		{ key: 'mochiy', label: 'Mochiy Pop One（ポップで太い、長い文は読みにくい）', family: 'Mochiy Pop One', query: 'Mochiy+Pop+One' },
		{ key: 'rocknroll', label: 'RocknRoll One（ポップ、長い文は読みにくい）', family: 'RocknRoll One', query: 'RocknRoll+One' },
		{ key: 'system', label: 'Windows の標準（Yu Gothic UI など、読み込まない）', family: null, query: null },
	];

	const SETTINGS = [
		// 問題の画面：ポケモンの情報
		{ key: 'showHpNumbers', group: '問題の画面：ポケモン', label: 'HP を数値で出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showHpBar', group: '問題の画面：ポケモン', label: 'HP をバーで出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showHpPercent', group: '問題の画面：ポケモン', label: 'HP を割合（%）でも出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'showTypes', group: '問題の画面：ポケモン', label: 'タイプを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSpeed', group: '問題の画面：ポケモン', label: '素早さの値を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSpeedOrder', group: '問題の画面：ポケモン', label: '場のポケモンどうしでどちらが先に動くかを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showAllStats', group: '問題の画面：ポケモン', label: 'すべての能力値（攻撃・防御など）を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'showLevel', group: '問題の画面：ポケモン', label: 'レベルを出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showOpponentMoves', group: '問題の画面：ポケモン', label: '相手の場のポケモンの技を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showBench', group: '問題の画面：ポケモン', label: '控えのポケモンを並べて出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'benchTooltip', group: '問題の画面：ポケモン', label: '控えのポケモンにマウスを乗せると詳しい情報を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'fontFamily', group: '問題の画面：ポケモン', label: '画面の文字のフォント', type: 'select', options: FONTS.map(f => [f.key, f.label]), default: 'zenmaru', scope: 'display', help: 'system 以外は Google Fonts から読み込む。インターネットにつながらないときは Windows の標準のフォントになる。選ぶとすぐ画面に反映し、保存しないで閉じると元に戻る。' },
		{ key: 'roundCorners', group: '問題の画面：ポケモン', label: 'ボタンや枠の角を丸くする', type: 'bool', default: false, scope: 'display', help: 'OFF のときは四角い角にする。' },
		{ key: 'showNoBenchNote', group: '問題の画面：ポケモン', label: '控えのポケモンがいないときに「控えなし」と出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSprites', group: '問題の画面：ポケモン', label: 'ポケモンの画像を出す（public/sprites に画像があるときだけ）', type: 'bool', default: true, scope: 'display', help: '画像がないポケモンはタイプの色の丸と名前の頭文字で出す。' },
		{ key: 'showSpriteIcons', group: '問題の画面：ポケモン', label: '控えと交代のボタン、ダメージ表、詳しい説明にも小さい画像を出す（画像を出さないときはタイプの色の丸と頭文字）', type: 'bool', default: true, scope: 'display' },
		{ key: 'spriteBackForMe', group: '問題の画面：ポケモン', label: '自分のポケモンは背面の画像にする', type: 'bool', default: true, scope: 'display', help: 'public/sprites/back に画像があるときだけ。' },
		{ key: 'showStatus', group: '問題の画面：ポケモン', label: '状態異常を出す', type: 'bool', default: true, scope: 'experiment', requires: 'status' },
		{ key: 'showAbility', group: '問題の画面：ポケモン', label: '特性を出す', type: 'bool', default: true, scope: 'experiment', requires: 'abilities' },
		{ key: 'showItem', group: '問題の画面：ポケモン', label: '持ち物を出す', type: 'bool', default: true, scope: 'experiment', requires: 'items' },
		{ key: 'showBoosts', group: '問題の画面：ポケモン', label: '能力ランクの変化を出す', type: 'bool', default: true, scope: 'experiment', requires: 'boosts' },
		{ key: 'showField', group: '問題の画面：ポケモン', label: '天候とフィールドを出す', type: 'bool', default: true, scope: 'experiment', requires: 'weather' },

		// 問題の画面：技とダメージ
		{ key: 'showDamageOnMoves', group: '問題の画面：技とダメージ', label: '技のボタンに相手の場のポケモンへのダメージを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'damageFormat', group: '問題の画面：技とダメージ', label: 'ダメージの出し方', type: 'select', options: [['both', '数値と割合'], ['number', '数値だけ'], ['percent', '割合だけ']], default: 'both', scope: 'experiment' },
		{ key: 'showDamageBar', group: '問題の画面：技とダメージ', label: '受ける側の HP バーにダメージを重ねた図も出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showOpponentDamage', group: '問題の画面：技とダメージ', label: '相手の技にあなたの場のポケモンへのダメージを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showMoveDetails', group: '問題の画面：技とダメージ', label: '技の威力・分類・優先度を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showMoveAccuracy', group: '問題の画面：技とダメージ', label: '技の命中率を出す', type: 'bool', default: true, scope: 'experiment', requires: 'accuracy' },
		{ key: 'showMoveDescription', group: '問題の画面：技とダメージ', label: '技にマウスを乗せると説明文（英語）を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'markKO', group: '問題の画面：技とダメージ', label: '倒せるダメージに印を付ける', type: 'bool', default: false, scope: 'experiment', help: '付けると読む手間が減るので、問題の難しさが変わる。' },
		{ key: 'clickBenchToRetarget', group: '問題の画面：技とダメージ', label: '相手の控えをクリックすると、技のボタンのダメージをそのポケモンへの値に切り替える', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'clickMyBenchToRetarget', group: '問題の画面：技とダメージ', label: '自分の控えをクリックすると、相手の技のダメージをそのポケモンが受けたときの値に切り替える', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'enableDamageTable', group: '問題の画面：技とダメージ', label: 'ダメージ表（全ポケモンの全技 × 相手の全ポケモン）を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'damageTableReverse', group: '問題の画面：技とダメージ', label: 'ダメージ表で、相手からあなたへの向きも見られるようにする', type: 'bool', default: true, scope: 'experiment' },

		// 問題の画面：進行
		{ key: 'gameLayout', group: '問題の画面：進行', label: '問題の画面の配置', type: 'select', options: [['wide', '横長（16:9）：場の下に操作の欄を置き、右にログを置いて1画面に収める'], ['stack', '縦長：場の下に操作を置き、下へスクロールする']], default: 'wide', scope: 'display' },
		{ key: 'fieldSize', group: '問題の画面：進行', label: '横長の配置での場の大きさ', type: 'select', options: [['compact', '小さめ：Showdown と同じくらい（幅640×高さ360）'], ['fill', '大きめ：画面の高さいっぱいに広げる']], default: 'compact', scope: 'display' },
		{ key: 'stageScale', group: '問題の画面：進行', label: '小さめの場のとき、ログ以外の部分の倍率', type: 'select', options: [['auto', '自動：画面の高さと幅に合わせて拡大・縮小する'], ['100', '100%（Showdown と同じくらい）'], ['125', '125%'], ['150', '150%']], default: 'auto', scope: 'display', help: '場と相手の欄と操作の欄を、縦横比を変えずにまとめて拡大する。文字と画像も同じ倍率で拡大される。' },
		{ key: 'scaleOtherText', group: '問題の画面：進行', label: 'ログ以外の部分を拡大したときは見出しとログと上の帯の文字も同じ倍率で拡大する', type: 'bool', default: true, scope: 'display' },
		{ key: 'fitFieldToScreen', group: '問題の画面：進行', label: '横長の配置で場が画面の高さに収まらないときは縮めて出す', type: 'bool', default: true, scope: 'display', help: 'OFF にすると場の中をスクロールして見る。' },
		{ key: 'showTurnCounter', group: '問題の画面：進行', label: '残りのターン数を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showAttemptCount', group: '問題の画面：進行', label: '何回目の挑戦かを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showTimer', group: '問題の画面：進行', label: '経過時間を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'timeLimitSec', group: '問題の画面：進行', label: '1問の制限時間（秒）。0 なら制限なし', type: 'number', min: 0, max: 3600, default: 0, scope: 'experiment', help: '時間を過ぎたらあきらめたものとして解答を出す。' },
		{ key: 'showBattleLog', group: '問題の画面：進行', label: 'バトルログを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showHitFx', group: '問題の画面：進行', label: '技が当たったときに攻撃した側を前に出し、受けた側を点滅させて減った HP の割合を出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showHpBarFx', group: '問題の画面：進行', label: 'HP バーが減っていく様子を見せる', type: 'bool', default: true, scope: 'display' },
		{ key: 'showFaintFx', group: '問題の画面：進行', label: 'ポケモンが倒れたときに画像を沈めて消し、新しく出たポケモンを現れさせる', type: 'bool', default: true, scope: 'display', help: 'OFF のときは倒れたポケモンの画像も場に残る。' },
		{ key: 'eventDelayMs', group: '問題の画面：進行', label: '1つの出来事を出す間隔（ミリ秒）', type: 'number', min: 0, max: 3000, default: 500, scope: 'display' },
		{ key: 'confirmAction', group: '問題の画面：進行', label: '手を選んだあとに確認を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'allowRetry', group: '問題の画面：進行', label: '失敗したらもう一度挑戦できる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'allowGiveUp', group: '問題の画面：進行', label: 'あきらめて解答を見られる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'giveUpAnytime', group: '問題の画面：進行', label: '失敗する前でもいつでもあきらめられる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'allowAnswerAfterSolve', group: '問題の画面：進行', label: '正解したあとに解答と受けを見られる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showRefutations', group: '問題の画面：進行', label: '解答の画面に正解以外の初手への相手の受けも出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'opponentPolicy', group: '問題の画面：進行', label: '相手の手の選び方', type: 'select', options: [['longest', 'あなたの勝ちを一番遅らせる手（最長の受け）'], ['random', '確実に勝てる範囲でランダム'], ['human', '人間らしい手']], default: 'longest', scope: 'experiment', requires: 'opponentPolicies', help: '今のエンジンは「最長の受け」だけに対応する。' },

		// いつでも開けるメニュー
		{ key: 'menuTypeChart', group: 'メニュー', label: 'タイプ相性表を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'menuRules', group: 'メニュー', label: 'ルールの確認を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'menuQuickGuide', group: 'メニュー', label: '問題の画面に「操作確認」ボタンを出す（各欄の役割を数秒ずつ順に見せる）', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'quickGuideStepMs', group: 'メニュー', label: '操作確認で1つの説明を自動で次へ進めるまでの時間（ミリ秒、0 のときは自動で進めない）', type: 'number', min: 0, max: 10000, default: 0, scope: 'display' },
		{ key: 'menuSettingsForParticipant', group: 'メニュー', label: '問題の画面にも設定ボタンを出す（実験の本番では切る）', type: 'bool', default: true, scope: 'display' },

		// 実験の流れ
		{ key: 'flowSurvey', group: '実験の流れ', label: '事前アンケートを行う（config/survey_items.json）', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'flowRules', group: '実験の流れ', label: 'ルールの説明を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'flowDemo', group: '実験の流れ', label: 'プレイデモで操作を紹介する', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'demoBlink', group: '実験の流れ', label: 'プレイデモで操作してほしい所の黄色い枠を点滅させる', type: 'bool', default: true, scope: 'experiment', help: 'OFF のときは枠を光らせずに出す。' },
		{ key: 'demoReplay', group: '実験の流れ', label: 'プレイデモの最後に「もう一度見る」ボタンを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'demoRingOnTop', group: '実験の流れ', label: 'プレイデモの黄色い枠をほかの物より手前に重ね、説明や吹き出しで隠れてもぼんやり光って見えるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'demoInteractive', group: '実験の流れ', label: 'プレイデモを被験者が自分でボタンを押して進めるチュートリアルにする', type: 'bool', default: true, scope: 'experiment', help: 'OFF のときは正解の手順を自動で進めて見せる。' },
		{ key: 'demoPuzzleId', group: '実験の流れ', label: 'プレイデモに使う問題の id', type: 'number', min: 0, max: 100000, default: 7, scope: 'experiment' },
		{ key: 'flowPractice', group: '実験の流れ', label: '練習問題を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'practicePuzzleIds', group: '実験の流れ', label: '練習問題の id（カンマ区切り）', type: 'text', default: '9,188', scope: 'experiment' },
		{ key: 'shuffleOrder', group: '実験の流れ', label: '本番の問題の順番を被験者ごとにシャッフルする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showProgress', group: '実験の流れ', label: '「何問目／全何問」を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showPuzzleId', group: '実験の流れ', label: '問題の id を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'breakEvery', group: '実験の流れ', label: '休憩を促す間隔（問題数）。0 なら出さない', type: 'number', min: 0, max: 100, default: 10, scope: 'experiment' },

		// 評価
		{ key: 'ratingEnabled', group: '評価', label: '1問ごとに評価してもらう（config/rating_items.json）', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'ratingRequireAll', group: '評価', label: 'すべての項目に答えるまで次へ進めない', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'ratingComment', group: '評価', label: 'コメントの欄を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'ratingShowScaleLabels', group: '評価', label: '5段階の目安の文言を出す', type: 'bool', default: true, scope: 'experiment' },

		// 記録
		{ key: 'recordUiEvents', group: '記録', label: 'メニューやダメージ表を開いたこと、控えをクリックしたことを記録する', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'recordHover', group: '記録', label: '技や控えにマウスを乗せたことも記録する（記録が多くなる）', type: 'bool', default: false, scope: 'experiment' },

		// 対戦のルール（エンジンが対応したら使う）
		{ key: 'ruleAbilities', group: '対戦のルール（エンジンが対応したら使える）', label: '特性を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'abilities' },
		{ key: 'ruleItems', group: '対戦のルール（エンジンが対応したら使える）', label: '持ち物を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'items' },
		{ key: 'ruleStatus', group: '対戦のルール（エンジンが対応したら使える）', label: '状態異常を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'status' },
		{ key: 'ruleAccuracy', group: '対戦のルール（エンジンが対応したら使える）', label: '命中率（技が外れること）を考える', type: 'bool', default: false, scope: 'experiment', requires: 'accuracy' },
		{ key: 'ruleCrit', group: '対戦のルール（エンジンが対応したら使える）', label: '急所を考える', type: 'bool', default: false, scope: 'experiment', requires: 'criticalHits' },
		{ key: 'ruleSecondary', group: '対戦のルール（エンジンが対応したら使える）', label: '確率で起こる追加効果を考える', type: 'bool', default: false, scope: 'experiment', requires: 'secondaryEffects' },
		{ key: 'ruleDamageRolls', group: '対戦のルール（エンジンが対応したら使える）', label: 'ダメージ乱数の扱い', type: 'select', options: [['fixed', '固定（あなたは最低、相手は最高）'], ['all', '16通りすべてを考える']], default: 'fixed', scope: 'experiment', requires: 'damageRolls' },
	];

	// features の値が、その項目の requires を満たすか。配列や文字列の features は、選択肢がその中にあるかで決める。
	function supported(setting, features) {
		if (!setting.requires) return true;
		const f = features[setting.requires];
		if (Array.isArray(f)) return setting.type !== 'select' || setting.options.some(([v]) => f.includes(v));
		if (typeof f === 'string') return setting.type !== 'select' || setting.options.some(([v]) => v === f);
		return Boolean(f);
	}

	// select の選択肢のうち、エンジンが対応しているものだけを返す。
	function supportedOptions(setting, features) {
		const f = features[setting.requires];
		if (Array.isArray(f)) return setting.options.filter(([v]) => f.includes(v));
		if (typeof f === 'string') return setting.options.filter(([v]) => v === f);
		return setting.options;
	}

	// 保存された値と初期値を合わせ、エンジンが対応していない項目は初期値に戻す。
	function resolve(saved, features) {
		const out = {};
		for (const s of SETTINGS) {
			let v = saved && saved[s.key] !== undefined ? saved[s.key] : s.default;
			if (!supported(s, features)) v = s.default;
			else if (s.type === 'select' && s.requires && !supportedOptions(s, features).some(([o]) => o === v)) v = supportedOptions(s, features)[0][0];
			out[s.key] = v;
		}
		return out;
	}

	const api = { SETTINGS, FONTS, supported, supportedOptions, resolve };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.SettingsSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);

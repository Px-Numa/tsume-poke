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
	const SETTINGS = [
		// 問題の画面：ポケモンの情報
		{ key: 'showHpNumbers', group: '問題の画面：ポケモン', label: 'HP を数値で出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showHpBar', group: '問題の画面：ポケモン', label: 'HP をバーで出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showHpPercent', group: '問題の画面：ポケモン', label: 'HP を割合（%）でも出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'showTypes', group: '問題の画面：ポケモン', label: 'タイプを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSpeed', group: '問題の画面：ポケモン', label: '素早さの値を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSpeedOrder', group: '問題の画面：ポケモン', label: '場のポケモンどうしで、どちらが先に動くかを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showAllStats', group: '問題の画面：ポケモン', label: 'すべての能力値（攻撃・防御など）を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'showLevel', group: '問題の画面：ポケモン', label: 'レベルを出す', type: 'bool', default: true, scope: 'display' },
		{ key: 'showOpponentMoves', group: '問題の画面：ポケモン', label: '相手の場のポケモンの技を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showBench', group: '問題の画面：ポケモン', label: '控えのポケモンを並べて出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'benchTooltip', group: '問題の画面：ポケモン', label: '控えのポケモンにマウスを乗せると詳しい情報を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showSprites', group: '問題の画面：ポケモン', label: 'ポケモンの画像を出す（public/sprites に画像があるときだけ）', type: 'bool', default: false, scope: 'display', help: '画像がないポケモンは、タイプの色の丸と名前の頭文字で出す。' },
		{ key: 'showStatus', group: '問題の画面：ポケモン', label: '状態異常を出す', type: 'bool', default: true, scope: 'experiment', requires: 'status' },
		{ key: 'showAbility', group: '問題の画面：ポケモン', label: '特性を出す', type: 'bool', default: true, scope: 'experiment', requires: 'abilities' },
		{ key: 'showItem', group: '問題の画面：ポケモン', label: '持ち物を出す', type: 'bool', default: true, scope: 'experiment', requires: 'items' },
		{ key: 'showBoosts', group: '問題の画面：ポケモン', label: '能力ランクの変化を出す', type: 'bool', default: true, scope: 'experiment', requires: 'boosts' },
		{ key: 'showField', group: '問題の画面：ポケモン', label: '天候とフィールドを出す', type: 'bool', default: true, scope: 'experiment', requires: 'weather' },

		// 問題の画面：技とダメージ
		{ key: 'showDamageOnMoves', group: '問題の画面：技とダメージ', label: '技のボタンに、相手の場のポケモンへのダメージを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'damageFormat', group: '問題の画面：技とダメージ', label: 'ダメージの出し方', type: 'select', options: [['both', '数値と割合'], ['number', '数値だけ'], ['percent', '割合だけ']], default: 'both', scope: 'experiment' },
		{ key: 'showOpponentDamage', group: '問題の画面：技とダメージ', label: '相手の技に、あなたの場のポケモンへのダメージを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showMoveDetails', group: '問題の画面：技とダメージ', label: '技の威力・分類・優先度を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showMoveAccuracy', group: '問題の画面：技とダメージ', label: '技の命中率を出す', type: 'bool', default: true, scope: 'experiment', requires: 'accuracy' },
		{ key: 'showMoveDescription', group: '問題の画面：技とダメージ', label: '技にマウスを乗せると説明文（英語）を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'markKO', group: '問題の画面：技とダメージ', label: '倒せるダメージに印を付ける', type: 'bool', default: false, scope: 'experiment', help: '付けると読む手間が減るので、問題の難しさが変わる。' },
		{ key: 'clickBenchToRetarget', group: '問題の画面：技とダメージ', label: '相手の控えをクリックすると、技のボタンのダメージをそのポケモンへの値に切り替える', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'enableDamageTable', group: '問題の画面：技とダメージ', label: 'ダメージ表（全ポケモンの全技 × 相手の全ポケモン）を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'damageTableReverse', group: '問題の画面：技とダメージ', label: 'ダメージ表で、相手からあなたへの向きも見られるようにする', type: 'bool', default: true, scope: 'experiment' },

		// 問題の画面：進行
		{ key: 'showTurnCounter', group: '問題の画面：進行', label: '残りのターン数を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showAttemptCount', group: '問題の画面：進行', label: '何回目の挑戦かを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showTimer', group: '問題の画面：進行', label: '経過時間を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'timeLimitSec', group: '問題の画面：進行', label: '1問の制限時間（秒）。0 なら制限なし', type: 'number', min: 0, max: 3600, default: 0, scope: 'experiment', help: '時間を過ぎると、あきらめたものとして解答を出す。' },
		{ key: 'showBattleLog', group: '問題の画面：進行', label: 'バトルログを出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'eventDelayMs', group: '問題の画面：進行', label: '1つの出来事を出す間隔（ミリ秒）', type: 'number', min: 0, max: 3000, default: 500, scope: 'display' },
		{ key: 'confirmAction', group: '問題の画面：進行', label: '手を選んだあとに確認を出す', type: 'bool', default: false, scope: 'experiment' },
		{ key: 'allowRetry', group: '問題の画面：進行', label: '失敗したらもう一度挑戦できる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'allowGiveUp', group: '問題の画面：進行', label: 'あきらめて解答を見られる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'giveUpAnytime', group: '問題の画面：進行', label: '失敗する前でも、いつでもあきらめられる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'allowAnswerAfterSolve', group: '問題の画面：進行', label: '正解したあとに解答と受けを見られる', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'showRefutations', group: '問題の画面：進行', label: '解答の画面に、正解以外の初手への相手の受けも出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'opponentPolicy', group: '問題の画面：進行', label: '相手の手の選び方', type: 'select', options: [['longest', 'あなたの勝ちを一番遅らせる手（最長の受け）'], ['random', '確実に勝てる範囲でランダム'], ['human', '人間らしい手']], default: 'longest', scope: 'experiment', requires: 'opponentPolicies', help: '今のエンジンは「最長の受け」だけに対応する。' },

		// いつでも開けるメニュー
		{ key: 'menuTypeChart', group: 'メニュー', label: 'タイプ相性表を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'menuRules', group: 'メニュー', label: 'ルールの確認を開けるようにする', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'menuSettingsForParticipant', group: 'メニュー', label: '問題の画面にも設定ボタンを出す（実験の本番では切る）', type: 'bool', default: true, scope: 'display' },

		// 実験の流れ
		{ key: 'flowSurvey', group: '実験の流れ', label: '事前アンケートを行う（config/survey_items.json）', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'flowRules', group: '実験の流れ', label: 'ルールの説明を出す', type: 'bool', default: true, scope: 'experiment' },
		{ key: 'flowDemo', group: '実験の流れ', label: 'プレイデモで操作を紹介する', type: 'bool', default: true, scope: 'experiment' },
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
		{ key: 'ruleAbilities', group: '対戦のルール（エンジンが対応したら効く）', label: '特性を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'abilities' },
		{ key: 'ruleItems', group: '対戦のルール（エンジンが対応したら効く）', label: '持ち物を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'items' },
		{ key: 'ruleStatus', group: '対戦のルール（エンジンが対応したら効く）', label: '状態異常を有効にする', type: 'bool', default: false, scope: 'experiment', requires: 'status' },
		{ key: 'ruleAccuracy', group: '対戦のルール（エンジンが対応したら効く）', label: '命中率（技が外れること）を考える', type: 'bool', default: false, scope: 'experiment', requires: 'accuracy' },
		{ key: 'ruleCrit', group: '対戦のルール（エンジンが対応したら効く）', label: '急所を考える', type: 'bool', default: false, scope: 'experiment', requires: 'criticalHits' },
		{ key: 'ruleSecondary', group: '対戦のルール（エンジンが対応したら効く）', label: '確率で起こる追加効果を考える', type: 'bool', default: false, scope: 'experiment', requires: 'secondaryEffects' },
		{ key: 'ruleDamageRolls', group: '対戦のルール（エンジンが対応したら効く）', label: 'ダメージ乱数の扱い', type: 'select', options: [['fixed', '固定（あなたは最低、相手は最高）'], ['all', '16通りすべてを考える']], default: 'fixed', scope: 'experiment', requires: 'damageRolls' },
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

	const api = { SETTINGS, supported, supportedOptions, resolve };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.SettingsSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);

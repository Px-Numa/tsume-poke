'use strict';
// 被験者実験用 GUI の画面。サーバ（server.js）の API を呼んで表示する。
// 対戦の中身はサーバのアダプタが持ち、ここでは view と events を表示するだけにする。
// エンジンが対応していない要素（meta.engine.features が false）は表示しない。

const TYPE_COLORS = {
	Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C', Grass: '#7AC74C', Ice: '#96D9D6',
	Fighting: '#C22E28', Poison: '#A33EA1', Ground: '#E2BF65', Flying: '#A98FF3', Psychic: '#F95587', Bug: '#A6B91A',
	Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC', Dark: '#705746', Steel: '#B7B7CE', Fairy: '#D685AD', Stellar: '#40B5A5',
};

const S = {
	meta: null,
	settings: null,
	participant: null,
	summary: null,
	game: null,
};

// ---------- 小さな道具 ----------

function h(tag, attrs, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else if (k === 'html') el.innerHTML = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat(Infinity)) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

async function api(method, url, body) {
	const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || res.statusText);
	return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = () => document.getElementById('app');
const setting = key => S.settings[key];
const feature = key => Boolean(S.meta.engine.features[key]);

function show(...nodes) {
	stopTimer();
	closeDemo();
	app().replaceChildren(...nodes);
	window.scrollTo(0, 0);
}

function showError(e) {
	console.error(e);
	alert('エラー：' + e.message);
}

function hpColor(ratio) {
	if (ratio > 0.5) return 'var(--good)';
	if (ratio > 0.2) return 'var(--warn)';
	return 'var(--bad)';
}

function typeBadge(t) {
	return h('span', { class: 'type', style: { background: TYPE_COLORS[t.type] || '#888' } }, t.name);
}

function formatDamage(cell) {
	const pct = `${cell.percent.toFixed(1)}%`;
	const f = setting('damageFormat');
	if (f === 'number') return `${cell.damage}`;
	if (f === 'percent') return pct;
	return `${cell.damage}（${pct}）`;
}

function uiEvent(kind, detail) {
	demoNotify(kind, detail);
	if (!S.game || !setting('recordUiEvents')) return;
	if (kind.startsWith('hover') && !setting('recordHover')) return;
	api('POST', `/api/game/${S.game.meta.gameId}/ui`, { kind, detail }).catch(() => {});
}

// ---------- モーダル ----------

function openModal(title, body, onClose) {
	const root = document.getElementById('modal-root');
	const close = () => {
		back.remove();
		demoNotify('modalClose');
		if (onClose) onClose();
	};
	const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(); } },
		h('div', { class: 'modal' },
			h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'secondary', onclick: close }, '閉じる')),
			body));
	root.append(back);
	return close;
}

// ---------- 上のメニュー ----------

function renderMenu() {
	const menu = document.getElementById('menu');
	const items = [];
	if (setting('menuTypeChart')) items.push(h('button', { onclick: openTypeChart }, 'タイプ相性表'));
	if (setting('menuRules')) items.push(h('button', { onclick: openRules }, 'ルール'));
	if (S.game && setting('enableDamageTable')) items.push(h('button', { onclick: openDamageTable }, 'ダメージ表'));
	if (S.game && S.game.meta.kind !== 'demo' && setting('menuQuickGuide')) items.push(h('button', { onclick: runQuickGuide }, '操作確認'));
	if (!S.game || setting('menuSettingsForParticipant')) items.push(h('button', { onclick: openSettings }, '設定'));
	menu.replaceChildren(...items);
}

function setProgress(text) {
	document.getElementById('progress').textContent = text || '';
}

function openTypeChart() {
	uiEvent('typeChart');
	const tc = S.meta.typeChart;
	const table = h('table', { class: 'grid typechart' });
	const head = h('tr', {}, h('th', { class: 'left' }, '攻撃 ＼ 防御'),
		tc.types.map(t => h('th', { class: 'vertical', onclick: () => highlightCol(t) }, h('span', { class: 'type', style: { background: TYPE_COLORS[t] } }, tc.names[t]))));
	table.append(head);
	for (const a of tc.types) {
		const tr = h('tr', { 'data-type': a },
			h('th', { class: 'left', onclick: () => tr.classList.toggle('hl') }, h('span', { class: 'type', style: { background: TYPE_COLORS[a] } }, tc.names[a])),
			tc.types.map(d => {
				const v = tc.chart[a][d];
				const cls = v === 0 ? 'x0' : v > 1 ? 'x2' : v < 1 ? 'x05' : '';
				return h('td', { class: cls, 'data-def': d, title: `${tc.names[a]} → ${tc.names[d]}：×${v}` }, v === 1 ? '' : v === 0.5 ? '½' : v === 0.25 ? '¼' : v);
			}));
		table.append(tr);
	}
	function highlightCol(t) {
		table.querySelectorAll(`td[data-def="${t}"]`).forEach(td => td.classList.toggle('hlc'));
	}
	openModal('タイプ相性表', h('div', {},
		h('p', { class: 'muted' }, '行は技のタイプで、列は技を受けるポケモンのタイプです。赤は効果ばつぐん（×2）、青はいまひとつ（×½）、黒は効果なし（×0）を表しています。タイプが2つあるポケモンには2つの倍率を掛けた値がかかります。見出しをクリックするとその行か列を強調することができます。'),
		table));
}

function openRules() {
	uiEvent('rules');
	openModal('ルール', h('div', {}, S.meta.rules.map(r => h('div', { class: 'card' }, h('h4', { style: { margin: '0 0 6px' } }, r.title), h('div', {}, r.body)))));
}

async function openDamageTable() {
	if (!S.game) return;
	uiEvent('damageTable');
	const table = await api('GET', `/api/game/${S.game.meta.gameId}/damage`);
	const view = S.game.view;
	let dir = 0;
	const body = h('div');
	const draw = () => {
		const atkSide = view.sides[dir];
		const defSide = view.sides[1 - dir];
		const t = h('table', { class: 'grid' });
		t.append(h('tr', {}, h('th', { class: 'left' }, dir === 0 ? 'あなたのポケモン・技' : '相手のポケモン・技'),
			defSide.mons.map((m, j) => h('th', { class: (j === defSide.active ? 'activecol ' : '') + (m.hp <= 0 ? 'dim' : '') },
				spriteIcon(m), `${dir === 0 ? '相手' : 'あなた'} ${m.name}`, h('br'), h('span', { class: 'muted' }, `${j === defSide.active ? '場' : '控え'}・HP ${m.hp}/${m.maxhp}`)))));
		table[dir].forEach(({ mon, rows }) => {
			const am = atkSide.mons[mon];
			rows.forEach((cells, k) => {
				const mv = am.moves[k];
				t.append(h('tr', { class: am.hp <= 0 ? 'dim' : '' },
					h('td', { class: 'left' }, k === 0 ? spriteIcon(am) : '', k === 0 ? h('b', {}, am.name + (mon === atkSide.active ? '（場）' : '')) : '', k === 0 ? h('br') : '',
						h('span', { class: 'type', style: { background: TYPE_COLORS[mv.type] } }, mv.typeName), ' ', mv.name),
					cells.map((c, j) => h('td', { class: (j === defSide.active ? 'activecol ' : '') + (setting('markKO') && c.ko ? 'kocell' : '') },
						formatDamage(c), setting('markKO') && c.ko ? ' 倒せる' : '', dmgBar(defSide.mons[j], c)))));
			});
		});
		const tabs = setting('damageTableReverse') ? h('div', { class: 'tabs' },
			h('button', { class: dir === 0 ? 'on' : '', onclick: () => { dir = 0; draw(); uiEvent('damageTableDir', 0); } }, 'あなた → 相手'),
			h('button', { class: dir === 1 ? 'on' : '', onclick: () => { dir = 1; draw(); uiEvent('damageTableDir', 1); } }, '相手 → あなた')) : null;
		const note = h('p', { class: 'muted' }, dir === 0
			? 'あなたの技は最低乱数で計算しています。割合は受ける側の最大 HP に対する値です。'
			: '相手の技は最高乱数で計算しています。割合は受ける側の最大 HP に対する値です。');
		body.replaceChildren(...[tabs, note, t].filter(Boolean));
	};
	draw();
	openModal('ダメージ表', body);
}

// ---------- 設定 ----------

function openSettings() {
	const values = { ...S.settings };
	const features = S.meta.engine.features;
	const groups = {};
	for (const s of SettingsSchema.SETTINGS) (groups[s.group] = groups[s.group] || []).push(s);
	const body = h('div', {},
		h('p', { class: 'muted' }, `エンジン：${S.meta.engine.label}。灰色の項目はこのエンジンがまだ対応していない要素です。対応したエンジンに切り替えれば使えるようになります。保存した設定は config/settings.json に入り、被験者の記録にも写されることになっています。`),
		Object.entries(groups).map(([g, list]) => h('div', { class: 'settings-group' }, h('h4', {}, g), list.map(s => settingRow(s, values, features)))),
		h('div', { class: 'row' },
			h('button', { class: 'primary', onclick: async () => {
				try {
					S.settings = await api('POST', '/api/settings', values);
					close();
					applyFont();
					renderMenu();
					if (S.game) renderGame();
				} catch (e) { showError(e); }
			} }, '保存する'),
			h('button', { class: 'danger', onclick: async () => {
				if (!confirm('すべての設定を初期値に戻しますか？')) return;
				S.settings = await api('POST', '/api/settings/reset');
				close();
				applyFont();
				renderMenu();
				if (S.game) renderGame();
			} }, '初期値に戻す')));
	const close = openModal('設定', body, () => applyFont());
}

function settingRow(s, values, features) {
	const ok = SettingsSchema.supported(s, features);
	let input;
	if (s.type === 'bool') {
		input = h('input', { type: 'checkbox', disabled: !ok, onchange: e => { values[s.key] = e.target.checked; } });
		input.checked = Boolean(values[s.key]);
	} else if (s.type === 'select') {
		const allowed = s.requires ? SettingsSchema.supportedOptions(s, features).map(([v]) => v) : s.options.map(([v]) => v);
		input = h('select', { disabled: !ok, onchange: e => { values[s.key] = e.target.value; if (s.key === 'fontFamily') applyFont(e.target.value); } },
			s.options.map(([v, label]) => h('option', { value: v, disabled: !allowed.includes(v) }, label + (allowed.includes(v) ? '' : '（未対応）'))));
		input.value = values[s.key];
	} else if (s.type === 'number') {
		input = h('input', { type: 'number', min: s.min, max: s.max, value: values[s.key], disabled: !ok, style: { width: '90px' }, onchange: e => { values[s.key] = Number(e.target.value); } });
	} else {
		input = h('input', { type: 'text', value: values[s.key], disabled: !ok, onchange: e => { values[s.key] = e.target.value; } });
	}
	return h('div', { class: 'setting' + (ok ? '' : ' off') },
		h('div', {}, input),
		h('div', {}, s.label, ok ? '' : h('span', { class: 'unsupported' }, 'このエンジンは未対応'), s.help ? h('div', { class: 'help' }, s.help) : null,
			s.key === 'fontFamily' ? h('div', { class: 'font-sample' }, '見本：テツノワダチ の じしん！ ドクロッグ に 176（111.4%）のダメージ。残り 2 ターン以内に確実に勝つ。', h('br'), h('b', {}, '太字：相手の控えなし（場の1匹だけ）'), ' 0123456789 ABCabc') : null));
}

// ---------- 受付 ----------

function showReception() {
	S.game = null;
	S.participant = null;
	renderMenu();
	setProgress('');
	const pid = h('input', { type: 'text', placeholder: '例：p01', style: { width: '160px' } });
	const set = h('select', {}, S.meta.sets.map(s => h('option', { value: s.file }, `${s.name}（${s.mode === 'sample' ? '被験者ごとに選ぶ' : '全員同じ問題'}）`)));
	const freeId = h('input', { type: 'number', min: 0, value: 1277, style: { width: '110px' } });
	show(
		h('div', { class: 'card' },
			h('h2', {}, '実験を始める'),
			h('p', { class: 'muted' }, '被験者 ID を入れて始めます。前と同じ ID を入れれば続きから再開することができます。'),
			h('div', { class: 'row' }, '被験者 ID', pid, '問題セット', set,
				h('button', { class: 'primary', onclick: async () => {
					if (!pid.value.trim()) return alert('被験者 ID を入れてください');
					try {
						S.participant = pid.value.trim();
						S.summary = await api('POST', '/api/participant', { participant: S.participant, set: set.value });
						nextStep();
					} catch (e) { showError(e); }
				} }, '開始・再開')),
			S.meta.sets.length ? null : h('p', { class: 'fail' }, '問題セットがありません。make_set.js で作ってください。')),
		h('div', { class: 'card' },
			h('h2', {}, '実験者用'),
			h('div', { class: 'row' }, '問題を選んで解く（記録しない）：id', freeId,
				h('button', { class: 'secondary', onclick: () => startGame({ kind: 'free', puzzleId: Number(freeId.value) }) }, '解く')),
			h('div', { class: 'row', style: { marginTop: '10px' } },
				h('button', { class: 'secondary', onclick: openSettings }, '設定'),
				h('button', { class: 'secondary', onclick: openResults }, '記録の一覧'),
				h('button', { class: 'secondary', onclick: () => runDemo(() => showReception()) }, 'プレイデモを見る')),
			h('p', { class: 'muted' }, `エンジン：${S.meta.engine.label}`)));
}

async function openResults() {
	const list = await api('GET', '/api/results');
	openModal('記録の一覧', list.length ? h('table', { class: 'grid' },
		h('tr', {}, h('th', {}, '被験者 ID'), h('th', {}, '問題セット'), h('th', {}, '終わった問題'), h('th', {}, '事前アンケート'), h('th', {}, '練習')),
		list.map(p => h('tr', {}, h('td', {}, p.participant), h('td', {}, p.setName), h('td', {}, `${p.done} / ${p.total}`), h('td', {}, p.survey ? '済' : '—'), h('td', {}, p.practiceDone))))
		: h('p', {}, 'まだ記録がありません。'));
}

// ---------- 実験の流れ ----------

function practiceIds() {
	return String(setting('practicePuzzleIds')).split(',').map(x => Number(x.trim())).filter(Number.isInteger);
}

async function markFlow(step) {
	S.summary = await api('POST', `/api/participant/${S.participant}/flow`, { step });
}

function nextStep() {
	const sm = S.summary;
	if (setting('flowSurvey') && !sm.survey && S.meta.surveyItems.length) return showSurvey();
	if (setting('flowRules') && !sm.flow.rules) return showRulesStep();
	if (setting('flowDemo') && !sm.flow.demo) return runDemo(async () => { await markFlow('demo'); nextStep(); });
	if (setting('flowPractice') && !sm.flow.practice && sm.practiceDone < practiceIds().length) return showPracticeIntro(sm.practiceDone);
	if (sm.nextOrder) return startGame({ kind: 'main', participant: S.participant, order: sm.nextOrder });
	return showEnd();
}

function showSurvey() {
	setProgress('事前アンケート');
	const answers = {};
	show(h('div', { class: 'card' },
		h('h2', {}, '事前アンケート'),
		S.meta.surveyItems.map(item => h('div', { class: 'rating-item' },
			h('div', {}, h('b', {}, item.label)),
			item.type === 'text'
				? h('textarea', { oninput: e => { answers[item.key] = e.target.value; } })
				: h('div', { class: 'row' }, item.options.map(o => h('label', { class: 'secondary' },
					h('input', { type: 'radio', name: item.key, value: o, onchange: () => { answers[item.key] = o; } }), ' ', o))))),
		h('button', { class: 'primary', onclick: async () => {
			const missing = S.meta.surveyItems.filter(i => i.type !== 'text' && !answers[i.key]);
			if (missing.length) return alert('答えていない質問があります：' + missing.map(i => i.label).join('、'));
			S.summary = await api('POST', `/api/participant/${S.participant}/survey`, { answers });
			nextStep();
		} }, '次へ')));
}

function showRulesStep() {
	setProgress('ルールの説明');
	show(h('div', { class: 'card' },
		h('h2', {}, 'ルールの説明'),
		h('p', {}, 'これからポケモンの対戦を使ったパズルを解いてもらいます。'),
		S.meta.rules.map(r => h('div', { class: 'card' }, h('h4', { style: { margin: '0 0 6px' } }, r.title), h('div', {}, r.body))),
		setting('menuTypeChart') || setting('menuRules') ? h('p', { class: 'muted' }, '画面の右上のメニューからは、タイプ相性表とこのルールをいつでも開くことができます。') : null,
		h('button', { class: 'primary', onclick: async () => { await markFlow('rules'); nextStep(); } }, '次へ')));
}

function showPracticeIntro(index) {
	setProgress(`練習問題 ${index + 1} / ${practiceIds().length}`);
	show(h('div', { class: 'card' },
		h('h2', {}, `練習問題 ${index + 1}`),
		h('p', {}, '本番の前に、練習の問題を解いてみましょう。練習の結果は本番とは別に記録します。'),
		h('button', { class: 'primary', onclick: () => startGame({ kind: 'practice', participant: S.participant, index }) }, '始める')));
}

function showBreak(after) {
	show(h('div', { class: 'card' },
		h('h2', {}, 'ひと休み'),
		h('p', {}, `${S.summary.done} 問が終わりました（全 ${S.summary.total} 問）。疲れていたら少し休んでから次へ進んでください。`),
		h('button', { class: 'primary', onclick: after }, '次へ')));
}

function showEnd() {
	setProgress('');
	show(h('div', { class: 'card' },
		h('h2', {}, 'これで終わりです'),
		h('p', {}, 'ご協力ありがとうございました。'),
		h('button', { class: 'secondary', onclick: showReception }, '受付に戻る（実験者用）')));
}

// ---------- 問題の画面 ----------

let timerHandle = null;
function stopTimer() {
	if (timerHandle) clearInterval(timerHandle);
	timerHandle = null;
}

async function startGame(opts) {
	try {
		const out = await api('POST', '/api/game/start', opts);
		S.game = { meta: out.meta, view: out.view, display: out.view, damage: null, target: null, myTarget: null, log: [], busy: false, startedAt: Date.now() - out.meta.elapsed * 1000, answer: null };
		await refreshDamage();
		renderMenu();
		renderGame();
		startTimer();
	} catch (e) { showError(e); }
}

function startTimer() {
	stopTimer();
	timerHandle = setInterval(() => {
		if (!S.game) return stopTimer();
		const el = document.getElementById('timer');
		const sec = Math.floor((Date.now() - S.game.startedAt) / 1000);
		if (el) el.textContent = `経過 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
		const limit = Number(setting('timeLimitSec'));
		if (limit > 0 && sec >= limit && S.game.meta.status === 'playing' && !S.game.busy && S.game.meta.kind !== 'demo') giveUp('timeout');
	}, 500);
}

async function refreshDamage() {
	S.game.damage = await api('GET', `/api/game/${S.game.meta.gameId}/damage`);
}

function progressText(meta) {
	const parts = [];
	if (meta.kind === 'main' && setting('showProgress')) parts.push(`${meta.order} / ${meta.total} 問目`);
	if (meta.kind === 'practice') parts.push(`練習 ${meta.order} / ${meta.total}`);
	if (meta.kind === 'free') parts.push('自由に解く（記録しない）');
	if (meta.kind === 'demo') parts.push('プレイデモ');
	if (setting('showPuzzleId')) parts.push(`id ${meta.id}`);
	return parts.join('　');
}

function renderGame() {
	const g = S.game;
	const v = g.display;
	if (tooltipEl) tooltipEl.remove();
	tooltipEl = null;
	setProgress(progressText(g.meta));
	const header = h('div', { class: 'game-header', id: 'game-header' },
		setting('showTurnCounter') ? h('div', { class: 'remaining' }, '残り ', h('b', {}, v.remaining), ' ターン以内に確実に勝利') : h('div', {}, '確実に勝利する手順を探す'),
		h('span', { class: 'muted' }, `（${g.meta.length}ターン詰めの問題）`),
		h('div', { class: 'spacer' }),
		setting('showAttemptCount') ? h('span', {}, `${g.meta.attempt} 回目の挑戦`) : null,
		setting('showTimer') || Number(setting('timeLimitSec')) > 0 ? h('span', { id: 'timer' }, '') : null,
		Number(setting('timeLimitSec')) > 0 ? h('span', { class: 'muted' }, `（制限 ${setting('timeLimitSec')} 秒）`) : null);
	const wide = setting('gameLayout') === 'wide';
	const compact = wide && setting('fieldSize') === 'compact';
	const field = h('div', { class: 'field', id: 'field' }, renderSide(v, 1, compact), renderSide(v, 0, compact));
	// 小さい場では、相手の技と控えを場の外の列に出す。
	const info = compact ? h('div', { class: 'side-info', id: 'side-info' }, sideInfo(v, 1)) : null;
	const log = setting('showBattleLog') ? h('div', { class: 'log', id: 'log' }, g.log.map(renderLogLine)) : h('div', { class: 'log muted' }, 'バトルログは表示しない設定です。');
	// 小さい場では、自分の控えを操作の欄の右に、縦の線で区切って入れる。
	const controls = h('div', { class: 'controls' + (g.busy ? ' busy' : ''), id: 'controls' },
		compact ? [h('div', { class: 'ctl-main' }, renderControls()), h('div', { class: 'ctl-mine' }, sideInfo(v, 0))] : renderControls());
	// 小さい場では、場、隣の列、操作をひとまとめにして、画面の大きさに合わせて拡大する。
	const main = compact ? [h('div', { class: 'stage', id: 'stage' }, field, info, controls), log] : [field, log, controls];
	app().replaceChildren(h('div', { class: 'game' + (wide ? ' wide' : '') + (compact ? ' field-compact' : '') }, header, ...main));
	fitField();
	fitStage();
	const logEl = document.getElementById('log');
	if (logEl) logEl.scrollTop = logEl.scrollHeight;
	applyFx(g.fx);
	applyDemoHl();
}

function renderLogLine(line) {
	return h('div', { class: line.kind === 'turn' ? 'turn' : line.kind === 'result' ? 'result' + (line.fail ? ' fail' : '') : line.kind === 'attempt' ? 'attempt' : '' }, line.text);
}

// s が 0（自分）のときは、設定が ON なら背面の画像を使う。背面がなければ正面にする。
// 控え、交代のボタン、ダメージ表などに出す小さい画像。画像がなければ何も出さない。
// 小さい画像。画像を出さないときと画像がないときは、タイプの色の丸と頭文字にする。
function spriteIcon(mon, size = '') {
	if (!setting('showSpriteIcons')) return null;
	const file = S.meta.sprites[mon.species];
	if (setting('showSprites') && file) return h('img', { class: 'icon ' + size, src: `/sprites/${file}`, alt: '' });
	return h('span', { class: 'icon ball ' + size, style: { background: typeGradient(mon) } }, mon.name.slice(0, 1));
}

function typeGradient(mon) {
	const color = TYPE_COLORS[mon.types[0].type] || '#888';
	const color2 = mon.types[1] ? TYPE_COLORS[mon.types[1].type] : color;
	return `linear-gradient(135deg, ${color} 50%, ${color2} 50%)`;
}

function spriteFor(mon, s) {
	const back = s === 0 && setting('spriteBackForMe') ? (S.meta.spritesBack || {})[mon.species] : null;
	const file = back || S.meta.sprites[mon.species];
	if (setting('showSprites') && file) {
		return h('div', { class: 'sprite' }, h('img', { src: `/sprites/${file}`, alt: mon.name }));
	}
	return h('div', { class: 'sprite' }, h('div', { class: 'ball', style: { background: typeGradient(mon) } }, mon.name.slice(0, 1)));
}

function speedTag(v, s) {
	if (!setting('showSpeedOrder')) return null;
	const me = v.sides[s].mons[v.sides[s].active];
	const foe = v.sides[1 - s].mons[v.sides[1 - s].active];
	if (me.hp <= 0 || foe.hp <= 0) return null;
	const other = s === 0 ? '相手' : 'あなた';
	if (me.stats.spe > foe.stats.spe) return h('span', { class: 'tag fast' }, `${other}より速い`);
	if (me.stats.spe < foe.stats.spe) return h('span', { class: 'tag' }, `${other}より遅い`);
	return h('span', { class: 'tag' }, '同じ速さ（相手が先に動く）');
}

function monCard(v, s, mon, withFoeMoves = true) {
	const ratio = mon.hp / mon.maxhp;
	const parts = [
		h('div', {}, h('span', { class: 'name' }, mon.name), setting('showLevel') ? h('span', { class: 'lv' }, `Lv${mon.level}`) : null),
		setting('showTypes') ? h('div', { class: 'tags' }, mon.types.map(typeBadge)) : null,
		setting('showHpBar') ? h('div', { class: 'hpbar' }, h('div', { style: { width: `${Math.max(0, ratio) * 100}%`, background: hpColor(ratio) } })) : null,
		h('div', { class: 'hptext' },
			setting('showHpNumbers') ? `HP ${mon.hp} / ${mon.maxhp}` : '',
			setting('showHpPercent') ? `（${(ratio * 100).toFixed(1)}%）` : ''),
		h('div', { class: 'tags' },
			setting('showSpeed') ? h('span', { class: 'tag' }, `素早さ ${mon.stats.spe}`) : null,
			speedTag(v, s),
			feature('status') && setting('showStatus') && mon.status ? h('span', { class: 'tag' }, mon.status) : null,
			feature('abilities') && setting('showAbility') && mon.ability ? h('span', { class: 'tag' }, `特性 ${mon.ability}`) : null,
			feature('items') && setting('showItem') && mon.item ? h('span', { class: 'tag' }, `持ち物 ${mon.item}`) : null,
			feature('boosts') && setting('showBoosts') ? Object.entries(mon.boosts || {}).filter(([, n]) => n).map(([k, n]) => h('span', { class: 'tag' }, `${k} ${n > 0 ? '+' : ''}${n}`)) : null),
		setting('showAllStats') ? h('div', { class: 'tags' }, ['atk', 'def', 'spa', 'spd'].map(k => h('span', { class: 'tag' }, `${{ atk: '攻撃', def: '防御', spa: '特攻', spd: '特防' }[k]} ${mon.stats[k]}`))) : null,
	];
	if (s === 1 && withFoeMoves) parts.push(foeMoves(v, mon));
	return h('div', { class: 'mon-card' }, parts);
}

function foeMoves(v, mon) {
	if (!setting('showOpponentMoves') || mon.hp <= 0) return null;
	const g = S.game;
	// 自分の控えをクリックして選んでいるときは、そのポケモンが受けるダメージを出す。
	const myActive = g.myTarget === null ? v.sides[0].active : g.myTarget;
	const rows = g.damage ? g.damage[1][mon.index].rows : null;
	const me = v.sides[0].mons[myActive];
	const showDmg = setting('showOpponentDamage') && rows;
	return h('div', { class: 'foe-moves' + (g.myTarget !== null ? ' retarget' : '') },
		h('div', { class: 'box-title' }, spriteIcon(mon, 'tiny'), `相手の ${mon.name} の技`),
		showDmg && g.myTarget !== null ? h('div', { class: 'target-note' }, `ダメージはあなたの控えの ${me.name} が受けたときの値です（場のポケモンではありません）。`, ' ',
			h('a', { href: '#', onclick: e => { e.preventDefault(); g.myTarget = null; uiEvent('retargetMe', null); renderGame(); } }, '場のポケモンに戻す')) : null,
		showDmg ? h('div', { class: 'muted fm-target' }, '→ ', spriteIcon(me, 'tiny'), `あなたの${g.myTarget !== null ? '控えの' : ''} ${me.name} が受けるダメージ`) : null,
		mon.moves.map((mv, k) => moveLine(mv, me, showDmg ? rows[k][myActive] : null)));
}

// 技を、タイプの札と名前の1行で出す。target と cell があれば、その下にダメージを出す。
function moveLine(mv, target, cell) {
	return h('div', { class: 'foe-move' },
		h('div', {},
			h('span', { class: 'type', style: { background: TYPE_COLORS[mv.type] || '#888' } }, mv.typeName),
			h('span', {}, mv.name),
			setting('showMoveDetails') ? h('span', { class: 'muted' }, `${mv.category}・威力 ${mv.power}${mv.priority ? `・優先度 ${mv.priority > 0 ? '+' : ''}${mv.priority}` : ''}`) : null),
		target && cell ? h('div', { class: 'fm-dmg' }, dmgBar(target, cell), h('b', {}, formatDamage(cell)), setting('markKO') && cell.ko ? h('span', { class: 'ko' }, '倒せる') : null) : null);
}

// 受ける側の HP バーに、ダメージで減る分を斜線で重ねて出す。
function dmgBar(mon, cell) {
	if (!setting('showDamageBar') || !cell) return null;
	const cut = Math.min(Math.max(0, mon.hp), cell.damage);
	const left = Math.max(0, mon.hp - cut);
	const pct = n => `${n / mon.maxhp * 100}%`;
	return h('div', { class: 'dmgbar' },
		h('div', { class: 'left', style: { width: pct(left), background: hpColor(left / mon.maxhp) } }),
		h('div', { class: 'cut', style: { width: pct(cut) } }));
}

// split が true のときは、場には画像と状態だけを出す。技と控えは sideInfo で出す。
function renderSide(v, s, split = false) {
	const side = v.sides[s];
	const mon = side.mons[side.active];
	const sprite = spriteFor(mon, s);
	// 倒れたポケモンは、倒れる演出のあとは場から消す。
	const fx = S.game && S.game.fx;
	if (setting('showFaintFx') && mon.hp <= 0 && !(fx && fx.side === s)) sprite.classList.add('gone');
	if (split) return h('div', { class: 'side-area ' + (s === 1 ? 'foe' : 'me') }, sprite, h('div', {}, monCard(v, s, mon, false)));
	return h('div', { class: 'side-area ' + (s === 1 ? 'foe' : 'me'), id: s === 1 ? 'side-foe' : 'side-me' }, sprite, h('div', {}, monCard(v, s, mon), benchList(v, s), noBenchNote(side, s)));
}

function sideInfo(v, s) {
	const side = v.sides[s];
	const moves = s === 1 ? foeMoves(v, side.mons[side.active]) : null;
	const bench = benchList(v, s);
	return h('div', { class: 'info-box', id: s === 1 ? 'side-foe' : 'side-me' }, moves, moves && bench ? h('hr', { class: 'sep' }) : null, bench, noBenchNote(side, s));
}

function benchList(v, s) {
	const side = v.sides[s];
	const g = S.game;
	// 相手の控えは自分の技のダメージの相手を、自分の控えは相手の技のダメージの受け手を切り替える。
	const canClick = s === 1
		? setting('clickBenchToRetarget') && setting('showDamageOnMoves')
		: setting('clickMyBenchToRetarget') && setting('showOpponentMoves') && setting('showOpponentDamage');
	const chosen = s === 1 ? g.target : g.myTarget;
	const bench = setting('showBench') ? h('div', {},
		h('div', { class: 'bench-label' }, s === 1 ? '相手のポケモン' : 'あなたのポケモン',
			canClick ? (s === 1 ? '（クリックすると技のダメージの相手を切り替えられます）' : '（クリックすると相手の技のダメージの受け手を切り替えられます）') : ''),
		h('div', { class: 'bench' }, side.mons.map((m, i) => {
			const clickable = canClick && m.hp > 0;
			const el = h('div', {
				class: ['mini', m.hp <= 0 ? 'fainted' : '', i === side.active ? 'active' : '', chosen !== null && i === chosen ? 'target' : '', clickable ? 'clickable' : ''].join(' '),
				'data-bench': `${s}:${i}`,
				onclick: clickable ? () => {
					const next = i === side.active ? null : i;
					if (s === 1) g.target = next; else g.myTarget = next;
					uiEvent(s === 1 ? 'retarget' : 'retargetMe', next);
					renderGame();
				} : null,
			}, spriteIcon(m), m.name, h('div', { class: 'minihp' }, h('div', { style: { width: `${Math.max(0, m.hp / m.maxhp) * 100}%`, background: hpColor(m.hp / m.maxhp) } })));
			if (setting('benchTooltip')) attachTooltip(el, () => monTooltip(v, s, m), `hover:${s}:${i}`);
			return el;
		}))) : null;
	return bench;
}

// 交代できる控えがいないときに、そのことを出す。
function noBenchNote(side, s) {
	if (!setting('showNoBenchNote')) return null;
	const others = side.mons.filter((m, i) => i !== side.active);
	if (others.some(m => m.hp > 0)) return null;
	const who = s === 1 ? '相手' : 'あなた';
	const text = others.length === 0 ? `${who}の控えなし（場の1匹だけ）` : `${who}の控えなし（ほかは全員ひんし）`;
	return h('div', { class: 'no-bench' }, text);
}

// 控えや交代のボタンに乗せたときの説明。技は、相手の場のポケモンへのダメージをつけて出す。
function monTooltip(v, s, m) {
	const other = v.sides[1 - s];
	// 自分のポケモンの説明では、相手の控えをクリックして選んだポケモンを相手にする。
	const targetIndex = s === 0 && S.game && S.game.target !== null ? S.game.target : other.active;
	const foe = other.mons[targetIndex];
	const whoFoe = s === 0 ? (targetIndex === other.active ? '相手の' : '相手の控えの') : 'あなたの';
	const dmg = S.game && S.game.damage;
	const give = dmg && foe.hp > 0 ? dmg[s][m.index].rows : null;
	const take = dmg && foe.hp > 0 && m.hp > 0 ? dmg[1 - s][foe.index].rows : null;
	const ratio = Math.max(0, m.hp / m.maxhp);
	return h('div', {},
		h('div', { class: 'tt-head' }, spriteIcon(m, 'large'),
			h('div', {}, h('b', {}, (s === 0 ? 'あなたの ' : '相手の ') + m.name), h('div', { class: 'tags' }, m.types.map(typeBadge)))),
		h('div', { class: 'hpbar' }, h('div', { style: { width: `${ratio * 100}%`, background: hpColor(ratio) } })),
		h('div', {}, `HP ${m.hp} / ${m.maxhp}　素早さ ${m.stats.spe}`),
		h('div', { class: 'muted' }, `攻撃 ${m.stats.atk}　防御 ${m.stats.def}　特攻 ${m.stats.spa}　特防 ${m.stats.spd}`),
		h('div', { class: 'tt-sub' }, give ? ['技（→ ', spriteIcon(foe, 'tiny'), `${whoFoe} ${foe.name} へのダメージ）`] : '技'),
		m.moves.map((mv, k) => moveLine(mv, foe, give ? give[k][foe.index] : null)),
		take ? [h('div', { class: 'tt-sub' }, spriteIcon(foe, 'tiny'), `${whoFoe} ${foe.name} の技を受けたとき`),
			foe.moves.map((mv, k) => moveLine(mv, m, take[k][m.index]))] : null);
}

let tooltipEl = null;
let tooltipAnchor = null;
function attachTooltip(el, make, logKind) {
	el.addEventListener('mouseenter', e => {
		tooltipEl = h('div', { class: 'tooltip' }, make());
		document.body.append(tooltipEl);
		tooltipAnchor = el;
		placeTooltip(el);
		if (logKind) uiEvent(logKind.startsWith('hover') ? logKind : 'hover:' + logKind);
	});
	el.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.remove(); tooltipEl = null; });
}

// 説明を、乗せた要素の右、左、下、上の順に、要素に重ならず画面に収まる所へ置く。
// 説明も拡大しているときは、位置を倍率で割って指定する。
function placeTooltip(anchor) {
	if (!tooltipEl || !anchor || !anchor.isConnected) return;
	tooltipEl.style.left = '0px';
	tooltipEl.style.top = '0px';
	const z = parseFloat(getComputedStyle(tooltipEl).zoom) || 1;
	const a = anchor.getBoundingClientRect();
	const t = tooltipEl.getBoundingClientRect();
	const W = window.innerWidth, H = window.innerHeight, gap = 8, m = 8;
	const clampX = x => Math.min(Math.max(m, x), W - m - t.width);
	const clampY = y => Math.min(Math.max(m, y), H - m - t.height);
	const spots = [
		[a.right + gap, clampY(a.top)],
		[a.left - gap - t.width, clampY(a.top)],
		[clampX(a.left), a.bottom + gap],
		[clampX(a.left), a.top - gap - t.height],
	];
	const fits = ([x, y]) => x >= m && y >= m && x + t.width <= W - m && y + t.height <= H - m;
	const [x, y] = spots.find(fits) || [clampX(a.right + gap), clampY(a.top)];
	tooltipEl.style.left = (x / z) + 'px';
	tooltipEl.style.top = (y / z) + 'px';
	// 倍率のかかり方はブラウザで違うので、実際に置かれた位置を測って直す。
	const r = tooltipEl.getBoundingClientRect();
	if (Math.abs(r.left - x) > 0.5 && r.left > 0) tooltipEl.style.left = (x / z) * (x / r.left) + 'px';
	if (Math.abs(r.top - y) > 0.5 && r.top > 0) tooltipEl.style.top = (y / z) * (y / r.top) + 'px';
}

function renderControls() {
	const g = S.game;
	const v = g.display;
	const out = [];
	if (g.meta.status !== 'playing') {
		out.push(h('div', { class: 'status-panel ' + (g.meta.status === 'solved' ? 'won' : 'failed') },
			h('h3', {}, g.meta.status === 'solved' ? '正解です！' : g.meta.status === 'timeout' ? '時間切れです' : '解答'),
			g.answer ? renderAnswer(g.answer) : null,
			h('div', { class: 'row' },
				g.meta.status === 'solved' && setting('allowAnswerAfterSolve') && !g.answer ? h('button', { class: 'secondary', onclick: loadAnswer }, '解答と相手の受けを見る') : null,
				g.meta.kind === 'demo' ? null : h('button', { class: 'primary', onclick: afterGame }, g.meta.kind === 'free' ? '受付に戻る' : setting('ratingEnabled') ? '評価へ進む' : '次へ'))));
		return out;
	}
	if (v.phase === 'failed') {
		out.push(h('div', { class: 'status-panel failed' },
			h('h3', {}, '失敗です'),
			h('div', {}, v.failReason),
			h('div', { class: 'row', style: { marginTop: '8px' } },
				setting('allowRetry') ? h('button', { class: 'primary', onclick: retry }, 'もう一度挑戦する') : null,
				setting('allowGiveUp') || !setting('allowRetry') ? h('button', { class: 'danger', onclick: () => giveUp('gaveUp') }, 'あきらめて解答を見る') : null)));
		return out;
	}
	if (v.phase === 'replace') {
		out.push(h('h4', {}, '倒れました。次に出すポケモンを選んでください'));
		out.push(h('div', { class: 'switches' }, v.choices.map(c => {
			const m = v.sides[0].mons[c.index];
			return h('button', { class: 'switchbtn', onclick: () => act(c) }, spriteIcon(m), h('b', {}, m.name), h('br'), h('span', { class: 'muted' }, `HP ${m.hp}/${m.maxhp}`), hpBarSmall(m));
		})));
		return out;
	}
	const me = v.sides[0].mons[v.sides[0].active];
	const target = g.target === null ? v.sides[1].active : g.target;
	const targetMon = v.sides[1].mons[target];
	const rows = g.damage ? g.damage[0][me.index].rows : null;
	if (setting('showDamageOnMoves') && g.target !== null) {
		out.push(h('div', { class: 'target-note' }, `技のダメージは相手の控えの ${targetMon.name} に当てたときの値です（場のポケモンではありません）。`, ' ',
			h('a', { href: '#', onclick: e => { e.preventDefault(); g.target = null; uiEvent('retarget', null); renderGame(); } }, '場のポケモンに戻す')));
	}
	out.push(h('h4', {}, `${me.name} の技`));
	out.push(h('div', { class: 'moves', id: 'moves' }, v.choices.filter(c => c.type === 'move').map(c => {
		const mv = me.moves[c.index];
		const cell = rows ? rows[c.index][target] : null;
		const btn = h('button', { class: 'movebtn', style: { background: TYPE_COLORS[mv.type] || '#888' }, onclick: () => act(c), 'data-move': c.index },
			h('div', { class: 'mname' }, mv.name),
			setting('showMoveDetails') ? h('div', { class: 'mdetail' }, `${mv.typeName}・${mv.category}・威力 ${mv.power}${mv.priority ? `・優先度 ${mv.priority > 0 ? '+' : ''}${mv.priority}` : ''}${feature('accuracy') && setting('showMoveAccuracy') && mv.accuracy ? `・命中 ${mv.accuracy}` : ''}`) : null,
			setting('showDamageOnMoves') && cell ? h('div', { class: 'mdmg' }, '→ ', spriteIcon(targetMon, 'tiny'), `${targetMon.name} に ${formatDamage(cell)}`, setting('markKO') && cell.ko ? h('span', { class: 'ko' }, '倒せる') : null) : null,
			setting('showDamageOnMoves') && cell ? dmgBar(targetMon, cell) : null);
		if (setting('showMoveDescription') && mv.description) attachTooltip(btn, () => mv.description, `hover:move:${c.index}`);
		else if (setting('recordHover')) btn.addEventListener('mouseenter', () => uiEvent(`hover:move:${c.index}`));
		return btn;
	})));
	const switches = v.choices.filter(c => c.type === 'switch');
	if (switches.length) {
		out.push(h('h4', {}, '交代'));
		out.push(h('div', { class: 'switches', id: 'switches' }, switches.map(c => {
			const m = v.sides[0].mons[c.index];
			const btn = h('button', { class: 'switchbtn', onclick: () => act(c), 'data-switch': c.index }, spriteIcon(m), h('b', {}, m.name), h('span', { class: 'sw-types' }, ' ' + m.types.map(t => t.name).join('/')), h('br'), h('span', { class: 'muted' }, `HP ${m.hp}/${m.maxhp}　素早さ ${m.stats.spe}`), hpBarSmall(m));
			if (setting('benchTooltip')) attachTooltip(btn, () => monTooltip(v, 0, m), `hover:switch:${c.index}`);
			return btn;
		})));
	}
	// 技と交代を左右に分けて置けるように、それぞれを囲む。
	const start = out.findIndex(e => e.id === 'moves') - 1;
	const parts = out.splice(start);
	out.push(h('div', { class: 'ctl-row' }, h('div', { class: 'ctl-moves' }, parts.slice(0, 2)), parts.length > 2 ? h('div', { class: 'ctl-switches' }, parts.slice(2)) : null));
	if (setting('allowGiveUp') && setting('giveUpAnytime') && g.meta.kind !== 'demo') {
		out.push(h('div', { class: 'row giveup-row', style: { marginTop: '12px', justifyContent: 'flex-end' } },
			h('button', { class: 'danger', onclick: () => { if (confirm('あきらめて解答を見ますか？')) giveUp('gaveUp'); } }, 'あきらめて解答を見る')));
	}
	return out;
}

function hpBarSmall(m) {
	if (!setting('showHpBar')) return null;
	const r = Math.max(0, m.hp / m.maxhp);
	return h('div', { class: 'swhp' }, h('div', { style: { width: `${r * 100}%`, background: hpColor(r) } }));
}

function renderAnswer(ans) {
	return h('div', {},
		h('h4', {}, '解答の手順（相手は最長の受けを選ぶ）'),
		ans.steps.map(st => h('div', { class: 'answer-step' },
			h('b', {}, `${st.turn}ターン目：あなた「${st.p1}」／相手「${st.p2}」`),
			st.events.map(e => h('div', { class: 'ev' }, e)),
			st.after ? h('div', { class: 'ev' }, st.after) : null)),
		setting('showRefutations') && ans.refutations.length ? h('div', {},
			h('h4', {}, '正解以外の初手と、それぞれに対する相手の受け'),
			ans.refutations.map(r => h('div', { class: 'ev' }, `「${r.p1}」→ 相手「${r.p2}」で${r.verdict}`))) : null);
}

async function act(choice) {
	const g = S.game;
	if (g.busy) return;
	// チュートリアルでは、案内している手のほかは受け付けない。
	if (demoExpect && !(demoExpect.type === choice.type && demoExpect.index === choice.index)) return demoHint(`ここでは「${demoExpect.label}」を押してください。`);
	if (setting('confirmAction') && !confirm(`「${choice.label}」でよいですか？`)) return;
	g.busy = true;
	g.target = null;
	g.myTarget = null;
	renderGame();
	try {
		const out = await api('POST', `/api/game/${g.meta.gameId}/act`, { type: choice.type, index: choice.index });
		await playEvents(out.events);
		g.view = out.view;
		g.display = out.view;
		g.meta = out.meta;
		await refreshDamage();
		if (g.meta.status !== 'playing' && g.meta.kind !== 'demo') stopTimer();
	} catch (e) { showError(e); }
	g.busy = false;
	renderGame();
	demoNotify('actDone', choice);
}

// 出来事を1つずつ出し、HP と場のポケモンを途中の値で書き換える。
async function playEvents(events) {
	const g = S.game;
	const display = JSON.parse(JSON.stringify(g.display));
	g.display = display;
	for (const ev of events) {
		g.log.push({ kind: ev.kind, text: ev.text, fail: ev.kind === 'result' && !ev.text.includes('勝ち') });
		g.fx = fxFor(ev, display);
		if (ev.hp) display.sides[ev.hp.side].mons[ev.hp.index].hp = ev.hp.hp;
		if (ev.active) display.sides[ev.active.side].active = ev.active.index;
		renderGame();
		g.fx = null;
		await sleep(Math.max(Number(setting('eventDelayMs')), fxWait(ev)));
	}
}

// ---------- 対戦の演出 ----------
// 出来事から演出の種類を決める。新しい出来事は kind を見て足す。
function fxFor(ev, display) {
	if (ev.kind === 'faint' && ev.side !== null) return { type: 'faint', side: ev.side };
	if (ev.active) return { type: 'enter', side: ev.active.side };
	if (ev.hp) {
		const mon = display.sides[ev.hp.side].mons[ev.hp.index];
		if (ev.hp.index !== display.sides[ev.hp.side].active) return null;
		return { type: 'hit', side: ev.hp.side, attacker: ev.kind === 'move' ? ev.side : null, from: mon.hp, to: ev.hp.hp, maxhp: mon.maxhp };
	}
	return null;
}

// 演出が終わるまで次の出来事を待つ時間（ミリ秒）。
function fxWait(ev) {
	if (ev.kind === 'faint' && setting('showFaintFx')) return 900;
	if (ev.hp && (setting('showHitFx') || setting('showHpBarFx'))) return 750;
	return 0;
}

// 描き直した場の画像と HP バーに演出を付ける。
function applyFx(fx) {
	if (!fx) return;
	const spriteOf = s => document.querySelector(`#field .side-area.${s === 1 ? 'foe' : 'me'} .sprite`);
	const box = document.querySelector(`#field .side-area.${fx.side === 1 ? 'foe' : 'me'}`);
	if (!box) return;
	const sprite = spriteOf(fx.side);
	const play = (el, cls) => { if (el) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); } };
	if (fx.type === 'hit') {
		if (setting('showHitFx')) {
			if (fx.attacker !== null) play(spriteOf(fx.attacker), fx.attacker === 1 ? 'fx-lunge-foe' : 'fx-lunge-me');
			play(sprite, 'fx-hit');
			const lost = fx.from - fx.to;
			if (sprite && lost > 0) sprite.append(h('div', { class: 'fx-dmg' }, `-${(lost / fx.maxhp * 100).toFixed(1)}%`));
		}
		const bar = box.querySelector('.mon-card .hpbar > div');
		if (setting('showHpBarFx') && bar) {
			const to = bar.style.width, toColor = bar.style.background;
			const r = Math.max(0, fx.from) / fx.maxhp;
			bar.style.transition = 'none';
			bar.style.width = `${r * 100}%`;
			bar.style.background = hpColor(r);
			void bar.offsetWidth;
			bar.style.transition = '';
			bar.classList.add('fx-drain');
			bar.style.width = to;
			bar.style.background = toColor;
		}
	}
	if (fx.type === 'faint' && setting('showFaintFx')) play(sprite, 'fx-faint');
	if (fx.type === 'enter' && setting('showFaintFx')) play(sprite, 'fx-enter');
}

async function retry() {
	const g = S.game;
	try {
		const out = await api('POST', `/api/game/${g.meta.gameId}/retry`);
		g.meta = out.meta;
		g.view = out.view;
		g.display = out.view;
		g.target = null;
		g.myTarget = null;
		g.log.push({ kind: 'attempt', text: `―― ${g.meta.attempt} 回目の挑戦 ――` });
		await refreshDamage();
		renderGame();
	} catch (e) { showError(e); }
}

async function giveUp(reason) {
	const g = S.game;
	g.busy = true;
	try {
		const out = await api('POST', `/api/game/${g.meta.gameId}/giveup`, { reason });
		g.meta = out.meta;
		stopTimer();
		await loadAnswer();
	} catch (e) { showError(e); }
	g.busy = false;
	renderGame();
}

async function loadAnswer() {
	const g = S.game;
	g.answer = await api('GET', `/api/game/${g.meta.gameId}/answer`);
	renderGame();
}

function afterGame() {
	const g = S.game;
	if (g.meta.kind === 'free') {
		api('POST', `/api/game/${g.meta.gameId}/rate`, { skip: true }).catch(() => {});
		return showReception();
	}
	if (setting('ratingEnabled')) return showRating();
	return submitRating(null);
}

// ---------- 評価 ----------

function showRating() {
	const g = S.game;
	S.game = null;
	renderMenu();
	const ratings = {};
	const comment = h('textarea', { placeholder: 'なぜ面白いと感じたかやつまらないと感じたか、どこで迷ったかなど（空でもかまいません）' });
	const items = S.meta.ratingItems.map(item => {
		const labels = [];
		const box = h('div', { class: 'rating-item' }, h('div', {}, h('b', {}, item.label)),
			h('div', { class: 'scale' }, item.scale.map((text, i) => {
				const label = h('label', {}, h('input', { type: 'radio', name: item.key, style: { display: 'none' }, onchange: () => {
					ratings[item.key] = i + 1;
					labels.forEach(l => l.classList.remove('on'));
					label.classList.add('on');
				} }), h('b', {}, i + 1), setting('ratingShowScaleLabels') ? h('span', {}, text) : null);
				labels.push(label);
				return label;
			})));
		return box;
	});
	show(h('div', { class: 'card' },
		h('h2', {}, g.meta.kind === 'practice' ? '評価（練習）' : '評価'),
		h('p', { class: 'muted' }, `いま解いた問題（${g.meta.length}ターン）について答えてください。`),
		items,
		setting('ratingComment') ? h('div', { class: 'rating-item' }, h('b', {}, 'コメント'), comment) : null,
		h('button', { class: 'primary', onclick: () => {
			const missing = S.meta.ratingItems.filter(i => !ratings[i.key]);
			if (setting('ratingRequireAll') && missing.length) return alert('まだ選んでいない項目があります：' + missing.map(i => i.label).join('、'));
			submitRating({ ratings, comment: comment.value }, g);
		} }, '送信して次へ')));
}

async function submitRating(rating, g = S.game) {
	try {
		const out = await api('POST', `/api/game/${g.meta.gameId}/rate`, rating || { skip: true });
		S.game = null;
		if (g.meta.kind === 'practice') {
			S.summary = await api('POST', '/api/participant', { participant: S.participant, set: S.summary.set });
			if (S.summary.practiceDone >= practiceIds().length) await markFlow('practice');
			return nextStep();
		}
		S.summary = out;
		const every = Number(setting('breakEvery'));
		if (every > 0 && S.summary.done % every === 0 && S.summary.nextOrder) return showBreak(nextStep);
		return nextStep();
	} catch (e) { showError(e); }
}

// ---------- プレイデモ（チュートリアル） ----------

let demoBox = null;
let demoHl = null; // 強調する要素のセレクタ。画面を描き直した後も付け直す。
let demoWaiter = null; // 被験者の操作を待つときの { test, resolve }
let demoExpect = null; // 押してほしい手。これ以外の手は act で受け付けない。
let demoAllow = null; // 操作を待つ手順で、押してよい要素のセレクタ。

// プレイデモの間は、問題の画面のうち押してよい要素のほかのクリックを止める。上のメニューと開いた画面は止めない。
document.addEventListener('click', e => {
	if (!document.body.classList.contains('demo-lock')) return;
	if (!e.target.closest('#app') || e.target.closest('.demo-box, .demo-allow')) return;
	e.preventDefault();
	e.stopPropagation();
	if (demoAllow) demoHint('黄色い枠で囲んだ所を操作してください。');
}, true);

// 画面の操作を知らせる。待っている操作なら次へ進める。
function demoNotify(kind, detail) {
	if (!demoWaiter || !demoWaiter.test(kind, detail)) return;
	const resolve = demoWaiter.resolve;
	demoWaiter = null;
	resolve(false);
}

function applyDemoHl() {
	document.querySelectorAll('.demo-hl, .demo-allow').forEach(el => el.classList.remove('demo-hl', 'demo-allow'));
	document.body.classList.toggle('demo-lock', Boolean(demoBox));
	document.body.classList.toggle('demo-blink', setting('demoBlink'));
	const el = demoHl && document.querySelector(demoHl);
	if (el) el.classList.add('demo-hl');
	const ok = demoAllow && document.querySelector(demoAllow);
	if (ok) ok.classList.add('demo-allow');
	placeDemoBox(el);
	if (setting('demoRingOnTop')) followDemoRing();
}

// 強調した要素の上に、ほかの物より手前で光る枠を重ねる。説明や吹き出しで隠れても場所が分かる。
let demoRing = null;
let demoRingLoop = false;
function followDemoRing() {
	if (demoRingLoop) return;
	demoRingLoop = true;
	const step = () => {
		const el = demoHl && demoBox && document.querySelector(demoHl);
		if (!el || !setting('demoRingOnTop')) {
			if (demoRing) demoRing.remove();
			demoRing = null;
			demoRingLoop = false;
			return;
		}
		if (!demoRing) { demoRing = h('div', { class: 'demo-ring' }); document.body.append(demoRing); }
		const r = el.getBoundingClientRect();
		const pad = 3;
		Object.assign(demoRing.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
		requestAnimationFrame(step);
	};
	step();
}

// 吹き出しが強調した要素に重なるときは、重ならない隅へ動かす。
function placeDemoBox(el) {
	if (!demoBox) return;
	const spots = ['pos-br', 'pos-tr', 'pos-bl', 'pos-tl'];
	const hit = () => {
		if (!el) return false;
		const a = demoBox.getBoundingClientRect(), b = el.getBoundingClientRect();
		return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
	};
	for (const spot of spots) {
		spots.forEach(s => demoBox.classList.remove(s));
		demoBox.classList.add(spot);
		if (!hit()) return;
	}
	spots.forEach(s => demoBox.classList.remove(s));
	demoBox.classList.add('pos-br');
}

function closeDemo() {
	if (demoBox) demoBox.remove();
	demoBox = null;
	demoAllow = null;
	demoHl = null;
	demoWaiter = null;
	demoExpect = null;
	applyDemoHl();
}

// allow が true のときは、sel の要素だけを押せるようにする。
function showDemoBox(content, sel, buttons, allow = false) {
	if (demoBox) demoBox.remove();
	demoHl = sel || null;
	demoAllow = allow ? demoHl : null;
	applyDemoHl();
	demoBox = h('div', { class: 'demo-box' }, h('div', { class: 'demo-text' }, [content].flat().map(c => typeof c === 'string' ? c.replace(/。(?=.)/g, '。\n') : c)), h('div', { class: 'demo-hint', id: 'demo-hint' }), h('div', { class: 'row' }, buttons));
	document.body.append(demoBox);
	applyDemoHl();
}

function demoHint(text) {
	const el = document.getElementById('demo-hint');
	if (el) el.textContent = text;
}

// 吹き出しを出して「次へ」を待つ。sel は強調する要素の CSS セレクタ。
function demoSay(text, sel) {
	return new Promise(resolve => showDemoBox(text, sel, h('button', { class: 'primary', onclick: () => resolve() }, '次へ')));
}

// 吹き出しを出して、被験者の操作を待つ。test(kind, detail) が true になる操作で進む。
// 「とばす」を押したときは true を返す。
function demoWait(text, sel, test) {
	return new Promise(resolve => {
		demoWaiter = { test, resolve };
		showDemoBox([h('div', { class: 'demo-do' }, 'やってみましょう'), text], sel,
			h('button', { class: 'secondary', onclick: () => { demoWaiter = null; demoExpect = null; resolve(true); } }, 'とばす'), true);
	});
}

// 控えのうち、場にいなくて倒れていないポケモンの番号を返す。いなければ -1。
function aliveBench(side) {
	return side.mons.findIndex((m, i) => i !== side.active && m.hp > 0);
}

async function runDemo(done) {
	try {
		await startGame({ kind: 'demo' });
		const g = S.game;
		const ans = await api('GET', `/api/game/${g.meta.gameId}/answer`);
		const live = setting('demoInteractive');
		await demoSay(live
			? '操作の練習です。実際の問題の画面を使い、正解の手順をあなた自身の操作で1手ずつ進めていきます。説明を読んだら「次へ」を押してください。「やってみましょう」と出たときは黄色い枠で囲んだ所を操作すると先へ進むことができます。'
			: '操作の紹介です。実際の問題の画面で正解の手順を1手ずつ進めていきます。「次へ」を押すと先へ進むことができます。');
		await demoSay(`上の帯には残りのターン数が出ます。この問題では、相手がどう動いても ${g.meta.length} ターン以内に確実に勝てる手順を探すことになります。`, '#game-header');
		await demoSay('場の右上にいるのが相手のポケモンで、左下にいるのがあなたのポケモンです。それぞれの名前とタイプ、HP のバーと数値、素早さを見ることができます。', '#field');
		if (setting('showOpponentMoves')) await demoSay('この欄には相手の場のポケモンの技が並んでいます。バーはあなたの場のポケモンの HP を表していて、斜線の部分がその技を受けたときに減る分です。欄の下には相手のポケモンの一覧があります。', '#side-foe');
		await demoSay('下の欄では使う技か交代先のポケモンを選びます。技のボタンに出ているのは、相手の場のポケモンに与えるダメージです。欄の右側にはあなたのポケモンの一覧があります。', '#controls');

		const foeSide = () => S.game.view.sides[1];
		const meSide = () => S.game.view.sides[0];
		const fb = aliveBench(foeSide());
		if (setting('clickBenchToRetarget') && setting('showDamageOnMoves') && fb >= 0) {
			const name = foeSide().mons[fb].name;
			if (live) {
				await demoWait(`相手の控えの ${name} をクリックしてください。`, `[data-bench="1:${fb}"]`, () => S.game.target === fb);
				await demoSay(`技のボタンのダメージが ${name} に当てたときの値に切り替わりました。相手が交代してくる場合を考えるときに使うことができます。`, '#controls');
				await demoWait(`相手の場のポケモン（${foeSide().mons[foeSide().active].name}）をクリックすると元に戻ります。`, `[data-bench="1:${foeSide().active}"]`, () => S.game.target === null);
			} else {
				await demoSay('相手の控えのポケモンをクリックすると、技のボタンのダメージがそのポケモンに当てたときの値に切り替わります。相手の交代を読むときに使うことができます。', '#side-foe');
			}
		}
		const mb = aliveBench(meSide());
		if (setting('clickMyBenchToRetarget') && setting('showOpponentMoves') && setting('showOpponentDamage') && mb >= 0) {
			const name = meSide().mons[mb].name;
			if (live) {
				await demoWait(`今度はあなたの控えの ${name} をクリックしてください。`, `[data-bench="0:${mb}"]`, () => S.game.myTarget === mb);
				await demoSay(`相手の技のダメージが ${name} の受ける値に切り替わりました。交代先を選ぶときの手がかりになります。`, '#side-foe');
				await demoWait(`あなたの場のポケモン（${meSide().mons[meSide().active].name}）をクリックすると元に戻ります。`, `[data-bench="0:${meSide().active}"]`, () => S.game.myTarget === null);
			} else {
				await demoSay('あなたの控えのポケモンをクリックすると、相手の技のダメージがそのポケモンの受ける値に切り替わります。交代先を選ぶときの手がかりになります。', '#side-me');
			}
		}
		if (setting('benchTooltip')) {
			const text = '控えのポケモンや交代のボタンにマウスを乗せると詳しい説明が出ます。説明には、そのポケモンの技と相手の場のポケモンとのあいだのダメージがのっています。';
			if (live) await demoWait(text + 'あなたのポケモンのどれかにマウスを乗せてみてください。', '#side-me', k => k.startsWith('hover:0:') || k.startsWith('hover:switch:'));
			else await demoSay(text, '#side-me');
		}
		if (setting('enableDamageTable')) {
			if (live) {
				await demoWait('右上のメニューにある「ダメージ表」を押してください。すべてのポケモンどうしのダメージを表で見ることができます。', '#menu', k => k === 'damageTable');
				await demoWait('表の上のタブを押すと「あなた → 相手」と「相手 → あなた」を切り替えられます。見終わったら「閉じる」で表を閉じてください。', null, k => k === 'modalClose');
				if (setting('menuTypeChart')) await demoSay('同じメニューからはタイプ相性表とルールもいつでも開くことができます。', '#menu');
			} else {
				await demoSay('右上のメニューからは、すべてのポケモンどうしのダメージをまとめたダメージ表とタイプ相性表をいつでも開くことができます。', '#menu');
			}
		}

		for (const st of ans.steps) {
			if (!S.game) return;
			const choice = S.game.view.choices.find(c => c.type === st.p1Action.type && c.index === st.p1Action.index);
			const sel = choice.type === 'move' ? `[data-move="${choice.index}"]` : `[data-switch="${choice.index}"]`;
			await playDemoStep(live, choice, st.p1, sel, `${st.turn}ターン目は「${st.p1}」を選びます。`);
			if (S.game.view.phase === 'replace' && st.p1Replace !== undefined) {
				const rc = S.game.view.choices.find(c => c.index === st.p1Replace);
				await playDemoStep(live, rc, rc.label, '#controls', 'あなたのポケモンが倒れたので次に出すポケモンを選びます。');
			}
			if (S.game.view.phase !== 'won') await demoSay('あなたと相手の動きとその結果は右のバトルログに残ります。', '#log');
		}
		const last = '勝てば正解です。間違えた手を選んで残りのターン数以内に確実に勝てなくなると失敗になります。失敗したときは、もう一度挑戦するかあきらめて解答を見るかを選ぶことができます。これで操作の練習は終わりです。';
		const again = setting('demoReplay')
			? await new Promise(resolve => showDemoBox(last + 'もう一度見たいときは「もう一度見る」を押してください。', '#controls', [
				h('button', { class: 'secondary', onclick: () => resolve(true) }, 'もう一度見る'),
				h('button', { class: 'primary', onclick: () => resolve(false) }, '終わる')]))
			: (await demoSay(last, '#controls'), false);
		closeDemo();
		api('POST', `/api/game/${S.game.meta.gameId}/rate`, { skip: true }).catch(() => {});
		S.game = null;
		renderMenu();
		if (again) return runDemo(done);
		done();
	} catch (e) { showError(e); }
}

// 1手を進める。チュートリアルでは被験者に押してもらい、とばしたときと自動のときはこちらで選ぶ。
async function playDemoStep(live, choice, label, sel, text) {
	if (!live) {
		await demoSay(text, sel);
		closeDemo();
		await act(choice);
		return;
	}
	demoExpect = { type: choice.type, index: choice.index, label };
	const skipped = await demoWait(`${text}「${label}」のボタンを押してください。`, sel, k => k === 'actDone');
	demoExpect = null;
	if (skipped) await act(choice);
}

// ---------- 操作確認 ----------
// 今の問題の画面で、各欄の役割を短く順に見せる。被験者の操作は待たない。
let guideRunning = false;
async function runQuickGuide() {
	if (!S.game || demoBox || guideRunning) return;
	uiEvent('quickGuide');
	guideRunning = true;
	const ms = Number(setting('quickGuideStepMs'));
	const steps = [
		['#game-header', '上の帯には残りのターン数が出ます。この数のターン以内に確実に勝つ手順を探すのが目標です。'],
		['#field', '右上にいるのが相手のポケモンで、左下にいるのがあなたのポケモンです。'],
		setting('showOpponentMoves') || setting('showBench') ? ['#side-foe', '相手の技と控えはこの欄に並んでいます。'
			+ (setting('clickBenchToRetarget') && setting('showDamageOnMoves') ? '相手の控えをクリックすると、技のボタンのダメージをそのポケモンへの値に切り替えられます。' : '')] : null,
		['#controls', '下の欄では使う技か交代先を選びます。技のボタンに出ているのは相手に与えるダメージです。'],
		setting('showBench') ? ['#side-me', (setting('clickMyBenchToRetarget') && setting('showOpponentMoves') && setting('showOpponentDamage') ? 'あなたの控えをクリックすると、相手の技のダメージの受け手を切り替えられます。' : 'あなたの控えはここに並んでいます。')
			+ (setting('benchTooltip') ? 'マウスを乗せれば詳しい説明も出ます。' : '')] : null,
		['#log', '選んだ手とその結果は右のバトルログに残り、あとから見返すこともできます。'],
	].filter(st => st && document.querySelector(st[0]));
	let stop = false;
	for (let i = 0; i < steps.length && !stop && S.game; i++) {
		const [sel, text] = steps[i];
		await new Promise(resolve => {
			// ms が 0 のときは自動で進めず、ボタンを待つ。
			const timer = ms > 0 ? setTimeout(resolve, ms) : null;
			const go = () => { clearTimeout(timer); resolve(); };
			showDemoBox([h('div', { class: 'demo-do guide' }, `操作確認 ${i + 1}/${steps.length}`), text,
				ms > 0 ? h('div', { class: 'guide-bar' }, h('div', { style: { animationDuration: `${ms}ms` } })) : null], sel, [
				h('button', { class: 'secondary', onclick: () => { stop = true; go(); } }, '閉じる'),
				h('button', { class: 'primary', onclick: go }, i === steps.length - 1 ? '終わる' : '次へ')]);
		});
	}
	closeDemo();
	guideRunning = false;
}

const BASE_FONTS = '"Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

// 設定のフォントを Google Fonts から読み込み、画面全体に使う。key を渡すとその候補を使う。
// 横長の配置で場が画面の高さに収まらないとき、場の中身を同じ比率で縮める。
function fitField() {
	const f = document.getElementById('field');
	if (!f || !f.closest('.game.wide')) return;
	const areas = [...f.querySelectorAll(':scope > .side-area')];
	areas.forEach(a => { a.style.zoom = ''; });
	if (!setting('fitFieldToScreen')) return;
	const cs = getComputedStyle(f);
	const room = f.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
	const need = areas.reduce((sum, a) => sum + a.offsetHeight, 0) + (parseFloat(cs.rowGap) || 0) * (areas.length - 1);
	let z = Math.min(1, room / need);
	// 縮めた後もはみ出すときは、収まるまで少しずつ縮める。
	for (let i = 0; z < 1 && i < 10; i++) {
		areas.forEach(a => { a.style.zoom = z; });
		if (f.scrollHeight <= f.clientHeight) break;
		z *= 0.95;
	}
}
window.addEventListener('resize', fitField);

// ログの列に画面の幅の 18%（280px 以上）を残し、残りの幅と高さに収まる倍率で拡大する。
// 幅が余ったら、相手の技と控えの欄を広げる（最大 SIDE_MAX px）。
const SIDE_MAX = 560;
function fitStage(done = false) {
	const st = document.getElementById('stage');
	if (!done) document.body.style.removeProperty('--uiz');
	if (!st) return;
	st.style.zoom = '';
	st.style.gridTemplateColumns = '';
	const ctl = st.querySelector('.controls');
	if (ctl) ctl.style.minHeight = '';
	const mode = setting('stageScale');
	if (mode !== 'auto') { st.style.zoom = Number(mode) / 100; return; }
	const game = st.parentElement;
	const cs = getComputedStyle(game);
	const colGap = parseFloat(cs.columnGap) || 0;
	const rowGap = parseFloat(cs.rowGap) || 0;
	const header = document.getElementById('game-header');
	const roomH = game.clientHeight - (header ? header.offsetHeight + rowGap : 0);
	const roomW = game.clientWidth - Math.max(280, game.clientWidth * 0.18) - colGap;
	const z = Math.min(roomH / st.offsetHeight, roomW / st.offsetWidth);
	let cur = Math.max(0.5, Math.min(3, z));
	st.style.zoom = cur;
	const extra = roomW / cur - st.offsetWidth;
	if (extra > 1) st.style.gridTemplateColumns = `640px ${Math.min(SIDE_MAX, 320 + extra)}px`;
	// 拡大すると文字の折り返しが変わって高さが増えることがあるので、ログの下端に収まるまで少しずつ縮める。
	const bottom = () => Math.min(game.getBoundingClientRect().bottom, window.innerHeight - 8);
	for (let i = 0; i < 20 && cur > 0.5 && st.getBoundingClientRect().bottom > bottom() + 0.5; i++) {
		cur *= 0.97;
		st.style.zoom = cur;
	}
	// 下に残った隙間は操作の欄を伸ばして埋め、下端をログの下端にそろえる。
	const gap = bottom() - st.getBoundingClientRect().bottom;
	if (ctl && gap > 0) ctl.style.minHeight = `${(ctl.getBoundingClientRect().height + gap) / cur}px`;
	// 見出し、ログ、上の帯の文字も同じ倍率で大きくし、その分だけ場の倍率を測り直す。
	// 説明を出している間に倍率が変わったときは、置き直す。
	placeTooltip(tooltipAnchor);
	if (setting('scaleOtherText') && !done && z > 1) {
		document.body.style.setProperty('--uiz', Math.min(3, z));
		fitStage(true);
	}
}
window.addEventListener('resize', () => fitStage());
// フォントを読み込み終えると文字の幅が変わるので、測り直す。
if (document.fonts) document.fonts.ready.then(() => fitStage());

function applyFont(key = setting('fontFamily')) {
	document.body.classList.toggle('round-corners', Boolean(setting('roundCorners')));
	const font = SettingsSchema.FONTS.find(f => f.key === key) || SettingsSchema.FONTS.find(f => f.key === 'system');
	const link = document.getElementById('webfont');
	if (font.query) {
		const href = `https://fonts.googleapis.com/css2?family=${font.query}&display=swap`;
		if (link.getAttribute('href') !== href) link.setAttribute('href', href);
		document.body.style.fontFamily = `"${font.family}", ${BASE_FONTS}`;
	} else {
		link.removeAttribute('href');
		document.body.style.fontFamily = '';
	}
}

// ---------- 起動 ----------

(async function main() {
	try {
		S.meta = await api('GET', '/api/meta');
		S.settings = S.meta.settings;
		applyFont();
		await openFromHash();
	} catch (e) { showError(e); }
})();

// URL の # で画面を直接開く（実験者が問題を確かめるとき用）。
//   #free=1277 … id 1277 を記録なしで解く。&open=damage|typechart|rules|settings でその画面も開く
//   &play=1,2 … 選ぶ手の番号（画面のボタンの並び順、1から）を順に選んで進める
//   &target=2 … 技のダメージの相手を相手の2番目のポケモンにする
//   &hover=セレクタ … その要素にマウスを乗せたときの説明を出す
//   #demo … プレイデモを見る
async function openFromHash() {
	const params = new URLSearchParams(location.hash.slice(1));
	if (params.has('demo')) return runDemo(() => showReception());
	if (!params.has('free')) return showReception();
	await startGame({ kind: 'free', puzzleId: Number(params.get('free')) });
	const open = params.get('open');
	for (const k of (params.get('play') || '').split(',').filter(Boolean).map(Number)) {
		if (S.game.meta.status !== 'playing' || S.game.view.phase === 'failed') break;
		await act(S.game.view.choices[k - 1]);
	}
	if (open === 'damage') await openDamageTable();
	if (open === 'typechart') openTypeChart();
	if (open === 'rules') openRules();
	if (open === 'settings') openSettings();
	// &target=2 … 技のダメージの相手を、相手の2番目のポケモンにする（表示の確認用）
	if (params.has('target')) { S.game.target = Number(params.get('target')) - 1; renderGame(); }
	// &hover=CSS のセレクタ … その要素にマウスを乗せたときの説明を出す（表示の確認用）
	// フォントを読み込み終えて倍率が決まってから乗せる。
	if (params.get('hover') && document.fonts) await document.fonts.ready;
	const target = params.get('hover') && document.querySelector(params.get('hover'));
	if (target) {
		const r = target.getBoundingClientRect();
		target.dispatchEvent(new MouseEvent('mouseenter', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
	}
}

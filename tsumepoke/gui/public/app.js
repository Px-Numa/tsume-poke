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
	if (!S.game || !setting('recordUiEvents')) return;
	if (kind.startsWith('hover') && !setting('recordHover')) return;
	api('POST', `/api/game/${S.game.meta.gameId}/ui`, { kind, detail }).catch(() => {});
}

// ---------- モーダル ----------

function openModal(title, body, onClose) {
	const root = document.getElementById('modal-root');
	const close = () => {
		back.remove();
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
		h('p', { class: 'muted' }, '行が技のタイプ、列が受けるポケモンのタイプです。赤は効果ばつぐん（×2）、青はいまひとつ（×½）、黒は効果なし（×0）。タイプが2つあるポケモンには、2つの倍率を掛けた値になります。見出しをクリックすると、その行・列を強調します。'),
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
				`${dir === 0 ? '相手' : 'あなた'} ${m.name}`, h('br'), h('span', { class: 'muted' }, `${j === defSide.active ? '場' : '控え'}・HP ${m.hp}/${m.maxhp}`)))));
		table[dir].forEach(({ mon, rows }) => {
			const am = atkSide.mons[mon];
			rows.forEach((cells, k) => {
				const mv = am.moves[k];
				t.append(h('tr', { class: am.hp <= 0 ? 'dim' : '' },
					h('td', { class: 'left' }, k === 0 ? h('b', {}, am.name + (mon === atkSide.active ? '（場）' : '')) : '', k === 0 ? h('br') : '',
						h('span', { class: 'type', style: { background: TYPE_COLORS[mv.type] } }, mv.typeName), ' ', mv.name),
					cells.map((c, j) => h('td', { class: (j === defSide.active ? 'activecol ' : '') + (setting('markKO') && c.ko ? 'kocell' : '') },
						formatDamage(c), setting('markKO') && c.ko ? ' 倒せる' : ''))));
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
		h('p', { class: 'muted' }, `エンジン：${S.meta.engine.label}。灰色の項目は、このエンジンがまだ対応していない要素です。対応したエンジンに切り替えると使えるようになります。保存した設定は config/settings.json に入り、被験者の記録にも写されます。`),
		Object.entries(groups).map(([g, list]) => h('div', { class: 'settings-group' }, h('h4', {}, g), list.map(s => settingRow(s, values, features)))),
		h('div', { class: 'row' },
			h('button', { class: 'primary', onclick: async () => {
				try {
					S.settings = await api('POST', '/api/settings', values);
					close();
					renderMenu();
					if (S.game) renderGame();
				} catch (e) { showError(e); }
			} }, '保存する'),
			h('button', { class: 'danger', onclick: async () => {
				if (!confirm('すべての設定を初期値に戻しますか？')) return;
				S.settings = await api('POST', '/api/settings/reset');
				close();
				renderMenu();
				if (S.game) renderGame();
			} }, '初期値に戻す')));
	const close = openModal('設定', body);
}

function settingRow(s, values, features) {
	const ok = SettingsSchema.supported(s, features);
	let input;
	if (s.type === 'bool') {
		input = h('input', { type: 'checkbox', disabled: !ok, onchange: e => { values[s.key] = e.target.checked; } });
		input.checked = Boolean(values[s.key]);
	} else if (s.type === 'select') {
		const allowed = s.requires ? SettingsSchema.supportedOptions(s, features).map(([v]) => v) : s.options.map(([v]) => v);
		input = h('select', { disabled: !ok, onchange: e => { values[s.key] = e.target.value; } },
			s.options.map(([v, label]) => h('option', { value: v, disabled: !allowed.includes(v) }, label + (allowed.includes(v) ? '' : '（未対応）'))));
		input.value = values[s.key];
	} else if (s.type === 'number') {
		input = h('input', { type: 'number', min: s.min, max: s.max, value: values[s.key], disabled: !ok, style: { width: '90px' }, onchange: e => { values[s.key] = Number(e.target.value); } });
	} else {
		input = h('input', { type: 'text', value: values[s.key], disabled: !ok, onchange: e => { values[s.key] = e.target.value; } });
	}
	return h('div', { class: 'setting' + (ok ? '' : ' off') },
		h('div', {}, input),
		h('div', {}, s.label, ok ? '' : h('span', { class: 'unsupported' }, 'このエンジンは未対応'), s.help ? h('div', { class: 'help' }, s.help) : null));
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
			h('p', { class: 'muted' }, '被験者 ID を入れて始めます。同じ ID を入れると、続きから再開します。'),
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
		h('p', {}, 'これから、ポケモンの対戦を使ったパズルを解いてもらいます。'),
		S.meta.rules.map(r => h('div', { class: 'card' }, h('h4', { style: { margin: '0 0 6px' } }, r.title), h('div', {}, r.body))),
		setting('menuTypeChart') || setting('menuRules') ? h('p', { class: 'muted' }, '画面右上のメニューから、タイプ相性表とこのルールをいつでも開けます。') : null,
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
		h('p', {}, `${S.summary.done} 問が終わりました（全 ${S.summary.total} 問）。疲れていたら、少し休んでから次へ進んでください。`),
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
		S.game = { meta: out.meta, view: out.view, display: out.view, damage: null, target: null, log: [], busy: false, startedAt: Date.now() - out.meta.elapsed * 1000, answer: null };
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
		setting('showTurnCounter') ? h('div', { class: 'remaining' }, '残り ', h('b', {}, v.remaining), ' ターン以内に、確実に勝つ') : h('div', {}, '確実に勝つ手順を探す'),
		h('span', { class: 'muted' }, `（${g.meta.length}ターンの問題）`),
		h('div', { class: 'spacer' }),
		setting('showAttemptCount') ? h('span', {}, `${g.meta.attempt} 回目の挑戦`) : null,
		setting('showTimer') || Number(setting('timeLimitSec')) > 0 ? h('span', { id: 'timer' }, '') : null,
		Number(setting('timeLimitSec')) > 0 ? h('span', { class: 'muted' }, `（制限 ${setting('timeLimitSec')} 秒）`) : null);
	const field = h('div', { class: 'field', id: 'field' }, renderSide(v, 1), renderSide(v, 0));
	const log = setting('showBattleLog') ? h('div', { class: 'log', id: 'log' }, g.log.map(renderLogLine)) : h('div', { class: 'log muted' }, 'バトルログは表示しない設定です。');
	const controls = h('div', { class: 'controls' + (g.busy ? ' busy' : ''), id: 'controls' }, renderControls());
	app().replaceChildren(h('div', { class: 'game' }, header, field, log, controls));
	const logEl = document.getElementById('log');
	if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function renderLogLine(line) {
	return h('div', { class: line.kind === 'turn' ? 'turn' : line.kind === 'result' ? 'result' + (line.fail ? ' fail' : '') : line.kind === 'attempt' ? 'attempt' : '' }, line.text);
}

function spriteFor(mon) {
	if (setting('showSprites') && S.meta.sprites[mon.species]) {
		return h('div', { class: 'sprite' }, h('img', { src: `/sprites/${S.meta.sprites[mon.species]}`, alt: mon.name }));
	}
	const color = TYPE_COLORS[mon.types[0].type] || '#888';
	const color2 = mon.types[1] ? TYPE_COLORS[mon.types[1].type] : color;
	return h('div', { class: 'sprite' }, h('div', { class: 'ball', style: { background: `linear-gradient(135deg, ${color} 50%, ${color2} 50%)` } }, mon.name.slice(0, 1)));
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

function monCard(v, s, mon) {
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
	if (s === 1 && setting('showOpponentMoves') && mon.hp > 0) {
		const myActive = v.sides[0].active;
		const rows = S.game.damage ? S.game.damage[1][mon.index].rows : null;
		parts.push(h('div', { class: 'foe-moves' }, h('div', { class: 'muted' }, '相手の技'),
			mon.moves.map((mv, k) => h('div', {},
				h('span', { class: 'type', style: { background: TYPE_COLORS[mv.type] } }, mv.typeName),
				h('span', {}, mv.name),
				setting('showMoveDetails') ? h('span', { class: 'muted' }, `${mv.category}・威力 ${mv.power}${mv.priority ? `・優先度 ${mv.priority > 0 ? '+' : ''}${mv.priority}` : ''}`) : null,
				setting('showOpponentDamage') && rows ? h('b', {}, `→ ${v.sides[0].mons[myActive].name} に ${formatDamage(rows[k][myActive])}`) : null))));
	}
	return h('div', { class: 'mon-card' }, parts);
}

function renderSide(v, s) {
	const side = v.sides[s];
	const mon = side.mons[side.active];
	const g = S.game;
	const target = g.target === null ? v.sides[1].active : g.target;
	const bench = setting('showBench') ? h('div', {},
		h('div', { class: 'bench-label' }, s === 1 ? '相手のポケモン' : 'あなたのポケモン',
			s === 1 && setting('clickBenchToRetarget') && setting('showDamageOnMoves') ? '（クリックで、技のダメージの相手を切り替え）' : ''),
		h('div', { class: 'bench' }, side.mons.map((m, i) => {
			const clickable = s === 1 && setting('clickBenchToRetarget') && setting('showDamageOnMoves') && m.hp > 0;
			const el = h('div', {
				class: ['mini', m.hp <= 0 ? 'fainted' : '', i === side.active ? 'active' : '', s === 1 && i === target && g.target !== null ? 'target' : '', clickable ? 'clickable' : ''].join(' '),
				onclick: clickable ? () => { g.target = i === v.sides[1].active ? null : i; uiEvent('retarget', i); renderGame(); } : null,
			}, m.name, h('div', { class: 'minihp' }, h('div', { style: { width: `${Math.max(0, m.hp / m.maxhp) * 100}%`, background: hpColor(m.hp / m.maxhp) } })));
			if (setting('benchTooltip')) attachTooltip(el, () => monTooltip(v, s, m), `hover:${s}:${i}`);
			return el;
		}))) : null;
	return h('div', { class: 'side-area ' + (s === 1 ? 'foe' : 'me'), id: s === 1 ? 'side-foe' : 'side-me' }, spriteFor(mon), h('div', {}, monCard(v, s, mon), bench));
}

function monTooltip(v, s, m) {
	return h('div', {},
		h('b', {}, m.name), ' ', m.types.map(t => t.name).join('/'), h('br'),
		`HP ${m.hp} / ${m.maxhp}　素早さ ${m.stats.spe}`, h('br'),
		`攻撃 ${m.stats.atk}　防御 ${m.stats.def}　特攻 ${m.stats.spa}　特防 ${m.stats.spd}`, h('br'),
		h('div', { style: { marginTop: '4px' } }, '技：', m.moves.map(mv => `${mv.name}（${mv.typeName}・威力 ${mv.power}${mv.priority ? `・優先度 ${mv.priority}` : ''}）`).join('、')));
}

let tooltipEl = null;
function attachTooltip(el, make, logKind) {
	el.addEventListener('mouseenter', e => {
		tooltipEl = h('div', { class: 'tooltip' }, make());
		document.body.append(tooltipEl);
		moveTooltip(e);
		if (logKind) uiEvent(logKind.startsWith('hover') ? logKind : 'hover:' + logKind);
	});
	el.addEventListener('mousemove', moveTooltip);
	el.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.remove(); tooltipEl = null; });
}
function moveTooltip(e) {
	if (!tooltipEl) return;
	tooltipEl.style.left = Math.min(e.clientX + 14, window.innerWidth - 360) + 'px';
	tooltipEl.style.top = (e.clientY + 14) + 'px';
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
			return h('button', { class: 'switchbtn', onclick: () => act(c) }, h('b', {}, m.name), h('br'), h('span', { class: 'muted' }, `HP ${m.hp}/${m.maxhp}`));
		})));
		return out;
	}
	const me = v.sides[0].mons[v.sides[0].active];
	const target = g.target === null ? v.sides[1].active : g.target;
	const targetMon = v.sides[1].mons[target];
	const rows = g.damage ? g.damage[0][me.index].rows : null;
	if (setting('showDamageOnMoves') && g.target !== null) {
		out.push(h('div', { class: 'target-note' }, `技のダメージは、相手の控えの ${targetMon.name} に当てたときの値です（場のポケモンではありません）。`, ' ',
			h('a', { href: '#', onclick: e => { e.preventDefault(); g.target = null; renderGame(); } }, '場のポケモンに戻す')));
	}
	out.push(h('h4', {}, `${me.name} の技`));
	out.push(h('div', { class: 'moves', id: 'moves' }, v.choices.filter(c => c.type === 'move').map(c => {
		const mv = me.moves[c.index];
		const cell = rows ? rows[c.index][target] : null;
		const btn = h('button', { class: 'movebtn', style: { background: TYPE_COLORS[mv.type] || '#888' }, onclick: () => act(c), 'data-move': c.index },
			h('div', { class: 'mname' }, mv.name),
			setting('showMoveDetails') ? h('div', { class: 'mdetail' }, `${mv.typeName}・${mv.category}・威力 ${mv.power}${mv.priority ? `・優先度 ${mv.priority > 0 ? '+' : ''}${mv.priority}` : ''}${feature('accuracy') && setting('showMoveAccuracy') && mv.accuracy ? `・命中 ${mv.accuracy}` : ''}`) : null,
			setting('showDamageOnMoves') && cell ? h('div', { class: 'mdmg' }, `→ ${targetMon.name} に ${formatDamage(cell)}`, setting('markKO') && cell.ko ? h('span', { class: 'ko' }, '倒せる') : null) : null);
		if (setting('showMoveDescription') && mv.description) attachTooltip(btn, () => mv.description, `hover:move:${c.index}`);
		else if (setting('recordHover')) btn.addEventListener('mouseenter', () => uiEvent(`hover:move:${c.index}`));
		return btn;
	})));
	const switches = v.choices.filter(c => c.type === 'switch');
	if (switches.length) {
		out.push(h('h4', {}, '交代'));
		out.push(h('div', { class: 'switches', id: 'switches' }, switches.map(c => {
			const m = v.sides[0].mons[c.index];
			const btn = h('button', { class: 'switchbtn', onclick: () => act(c), 'data-switch': c.index }, h('b', {}, m.name), ' ', m.types.map(t => t.name).join('/'), h('br'), h('span', { class: 'muted' }, `HP ${m.hp}/${m.maxhp}　素早さ ${m.stats.spe}`));
			if (setting('benchTooltip')) attachTooltip(btn, () => monTooltip(v, 0, m), `hover:switch:${c.index}`);
			return btn;
		})));
	}
	if (setting('allowGiveUp') && setting('giveUpAnytime') && g.meta.kind !== 'demo') {
		out.push(h('div', { class: 'row', style: { marginTop: '12px', justifyContent: 'flex-end' } },
			h('button', { class: 'danger', onclick: () => { if (confirm('あきらめて解答を見ますか？')) giveUp('gaveUp'); } }, 'あきらめて解答を見る')));
	}
	return out;
}

function renderAnswer(ans) {
	return h('div', {},
		h('h4', {}, '解答の手順（相手は最長の受けを選ぶ）'),
		ans.steps.map(st => h('div', { class: 'answer-step' },
			h('b', {}, `${st.turn}ターン目：あなた「${st.p1}」／相手「${st.p2}」`),
			st.events.map(e => h('div', { class: 'ev' }, e)),
			st.after ? h('div', { class: 'ev' }, st.after) : null)),
		setting('showRefutations') && ans.refutations.length ? h('div', {},
			h('h4', {}, '正解以外の初手と、それに対する相手の受け'),
			ans.refutations.map(r => h('div', { class: 'ev' }, `「${r.p1}」→ 相手「${r.p2}」で${r.verdict}`))) : null);
}

async function act(choice) {
	const g = S.game;
	if (g.busy) return;
	if (setting('confirmAction') && !confirm(`「${choice.label}」でよいですか？`)) return;
	g.busy = true;
	g.target = null;
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
}

// 出来事を1つずつ出し、HP と場のポケモンを途中の値で書き換える。
async function playEvents(events) {
	const g = S.game;
	const display = JSON.parse(JSON.stringify(g.display));
	g.display = display;
	for (const ev of events) {
		g.log.push({ kind: ev.kind, text: ev.text, fail: ev.kind === 'result' && !ev.text.includes('勝ち') });
		if (ev.hp) display.sides[ev.hp.side].mons[ev.hp.index].hp = ev.hp.hp;
		if (ev.active) display.sides[ev.active.side].active = ev.active.index;
		renderGame();
		await sleep(Number(setting('eventDelayMs')));
	}
}

async function retry() {
	const g = S.game;
	try {
		const out = await api('POST', `/api/game/${g.meta.gameId}/retry`);
		g.meta = out.meta;
		g.view = out.view;
		g.display = out.view;
		g.target = null;
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
	const comment = h('textarea', { placeholder: 'なぜ面白い・つまらないか、どこで迷ったかなど（空でもかまいません）' });
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

// ---------- プレイデモ ----------

let demoBox = null;
function closeDemo() {
	if (demoBox) demoBox.remove();
	demoBox = null;
	document.querySelectorAll('.demo-hl').forEach(el => el.classList.remove('demo-hl'));
}

// 吹き出しを出して「次へ」を待つ。target は強調する要素の id。
function demoSay(text, target) {
	return new Promise(resolve => {
		if (demoBox) demoBox.remove();
		document.querySelectorAll('.demo-hl').forEach(el => el.classList.remove('demo-hl'));
		if (target) {
			const el = typeof target === 'string' ? document.getElementById(target) : target;
			if (el) el.classList.add('demo-hl');
		}
		demoBox = h('div', { class: 'demo-box' }, h('div', {}, text),
			h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => resolve() }, '次へ')));
		document.body.append(demoBox);
	});
}

async function runDemo(done) {
	try {
		await startGame({ kind: 'demo' });
		const g = S.game;
		const ans = await api('GET', `/api/game/${g.meta.gameId}/answer`);
		await demoSay('操作の紹介です。実際の問題の画面で、正解の手順を1手ずつ進めてみます。「次へ」で進みます。');
		await demoSay(`上の帯に、残りのターン数が出ます。この問題は ${g.meta.length} ターン以内に、相手がどう動いても確実に勝つ手順を探します。`, 'game-header');
		await demoSay('右上が相手のポケモン、左下があなたのポケモンです。名前、タイプ、HP、素早さが出ます。小さく並んでいるのは控えのポケモンです。', 'field');
		if (setting('showOpponentMoves')) await demoSay('相手のポケモンの欄には、相手の技と、その技であなたの場のポケモンが受けるダメージが出ます。', 'side-foe');
		await demoSay('下のボタンで、使う技か交代するポケモンを選びます。技のボタンの数字は、相手の場のポケモンに与えるダメージです。', 'controls');
		if (setting('clickBenchToRetarget') && setting('showDamageOnMoves')) await demoSay('相手の控えのポケモンをクリックすると、技のボタンのダメージが、そのポケモンに当てたときの値に切り替わります。相手の交代を読むときに使います。', 'side-foe');
		if (setting('enableDamageTable') || setting('menuTypeChart')) await demoSay('右上のメニューから、ダメージ表（すべてのポケモンどうしのダメージ）やタイプ相性表を、いつでも開けます。', 'menu');
		for (const st of ans.steps) {
			if (!S.game) return;
			const v = S.game.view;
			const choice = v.choices.find(c => c.type === st.p1Action.type && c.index === st.p1Action.index);
			const btn = document.querySelector(choice.type === 'move' ? `[data-move="${choice.index}"]` : `[data-switch="${choice.index}"]`);
			await demoSay(`${st.turn}ターン目は「${st.p1}」を選びます。`, btn);
			closeDemo();
			await act(choice);
			if (S.game.view.phase === 'replace' && st.p1Replace !== undefined) {
				await demoSay('あなたのポケモンが倒れたので、次に出すポケモンを選びます。', 'controls');
				closeDemo();
				await act(S.game.view.choices.find(c => c.index === st.p1Replace));
			}
			if (S.game.view.phase !== 'won') await demoSay('相手の動きと結果は、右のバトルログに出ます。', 'log');
		}
		await demoSay('勝てば正解です。間違えて、残りのターン数以内に確実に勝てなくなると失敗になり、もう一度挑戦するか、あきらめて解答を見るかを選べます。これで操作の紹介は終わりです。', 'controls');
		closeDemo();
		api('POST', `/api/game/${S.game.meta.gameId}/rate`, { skip: true }).catch(() => {});
		S.game = null;
		renderMenu();
		done();
	} catch (e) { showError(e); }
}

// ---------- 起動 ----------

(async function main() {
	try {
		S.meta = await api('GET', '/api/meta');
		S.settings = S.meta.settings;
		await openFromHash();
	} catch (e) { showError(e); }
})();

// URL の # で画面を直接開く（実験者が問題を確かめるとき用）。
//   #free=1277 … id 1277 を記録なしで解く。&open=damage|typechart|rules|settings でその画面も開く
//   &play=1,2 … 選ぶ手の番号（画面のボタンの並び順、1から）を順に選んで進める
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
}

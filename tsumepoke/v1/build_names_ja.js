'use strict';
// 出題画面用の日本語名の表（names_ja.json）を作る。
// PS には日本語名がないので、PokeAPI の CSV からポケモン・技・タイプの日本語名を取り出す。
//
// 実行方法：node tsumepoke/v1/build_names_ja.js <CSV を置いたフォルダ>
// フォルダには https://github.com/PokeAPI/pokeapi の data/v2/csv/ から次の CSV を入れておく。
//   pokemon_species_names.csv, pokemon_forms.csv, pokemon_form_names.csv, move_names.csv, type_names.csv
//
// 言語は id 1（ja-hrkt、かな表記）。ゲームと同じ表記（じしん、１０まんボルトなど）になる。
// 対応が見つからない名前は一覧に出し、表には入れない（出題画面では英語名になる）。

const fs = require('fs');
const path = require('path');
const { dex, buildMovePool, buildSpeciesPool } = require('./data');

const JA = '1';
const EN = '9';
const OUT = path.join(__dirname, 'names_ja.json');

// PS と PokeAPI でフォルムの識別子が違うもの（値が PokeAPI 側）。
const FORM_ALIAS = {
	'basculegion-f': 'basculegion-female',
	'meowstic-f': 'meowstic-female',
	'indeedee-f': 'indeedee-female',
	'oinkologne-f': 'oinkologne-female',
	'necrozma-dusk-mane': 'necrozma-dusk',
	'ogerpon-wellspring': 'ogerpon-wellspring-mask',
};
// 手で付けた名前。PokeAPI では区別できないもの（パルデアのケンタロスは3種とも「パルデアのすがた」）と、
// フォルム名が載っていないもの（きずなへんげのゲッコウガ）。
const MANUAL = {
	'taurospaldeacombat': 'ケンタロス（コンバット種）',
	'taurospaldeablaze': 'ケンタロス（ブレイズ種）',
	'taurospaldeaaqua': 'ケンタロス（ウォーター種）',
	'greninjabond': 'ゲッコウガ（きずなへんげ）',
};

// CSV を読む。引用符で囲まれた欄の中のカンマでは区切らない。
function parseCsv(file) {
	const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
	const rows = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line) continue;
		const cells = [];
		let cur = '';
		let quoted = false;
		for (const ch of line) {
			if (ch === '"') quoted = !quoted;
			else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
			else cur += ch;
		}
		cells.push(cur);
		rows.push(cells);
	}
	return rows.slice(1);
}

function main() {
	const dir = process.argv[2];
	if (!dir) throw new Error('CSV を置いたフォルダを指定してください');
	const csv = name => parseCsv(path.join(dir, name + '.csv'));

	const speciesJa = new Map(csv('pokemon_species_names').filter(r => r[1] === JA).map(r => [r[0], r[2]]));
	const formIdByIdentifier = new Map(csv('pokemon_forms').map(r => [r[1], r[0]]));
	const formJa = new Map(csv('pokemon_form_names').filter(r => r[1] === JA).map(r => [r[0], { form: r[2], pokemon: r[3] }]));
	const moveJa = new Map(csv('move_names').filter(r => r[1] === JA).map(r => [r[0], r[2]]));
	const typeRows = csv('type_names');
	const typeJa = new Map(typeRows.filter(r => r[1] === JA).map(r => [r[0], r[2]]));

	const out = { species: {}, moves: {}, types: {} };
	const missing = [];

	// タイプは英語名で対応させる（PokeAPI の type_id と PS の並びが一致しないため）。
	for (const r of typeRows.filter(r => r[1] === EN)) {
		if (dex.types.get(r[2]).exists && typeJa.has(r[0])) out.types[r[2]] = typeJa.get(r[0]);
	}
	for (const t of dex.types.all()) if (!out.types[t.name]) missing.push(`タイプ ${t.name}`);

	// 技は PS の num と PokeAPI の move_id が同じなので番号で引く。
	const movePool = buildMovePool();
	for (const id of movePool.keys()) {
		const m = dex.moves.get(id);
		if (moveJa.has(String(m.num))) out.moves[id] = moveJa.get(String(m.num));
		else missing.push(`技 ${m.name}`);
	}

	// ポケモンは全国図鑑番号で引き、フォルム違い（Ninetales-Alola など）は PokeAPI のフォルム名で引く。
	// 専用の名前（pokemon_name）があればそれを、なければ「キュウコン（アローラのすがた）」の形にする。
	for (const sp of buildSpeciesPool(movePool)) {
		const s = dex.species.get(sp.id);
		const base = speciesJa.get(String(s.num));
		if (!base) { missing.push(`ポケモン ${s.name}`); continue; }
		if (MANUAL[sp.id]) { out.species[sp.id] = MANUAL[sp.id]; continue; }
		if (!s.forme) { out.species[sp.id] = base; continue; }
		const ident = s.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
		const formId = formIdByIdentifier.get(FORM_ALIAS[ident] || ident);
		const f = formId && formJa.get(formId);
		if (f && f.pokemon) out.species[sp.id] = f.pokemon;
		// 「ウォッシュロトム」のようにフォルム名がそのまま呼び名のものは、元の名前を重ねない。
		else if (f && f.form && f.form.includes(base)) out.species[sp.id] = f.form;
		else if (f && f.form) out.species[sp.id] = `${base}（${f.form}）`;
		else missing.push(`ポケモン ${s.name}（フォルム名が見つからない）`);
	}

	fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
	const count = o => Object.keys(o).length;
	console.log(`ポケモン ${count(out.species)}、技 ${count(out.moves)}、タイプ ${count(out.types)} の日本語名を書き出した → ${OUT}`);
	if (missing.length) console.log('対応が見つからなかったもの:\n  ' + missing.join('\n  '));
}

main();

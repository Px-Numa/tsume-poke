'use strict';
// 問題に出てくるポケモンの画像を Pokemon Showdown の画像サーバから取ってきて public/sprites に保存する。
// 使い方：node tsumepoke/gui/fetch_sprites.js [puzzles.json のパス] [--force]
//   正面の画像は public/sprites/<id>.png（ないときは <id>.gif）、背面の画像は public/sprites/back/<id>.png に置く。
//   すでにあるファイルは取り直さない（--force で取り直す）。

const fs = require('fs');
const path = require('path');
const { Dex } = require('../../pokemon-showdown/dist/sim');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const positional = args.filter(a => a !== '--force');
const PUZZLES = positional[0] || path.join(__dirname, '..', 'v1', 'puzzles.json');
const OUT = path.join(__dirname, 'public', 'sprites');
const BASE = 'https://play.pokemonshowdown.com/sprites';
// 上から順に試し、最初に取れたものを使う。
// チャンピオンズの新しいメガシンカの姿は gen5 などになく、動く画像（ani の gif）しかないので最後に試す。
// 背面の画像がないポケモンは、GUI が正面の画像を使う。
const FRONT = ['gen5', 'dex', 'home', 'ani'];
const BACK = ['gen5-back'];
const EXT = dir => (dir === 'ani' ? 'gif' : 'png');
const WAIT_MS = 150;

function speciesIds(file) {
	const data = JSON.parse(fs.readFileSync(file, 'utf8'));
	const list = Array.isArray(data) ? data : data.puzzles;
	const ids = new Set();
	for (const p of list) for (const side of p.state.sides) for (const m of side.mons) ids.add(m.species);
	return [...ids].sort();
}

async function download(url) {
	const res = await fetch(url, { headers: { 'User-Agent': 'tsumepoke-research-gui' } });
	if (!res.ok) return null;
	return Buffer.from(await res.arrayBuffer());
}

// dest は拡張子を除いた保存先。
async function fetchOne(id, dirs, dest) {
	if (!FORCE && ['png', 'gif'].some(ext => fs.existsSync(`${dest}.${ext}`))) return 'skip';
	// 第9世代の図鑑にない姿（チャンピオンズの新しいメガシンカなど）はチャンピオンズの図鑑から引く。
	const base = Dex.species.get(id);
	const spriteid = (base.exists ? base : Dex.mod('champions').species.get(id)).spriteid;
	for (const dir of dirs) {
		const buf = await download(`${BASE}/${dir}/${spriteid}.${EXT(dir)}`);
		await new Promise(r => setTimeout(r, WAIT_MS));
		if (buf) {
			fs.writeFileSync(`${dest}.${EXT(dir)}`, buf);
			return dir;
		}
	}
	return null;
}

async function main() {
	const ids = speciesIds(PUZZLES);
	fs.mkdirSync(path.join(OUT, 'back'), { recursive: true });
	console.log(`${ids.length} 種類の画像を取る → ${OUT}`);
	const missing = [];
	const count = { got: 0, skip: 0 };
	for (const [i, id] of ids.entries()) {
		const front = await fetchOne(id, FRONT, path.join(OUT, id));
		const back = await fetchOne(id, BACK, path.join(OUT, 'back', id));
		for (const [kind, r] of [['正面', front], ['背面', back]]) {
			if (r === 'skip') count.skip++;
			else if (r) count.got++;
			else missing.push(`${id}（${kind}）`);
		}
		if (process.stderr.isTTY) process.stderr.write(`\r${i + 1}/${ids.length} ${id}          `);
	}
	if (process.stderr.isTTY) process.stderr.write('\n');
	console.log(`取った：${count.got}、すでにあった：${count.skip}、取れなかった：${missing.length}`);
	if (missing.length) console.log('取れなかった画像：' + missing.join('、'));
}

main().catch(e => { console.error(e); process.exit(1); });

'use strict';
// 問題セットの読み込みと、被験者への割り当て。
//
// 問題セットは sets/<名前>.json に置く。
//   { "name", "description", "puzzlesFile"（gui フォルダからの相対パス）, "mode", "ids" または "sample" }
//   mode が 'fixed' なら ids の問題を全員に出す（順番は設定 shuffleOrder でシャッフル）。
//   mode が 'sample' なら被験者ごとに sample.per 問ずつターン数ごとに乱数で選ぶ。延長法の同じ系列からは1問まで。
// 乱数の種は「セットの名前 + 被験者 ID」から作るので、同じ被験者 ID なら同じ問題と順番になる。

const fs = require('fs');
const path = require('path');

const SETS_DIR = path.join(__dirname, 'sets');

function listSets() {
	if (!fs.existsSync(SETS_DIR)) return [];
	return fs.readdirSync(SETS_DIR).filter(f => f.endsWith('.json')).map(f => {
		const set = JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), 'utf8'));
		return { file: f.replace(/\.json$/, ''), name: set.name, description: set.description, mode: set.mode };
	});
}

function loadSet(file) {
	if (!/^[\w-]+$/.test(file)) throw new Error('問題セットの名前が正しくない');
	return JSON.parse(fs.readFileSync(path.join(SETS_DIR, file + '.json'), 'utf8'));
}

function loadPuzzles(set) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, set.puzzlesFile || '../v1/puzzles.json'), 'utf8'));
}

// 文字列から32ビットの種を作る（FNV-1a）。
function hashSeed(text) {
	let h = 0x811c9dc5;
	for (const ch of text) {
		h ^= ch.codePointAt(0);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

// generate.js と同じ mulberry32。
function makeRng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(arr, rand) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function rootOf(puzzles, p) {
	while (p.origin && p.origin.method === 'extend') p = puzzles[p.origin.from];
	return p.id;
}

// rate.js と同じ選び方。長い問題から選ぶ。
function sample(puzzles, per, lengths, rand) {
	const all = lengths || [...new Set(puzzles.map(p => p.length))];
	const usedRoots = new Set();
	const picked = [];
	for (const len of [...all].sort((x, y) => y - x)) {
		let n = 0;
		for (const p of shuffle(puzzles.filter(q => q.length === len), rand)) {
			if (n >= per) break;
			const root = rootOf(puzzles, p);
			if (usedRoots.has(root)) continue;
			usedRoots.add(root);
			picked.push(p);
			n++;
		}
	}
	return picked;
}

// 被験者に出す問題の列を返す。問題の局面も写す。
function assign(setFile, participant, shuffleOrder) {
	const set = loadSet(setFile);
	const puzzles = loadPuzzles(set);
	const rand = makeRng(hashSeed(set.name + '\u0000' + participant));
	let picked;
	if (set.mode === 'sample') {
		picked = sample(puzzles, set.sample.per, set.sample.lengths, rand);
	} else {
		picked = set.ids.map(id => {
			const p = puzzles[id];
			if (!p || p.id !== id) throw new Error(`問題 id ${id} が ${set.puzzlesFile} にない`);
			return p;
		});
	}
	if (shuffleOrder) picked = shuffle(picked, rand);
	return { set, items: picked.map((p, i) => ({ order: i + 1, id: p.id, length: p.length, puzzle: p, result: null })) };
}

function puzzleById(id, puzzlesFile) {
	const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, puzzlesFile || '../v1/puzzles.json'), 'utf8'));
	const p = puzzles[id];
	if (!p || p.id !== id) throw new Error(`問題 id ${id} がない`);
	return p;
}

module.exports = { listSets, loadSet, assign, puzzleById, sample, makeRng, hashSeed };

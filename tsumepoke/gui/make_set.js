'use strict';
// 問題セット（sets/<名前>.json）を作る。
//
// 実行方法：
//   node tsumepoke/gui/make_set.js <名前> --ids 12,34,56        … 決めた問題を全員に出すセット
//   node tsumepoke/gui/make_set.js <名前> --sample 10            … 被験者ごとにターン数ごとに10問ずつ選ぶセット
//   node tsumepoke/gui/make_set.js <名前> --from-ratings ../v1/ratings_1.json … rate.js で評価した問題と同じ問題のセット
// どれも --puzzles <gui フォルダからの相対パス> で問題のファイルを変えられる（初期値は ../v1/puzzles.json）。
// --description "説明" で説明文を付けられる。

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[\w-]+$/.test(name)) throw new Error('1つ目の引数にセットの名前（英数字、-、_）を指定してください');
const opt = key => {
	const i = args.indexOf(key);
	return i >= 0 ? args[i + 1] : undefined;
};
const puzzlesFile = opt('--puzzles') || '../v1/puzzles.json';
const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, puzzlesFile), 'utf8'));

let set;
if (opt('--ids')) {
	const ids = opt('--ids').split(',').map(Number);
	for (const id of ids) if (!puzzles[id]) throw new Error(`問題 id ${id} がない`);
	set = { mode: 'fixed', ids };
} else if (opt('--sample')) {
	set = { mode: 'sample', sample: { per: Number(opt('--sample')) } };
} else if (opt('--from-ratings')) {
	const session = JSON.parse(fs.readFileSync(path.join(__dirname, opt('--from-ratings')), 'utf8'));
	const ids = session.items.map(it => it.id);
	for (const it of session.items) {
		if (JSON.stringify(puzzles[it.id]) !== JSON.stringify(it.puzzle)) throw new Error(`問題 id ${it.id} の中身が ${puzzlesFile} と違う`);
	}
	set = { mode: 'fixed', ids };
} else {
	throw new Error('--ids、--sample、--from-ratings のどれかを指定してください');
}

const out = { name, description: opt('--description') || '', puzzlesFile, ...set, createdAt: new Date().toISOString() };
const file = path.join(__dirname, 'sets', name + '.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`問題セットを書き出した → ${file}`);

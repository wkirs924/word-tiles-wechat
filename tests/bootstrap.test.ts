import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sentenceScore, finalScore, ranking} from '../packages/core/src/scoring.ts';
import {expandDeck, seededSetup} from '../packages/core/src/setup.ts';
import {rankMemes} from '../packages/content/src/search.ts';

test('word count scoring boundaries retain original bonuses', () => {
  assert.deepEqual([2,3,4,5,6,14].map(x => sentenceScore(x).total), [2,3,5,6,9,17]);
  assert.throws(() => sentenceScore(1));
  assert.throws(() => sentenceScore(2.5));
});
test('average bonuses remain exact thirds and remaining tiles can make score negative', () => {
  assert.deepEqual(finalScore(7, 8, 2), {numerator: 23, denominator: 3});
  assert.deepEqual(finalScore(0, 0, 13), {numerator: -39, denominator: 3});
  assert.throws(() => finalScore(1, NaN, 0));
});
test('ranking uses exact numerators and competition ranks', () => {
  const result = ranking(['a','b','c','d'], {a: 10, b: 8, c: 8, d: 7});
  assert.deepEqual(result.map(x => x.rank), [1,2,2,4]);
  assert.deepEqual(ranking(['a','b'], {a: 1, b: 2}).map(x => x.player_id), ['b','a']);
});
test('both existing presets expand to 136 independent physical IDs', () => {
  const catalog = JSON.parse(readFileSync(new URL('../reference/godot/content/catalog.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(catalog.deck_presets.length >= 2);
  for (const preset of catalog.deck_presets) {
    const tiles = expandDeck(preset.deck);
    assert.equal(tiles.length, 136);
    assert.equal(new Set(tiles.map(x => x.id)).size, 136);
  }
});
test('supplementary Unicode character is a single glyph', () => {
  assert.equal(expandDeck([{glyph: '𠀀', copies: 136}])[0].glyph, '𠀀');
  assert.throws(() => expandDeck([{glyph: '开心', copies: 136}]));
});
test('seeded setup is deterministic, preserves all IDs and does not mutate input', () => {
  const tiles = expandDeck([{glyph: '字', copies: 136}]);
  const before = JSON.stringify(tiles);
  const first = seededSetup(tiles, 42);
  assert.deepEqual(first, seededSetup(tiles, 42));
  assert.notDeepEqual(first.wall, seededSetup(tiles, 43).wall);
  assert.deepEqual([...first.wall].sort(), tiles.map(x => x.id).sort());
  assert.equal(JSON.stringify(tiles), before);
  assert.ok(first.dice.every(x => x >= 1 && x <= 6));
  assert.ok(first.dealer_seat >= 0 && first.dealer_seat <= 3);
  assert.throws(() => seededSetup(tiles, 0));
});
test('search filters first and counts only distinct selected glyphs', () => {
  const assets = [
    {key:'a',kind:'meme',title:'笑',keywords:['开心']},
    {key:'b',kind:'meme',title:'开场',keywords:['开场']},
    {key:'c',kind:'meme',title:'笑',keywords:['开心']},
    {key:'ui',kind:'ui',title:'开心',keywords:['开心']},
  ];
  const before = JSON.stringify(assets);
  const result = rankMemes(assets, '', ['开','心','开']);
  assert.deepEqual(result.map(x=>x.key), ['a','c','b']);
  assert.deepEqual(result.map(x=>x.match_count), [2,2,1]);
  assert.deepEqual(rankMemes(assets,' 开场 ',['心']).map(x=>x.key), ['b']);
  result[0].keywords.push('changed');
  assert.equal(JSON.stringify(assets), before);
});

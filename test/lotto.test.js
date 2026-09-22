// node test/lotto.test.js  (네트워크 불필요)
const assert = require('assert');
const L = require('../www/lotto.js');

// 회차/추첨시각: 1242회 = 2026-09-19(토) 20:35 KST
assert.strictEqual(new Date(L.drawTime(1242)).toISOString(), '2026-09-19T11:35:00.000Z');
assert.strictEqual(L.latestDrawNo(Date.parse('2026-09-21T00:00:00Z')), 1242);
assert.strictEqual(L.latestDrawNo(Date.parse('2026-09-26T11:40:00Z')), 1242); // 추첨 직후엔 아직 이전 회차
assert.strictEqual(L.latestDrawNo(Date.parse('2026-09-26T12:10:00Z')), 1243); // 21:10 KST

// QR 파싱
const q = L.parseQr('http://m.dhlottery.co.kr/?v=1242q020410163141n030711223344m0102030405464455667788');
assert.strictEqual(q.drawNo, 1242);
assert.deepStrictEqual(q.games, [[2, 4, 10, 16, 31, 41], [3, 7, 11, 22, 33, 44]]); // 46 포함 게임은 버림
assert.strictEqual(L.parseQr('https://example.com'), null);
assert.strictEqual(L.parseQr(null), null);

// 등수
const w = [2, 4, 10, 16, 31, 41], b = 9;
assert.strictEqual(L.rankOf([2, 4, 10, 16, 31, 41], w, b), 1);
assert.strictEqual(L.rankOf([2, 4, 10, 16, 31, 9], w, b), 2);
assert.strictEqual(L.rankOf([2, 4, 10, 16, 31, 45], w, b), 3);
assert.strictEqual(L.rankOf([2, 4, 10, 16, 30, 45], w, b), 4);
assert.strictEqual(L.rankOf([2, 4, 10, 15, 30, 45], w, b), 5);
assert.strictEqual(L.rankOf([2, 4, 11, 15, 30, 45], w, b), 0);

// 당첨금: 4·5등 고정, 그 외는 조회 데이터
assert.strictEqual(L.prizeOf(5, null), 5000);
assert.strictEqual(L.prizeOf(1, { prizes: { 1: 123 } }), 123);
console.log('lotto tests passed');

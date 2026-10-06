import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketMapExtras as analyse, renderMarketMapExtras } from './market-map-extras.js';

const start = Date.parse('2026-10-05T03:45:00Z') / 1000;
const candle = (time, close = 100) => ({ time, high: close + 2, low: close - 2, close });
const fixture = () => [...Array.from({ length: 75 }, (_, i) => candle(start + i * 300)),
  candle(start + 86400), candle(start + 86700)];

test('flat-market ATR, CCI and classic daily pivots are finite and correct', () => {
  const result = analyse(fixture(), 300);
  assert.deepEqual(result.atr, { points: 4, percent: 4, distance: 6 });
  assert.equal(result.cci.value, 0);
  assert.deepEqual(result.pivots, { date: '2026-10-05', p: 100, s1: 98, r1: 102, s2: 96, r2: 104 });
});
test('forming candle cannot change readouts, and partial sessions cannot create pivots', () => {
  const input = fixture();
  const expected = analyse(input, 300);
  input[input.length - 1] = candle(start + 86700, 10000);
  assert.deepEqual(analyse(input, 300), expected);
  for (const partial of [input.slice(1), input.filter((_, i) => i !== 30), input.filter((_, i) => i !== 74)])
    assert.equal(analyse(partial, 300).pivots, null);
});
test('CCI uses mean absolute deviation of typical price', () => {
  const input = Array.from({ length: 21 }, (_, i) => candle(start + i * 300, 100 + i));
  assert.ok(Math.abs(analyse(input, 300).cci.value - 126.6666666667) < 0.000001);
});
test('missing OHLC, warm-up and timestamp conflicts render WAIT', () => {
  const input = fixture(); input[input.length - 2].high = null;
  assert.equal(analyse(input, 300).atr, null);
  assert.equal(analyse(input, 300).cci, null);
  assert.equal(analyse(input.slice(-10), 300).cci, null);
  const nodes = new Map();
  renderMarketMapExtras(fixture(), 300, start, { getElementById(id) {
    const node = { textContent: '' }; nodes.set(id, node); return node;
  } });
  assert.match(nodes.get('market-map-cci').textContent, /^WAIT/);
  assert.equal(nodes.get('market-map-pivot-support').textContent, '—');
});

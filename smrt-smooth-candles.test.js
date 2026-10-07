import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothCandles} from './smrt-smooth-candles.js';
const bars = [
  {time: 1, open: 100, high: 110, low: 90, close: 105},
  {time: 2, open: 105, high: 125, low: 100, close: 120},
  {time: 3, open: 120, high: 122, low: 80, close: 85}
];
test('EMA calculation and trend colours are deterministic', () => {
  const r = smoothCandles(bars, 3);
  assert.equal(r[1].close, 112.5);
  assert.equal(r[2].close, 98.75);
  assert.equal(r[1].color, '#72e4bd');
  assert.equal(r[2].color, '#f17c86');
});
test('future bars cannot change earlier candles; source prices stay intact', () => {
  const original = structuredClone(bars);
  assert.deepEqual(smoothCandles(bars.slice(0, 2), 8), smoothCandles(bars, 8).slice(0, 2));
  assert.deepEqual(bars, original);
  for (const b of smoothCandles(bars)) {
    assert.ok(b.high >= Math.max(b.open, b.close));
    assert.ok(b.low <= Math.min(b.open, b.close));
  }
});
test('missing data, invalid candles and unordered timestamps yield no display', () => {
  assert.deepEqual(smoothCandles([{...bars[0], close: null}]), []);
  assert.deepEqual(smoothCandles([{...bars[0], high: 99}]), []);
  assert.deepEqual(smoothCandles([bars[1], bars[0]]), []);
  assert.deepEqual(smoothCandles(bars, 0), []);
  assert.deepEqual(smoothCandles([]), []);
});
test('period one preserves market prices and string numbers normalize', () => {
  const result = smoothCandles(bars, 1);
  for (let i = 0; i < bars.length; i++) for (const k of ['time','open','high','low','close']) assert.equal(result[i][k], bars[i][k]);
  assert.equal(smoothCandles([{time:'1',open:'100',high:'110',low:'90',close:'105'}])[0].close,105);
});


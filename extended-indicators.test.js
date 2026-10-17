import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendedIndicators, sessionPivots, completeSessionWindow } from './extended-indicators.js';
import { analyseAdvancedIndicators } from './smrt-advanced-indicators.js';

const rows = n => Array.from({ length: n }, (_, i) => ({
  time: 1000 + i * 60, open: 100, high: 102, low: 98, close: 100, volume: 10
}));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('Keltner never turns missing warm-up into zero bands; flat CCI is zero', () => {
  for (const n of [0, 1, 9, 10, 19]) assert.equal(extendedIndicators(rows(n)).keltner, null);
  assert.deepEqual(extendedIndicators(rows(20)).keltner, { mid: 100, upper: 108, lower: 92 });
  assert.equal(extendedIndicators(rows(20)).cci, 0);
});

test('Keltner uses Wilder ATR rather than a rolling SMA after a range spike', () => {
  const input = rows(21);
  input[10].high = 112; input[10].low = 88;
  // Seed ATR = 4; spike gives 6, followed by ten decay steps.
  near(extendedIndicators(input).keltner.upper, 100 + 2 * (4 + 2 * 0.9 ** 10));
});

test('Aroon(25) spans 25 elapsed periods and selects the newest tied extreme', () => {
  assert.equal(extendedIndicators(rows(25)).aroonUp, null);
  const input = rows(26);
  input[0].high = 110; input[0].low = 90;
  assert.equal(extendedIndicators(input).aroonUp, 0);
  input[1].high = 111;
  assert.equal(extendedIndicators(input).aroonUp, 4);
  input[25].high = 111; input[25].low = 90;
  assert.equal(extendedIndicators(input).aroonUp, 100);
  assert.equal(extendedIndicators(input).aroonDown, 100);
});

test('volume readouts require explicit trust; CMF includes flat-candle volume', () => {
  const input = rows(20);
  input[0].close = 102;
  input[1] = { ...input[1], high: 100, low: 100 };
  for (const key of ['mfi', 'cmf', 'obv']) assert.equal(extendedIndicators(input)[key], null);
  near(extendedIndicators(input, { trustedVolume: true }).cmf, 0.05);
  input[2].volume = null;
  assert.equal(extendedIndicators(input, { trustedVolume: true }).cmf, null);
  assert.equal(extendedIndicators(input, { trustedVolume: true }).obv, null);
});

test('OBV validates its entire history, not just the most recent twenty volumes', () => {
  const input = rows(30);
  input[1].close = 101;
  input[2].close = 102;
  assert.equal(extendedIndicators(input, { trustedVolume: true }).obv, 10);
  input[1].volume = undefined;
  assert.equal(extendedIndicators(input, { trustedVolume: true }).obv, null);
});

test('malformed OHLC never bridges a gap or manufactures advanced votes', () => {
  for (const bad of [null, undefined, '', NaN]) {
    const input = rows(220); input[100].close = bad;
    assert.equal(extendedIndicators(input).keltner, null);
    const advanced = analyseAdvancedIndicators(input);
    assert.equal(advanced.ready, false);
    assert.equal(advanced.rsi.side, 0);
  }
});

test('floor pivots and sorted CPR match a known previous-session OHLC', () => {
  const input = [{ high: 120, low: 90, close: 105 }];
  assert.deepEqual(sessionPivots(input), { pivot: 105, bc: 105, tc: 105,
    r1: 120, s1: 90, r2: 135, s2: 75, r3: 150, s3: 60 });
  assert.equal(sessionPivots([]), null);
});

test('opening range requires all completed bars and rejects larger timeframes', () => {
  const input = rows(5).map((candle, i) => ({ minutes: 555 + i * 3,
    candle: { ...candle, time: 1000 + i * 180 } }));
  assert.equal(completeSessionWindow(input, 555, 570, 180), true);
  assert.equal(completeSessionWindow(input.slice(1), 555, 570, 180), false);
  assert.equal(completeSessionWindow(input.slice(0, 4), 555, 570, 180), false);
  assert.equal(completeSessionWindow([input[0]], 555, 570, 3600), false);
  input[2].candle.time += 60;
  assert.equal(completeSessionWindow(input, 555, 570, 180), false);
});

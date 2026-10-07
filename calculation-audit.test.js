import test from 'node:test';
import assert from 'node:assert/strict';
import { indicators } from './market.js';
import { candleStatus } from './candle-status.js';

const candles = values => values.map((close, i) => ({ time: 1791344700 + i * 60,
  open: close, high: close, low: close, close, volume: 0 }));

test('MACD seed excludes unavailable EMA values and signal waits for nine real MACD observations', () => {
  const result = indicators(candles(Array.from({ length: 50 }, (_, i) => i + 1)));
  assert.ok(result.macd.slice(0, 25).every(v => v === null));
  assert.equal(result.macd[25], 7);
  assert.ok(result.signal.slice(0, 33).every(v => v === null));
  assert.equal(result.signal[33], 7);
  assert.equal(result.hist[33], 0);
});

test('flat and rising series have expected RSI, averages and no fabricated index VWAP', () => {
  const flat = indicators(candles(Array(220).fill(100)));
  for (const key of ['e9','e21','e50','e200','s50','s200']) assert.ok(Math.abs(flat[key].at(-1) - 100) < 1e-10);
  assert.equal(flat.rsi.at(-1), 50);
  assert.equal(flat.macd.at(-1), 0);
  assert.equal(flat.hist.at(-1), 0);
  assert.ok(flat.vwap.every(v => v === null));
  assert.equal(indicators(candles(Array.from({length:220},(_,i)=>100+i))).rsi.at(-1),100);
});

test('freshness distinguishes missing, forming, current and stale candles at exact boundaries', () => {
  const now = 1791351000000, time = now / 1000;
  assert.equal(candleStatus(null, 180, now).current, false);
  assert.equal(candleStatus(time-179, 180, now).reason, 'Candle not closed yet');
  assert.equal(candleStatus(time-180, 180, now).current, true);
  assert.equal(candleStatus(time-390, 180, now).current, true);
  assert.equal(candleStatus(time-391, 180, now).reason, 'Closed candle stale');
});


test('advanced indicator families fail closed on missing/invalid OHLC and volume', async () => {
  const { analyseAdvancedIndicators } = await import('./smrt-advanced-indicators.js');
  for (const input of [[], [{open:null,high:2,low:1,close:1.5}], [{open:2,high:1,low:1,close:2}]]) {
    const result = analyseAdvancedIndicators(input);
    assert.equal(result.ready, false);
    for (const row of Object.values(result).filter(v => v && typeof v === 'object')) assert.equal(row.side, 0);
  }
  const result = analyseAdvancedIndicators(candles(Array.from({length:260},(_,i)=>100+i)));
  for (const key of ['pvo','chaikin','mfi','cmf','obv']) {
    assert.equal(result[key].side, 0, key);
    assert.equal(result[key].value, null, key);
  }
  for (const [key,row] of Object.entries(result)) {
    if (!row || typeof row !== 'object') continue;
    assert.ok([-1,0,1].includes(row.side),key);
    if (typeof row.value === 'number') assert.ok(Number.isFinite(row.value),key);
  }
});

test('Wilder trend engine has complete seeds and known rising-series DMI/ADX', async () => {
  const { trendIndicators } = await import('./trend-indicators.js');
  const result = trendIndicators(candles(Array.from({length:80},(_,i)=>100+i)));
  assert.ok(result.atr.slice(0,10).every(v=>v===null));
  assert.equal(result.atr[10],1);
  assert.equal(result.plusDI[14],100);
  assert.equal(result.minusDI[14],0);
  assert.ok(result.adx.slice(0,27).every(v=>v===null));
  assert.equal(result.adx[27],100);
});


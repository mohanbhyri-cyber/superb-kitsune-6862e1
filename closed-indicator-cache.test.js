import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createClosedIndicatorCache } from './closed-indicator-cache.js';
import { analyseAdvancedIndicators } from './smrt-advanced-indicators.js';

const candle = (time, close = 22000) => ({ time, open: close - 1,
  high: close + 3, low: close - 3, close, volume: 100 });

test('100 unchanged quote/redraw checks calculate completed indicators once', () => {
  let calls = 0;
  const cache = createClosedIndicatorCache(rows => { calls++; return { count: rows.length }; });
  const rows = [candle(100), candle(280)];
  const initial = cache.read(rows, 'NIFTY:3m:live');
  for (let i = 0; i < 100; i++) {
    const repeated = cache.read(rows.map(row => ({ ...row })), 'NIFTY:3m:live');
    assert.equal(repeated.value, initial.value);
    assert.equal(repeated.changed, false);
  }
  assert.equal(calls, 1);
});

test('all OHLCV/time corrections, including earlier in-place revisions, invalidate', () => {
  for (const field of ['time', 'open', 'high', 'low', 'close', 'volume']) {
    let calls = 0;
    const cache = createClosedIndicatorCache(() => ++calls);
    const rows = [candle(100), candle(280)];
    cache.read(rows);
    rows[0][field] += 1;
    assert.equal(cache.read(rows).changed, true);
    assert.equal(calls, 2);
  }
});

test('new candles, symbol/timeframe/replay changes and reset recalculate', () => {
  let calls = 0;
  const cache = createClosedIndicatorCache(() => ++calls);
  const rows = [candle(100)];
  cache.read(rows, 'NIFTY:3m:live');
  rows.push(candle(280));
  cache.read(rows, 'NIFTY:3m:live');
  for (const key of ['OTHER:3m:live', 'NIFTY:5m:live', 'NIFTY:3m:replay']) {
    assert.equal(cache.read(rows, key).changed, true);
  }
  cache.reset();
  assert.equal(cache.read(rows, 'NIFTY:3m:replay').changed, true);
  assert.equal(calls, 6);
});

test('missing inputs and exceptions never reuse an earlier successful calculation', () => {
  let fail = false, calls = 0;
  const cache = createClosedIndicatorCache(rows => {
    calls++;
    if (fail) throw new Error('calculation failed');
    return { ready: rows.length > 0 };
  });
  assert.equal(cache.read([candle(100)]).value.ready, true);
  assert.equal(cache.read(null).value.ready, false);
  fail = true;
  assert.throws(() => cache.read([candle(280)]), /calculation failed/);
  assert.throws(() => cache.read([candle(280)]), /calculation failed/);
  fail = false;
  assert.equal(cache.read([candle(280)]).changed, true);
  assert.equal(calls, 5);
});

test('cached real engine outputs match uncached outputs before and after correction', () => {
  const rows = Array.from({ length: 240 }, (_, i) =>
    candle(100 + i * 180, 22000 + i * .3 + Math.sin(i / 5) * 9));
  const expected = analyseAdvancedIndicators(rows);
  const cache = createClosedIndicatorCache(analyseAdvancedIndicators);
  assert.deepEqual(cache.read(rows).value, expected);
  assert.deepEqual(cache.read(rows).value, expected);
  rows[30].close += .5;
  assert.deepEqual(cache.read(rows).value, analyseAdvancedIndicators(rows));
});

function confirmationFixture() {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const stats = { advanced: 0, readout: 0, consensus: 0, prime: 0, gates: 0 };
  let now = 470;
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false },
    data: [candle(100), candle(280)], rawTradeFinalizer: { side: 1 } };
  const context = vm.createContext({ state, intervals: { '3m': 180 },
    Date: { now: () => now * 1000 }, window: {},
    advancedIndicatorCache: createClosedIndicatorCache(rows => {
      stats.advanced++; return { ready: rows.length > 0 };
    }),
    primeClosed: (rows, seconds, time) => ({ candles: rows.filter(row => row.time + seconds <= time) }),
    renderIndicatorReadout() { stats.readout++; },
    analyseAllIndicators() { stats.consensus++; return { side: 1 }; },
    analysePrimeMarket(input) { stats.prime++; return { side: input.now < 500 ? 1 : 0 }; },
    primeGate(result, prime) { stats.gates++; return { ...result, side: prime.side }; },
    renderPrimeMarket() {}, renderAiIndicator() {}, renderSmartMoneyTools() {}, renderBestBuySetup() {},
    console: { log() {}, warn() {} }
  });
  const start = app.indexOf('    function refreshPrimeConfirmation()');
  const end = app.indexOf('    function renderSmartMoneyTools()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end) + '\nthis.refresh = refreshPrimeConfirmation;', context);
  return { state, stats, refresh: context.refresh, clock: value => { now = value; } };
}

test('forming quotes reuse calculations while consensus, freshness and trade gates rerun', () => {
  const f = confirmationFixture();
  f.state.data.push(candle(460));
  f.refresh();
  f.state.data.at(-1).close += 2;
  f.refresh();
  assert.equal(f.stats.advanced, 1);
  assert.equal(f.stats.readout, 1);
  assert.equal(f.stats.consensus, 2);
  assert.equal(f.stats.prime, 2);
  assert.equal(f.stats.gates, 4);
  f.clock(500); // Time-dependent vetoes cannot be cached with indicator values.
  f.refresh();
  assert.equal(f.stats.advanced, 1);
  assert.equal(f.state.tradeFinalizer.side, 0);
  assert.equal(f.stats.prime, 3);
});

test('newly completed candles and historical provider corrections recalculate immediately', () => {
  const f = confirmationFixture();
  f.state.data.push(candle(460));
  f.refresh();
  f.clock(640);
  f.refresh();
  assert.equal(f.stats.advanced, 2);
  f.state.data[0].high += 2;
  f.refresh();
  assert.equal(f.stats.advanced, 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { completedFuturesCandles, buildClosedFuturesVwap, resolveClosedVwap } from './closed-vwap-confirmation.js';

const epoch = clock => Date.parse('2026-10-09T' + clock + '+05:30') / 1000;
const seconds = 180;
const contract = { instrument_key: 'NSE_FO|fixture', trading_symbol: 'NIFTY-FIXTURE' };
const bar = (time, close = 115, volume = 100) => ({ time, open: 110,
  high: Math.max(120, close), low: 100, close, volume });
const bars = (count = 22) => Array.from({ length: count }, (_, i) => bar(epoch('09:15:00') + i * seconds));
const now = epoch('10:18:05');
const last = bar(epoch('10:15:00'), 90, 0); // Index below futures VWAP: must not be compared across instruments.
const confirmation = () => buildClosedFuturesVwap(bars(), seconds, now, contract);
const input = () => ({ indexVwap: null, last, side: 1, symbol: 'NIFTY', seconds, now, futures: confirmation() });

test('closed futures VWAP and volume exclude the forming candle without modifying display bars', () => {
  const data = bars();
  data.at(-1).close = 999; data.at(-1).high = 1000; data.at(-1).volume = 1000000;
  const before = structuredClone(data);
  const result = buildClosedFuturesVwap(data, seconds, now, contract);
  assert.equal(result.available, true);
  assert.equal(result.closed, true);
  assert.equal(result.lastCandleTime, last.time);
  assert.equal(result.futuresPrice, 115);
  assert.equal(result.cumulativeVolume, 2100);
  assert.ok(Math.abs(result.vwap - (120 + 100 + 115) / 3) < 1e-10);
  assert.equal(completedFuturesCandles(data, seconds, now).length, 21);
  assert.deepEqual(data, before);
});

test('aligned futures confirmation compares futures close to futures VWAP, not index price', () => {
  const result = resolveClosedVwap(input());
  assert.equal(result.ok, true);
  assert.match(result.source, /not index VWAP/);
  assert.equal(resolveClosedVwap({ ...input(), side: -1 }).ok, false);
  const bearish = { ...confirmation(), futuresPrice: 105 };
  assert.equal(resolveClosedVwap({ ...input(), side: -1, futures: bearish }).ok, true);
  assert.equal(resolveClosedVwap({ ...input(), side: 0 }).ok, false);
  assert.equal(resolveClosedVwap({ ...input(), futures: { ...confirmation(), futuresPrice: confirmation().vwap } }).ok, false);
});

test('chart VWAP retains precedence and cannot be rescued by conflicting futures', () => {
  assert.equal(resolveClosedVwap({ ...input(), indexVwap: 80 }).ok, true);
  const result = resolveClosedVwap({ ...input(), indexVwap: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'Chart closed-candle VWAP');
});

test('missing, malformed, stale, mismatched, after-hours and Replay futures fail closed', () => {
  for (const change of [
    { futures: null }, { replay: true }, { symbol: 'BANKNIFTY' },
    { seconds: 3600 }, { now: epoch('10:17:59') }, { now: epoch('10:21:01') },
    { now: epoch('16:00:00') }, { now: now + 86400 },
    ...[
      { available: false }, { closed: false }, { source: 'SAMPLE' }, { underlying: 'BANKNIFTY' },
      { instrumentKey: '' }, { seconds: 60 }, { lastCandleTime: last.time - seconds },
      { lastCandleTime: last.time + seconds }, { vwap: null }, { futuresPrice: 0 },
      { cumulativeVolume: 0 }, { vwap: true }, { lastCandleTime: null }
    ].map(change => ({ futures: { ...confirmation(), ...change } }))
  ]) {
    const result = resolveClosedVwap({ ...input(), ...change });
    assert.equal(result.available, false, JSON.stringify(change));
    assert.equal(result.ok, false);
  }
});

test('session builder rejects zero volume, missing session start, gaps, duplicates and invalid bars', () => {
  for (const data of [
    [], bars().map(c => ({ ...c, volume: 0 })), bars().slice(1),
    bars().filter((_, i) => i !== 5), [...bars(), bars()[5]],
    bars().map((c, i) => i === 5 ? { ...c, close: 1000 } : c),
    bars().map((c, i) => i === 5 ? { ...c, volume: -1 } : c)
  ]) assert.equal(buildClosedFuturesVwap(data, seconds, now, contract).available, false);
  assert.equal(buildClosedFuturesVwap(bars(), seconds, now, {}).available, false);
  assert.equal(buildClosedFuturesVwap(bars(), seconds, epoch('09:17:59'), contract).available, false);
  const data = [...bars(), bar(epoch('09:12:00')), bar(epoch('15:30:00')), bar(last.time - 86400)];
  assert.deepEqual(buildClosedFuturesVwap(data, seconds, now, contract), confirmation());
});

test('actual Prime block keeps VWAP mandatory and identifies the genuine futures source', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const start = app.indexOf('      result.vwap = resolveClosedVwap(');
  const end = app.indexOf("      for (const [tf, duration]", start);
  assert.ok(start >= 0 && end > start);
  const run = futuresVwap => {
    const result = { checks: [], reasons: [] };
    vm.runInNewContext(app.slice(start, end), {
      result, resolveClosedVwap, technical: { values: { vwap: null } }, last,
      side: 1, state: { symbol: 'NIFTY' }, seconds, now, futuresVwap, replay: false,
      check: (name, ok, reason, required = true) => {
        result.checks.push({ name, ok, required }); if (!ok) result.reasons.push(reason);
      }
    });
    return result;
  };
  assert.equal(run(confirmation()).checks[0].ok, true);
  assert.equal(run(null).checks[0].required, true);
  assert.equal(run(null).checks[0].ok, false);
  assert.match(run(confirmation()).checks[0].source, /not index VWAP/);
});

test('actual Worker uses the same request for separate closed VWAP and closed volume confirmation', async () => {
  const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function futuresVWAP(');
  const end = source.indexOf('\nasync function ', start + 1);
  assert.ok(start >= 0 && end > start);
  let requests = 0;
  const data = bars(); data.at(-1).volume = 1000000;
  const context = { Date: { now: () => now * 1000 }, Number, console,
    findNearestNiftyFutureViaSearch: async () => contract,
    upstoxFetch: async () => { requests++; return { data: { candles: data.map(c =>
      [c.time, c.open, c.high, c.low, c.close, c.volume]) } }; },
    normalizeCandle: row => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }),
    calculateVWAP: () => ({ value: 999, volume: 1002100 }),
    buildClosedFuturesVwap, completedFuturesCandles,
    todayIST: () => '2026-10-09', IST: 'Asia/Kolkata', json: body => body };
  vm.runInNewContext(source.slice(start, end) + '\nthis.run = futuresVWAP;', context);
  const result = await context.run(new URL('https://fixture.invalid/api/nifty-futures-vwap?interval=3'), 'fixture-token');
  assert.equal(requests, 1);
  assert.equal(result.vwap, 999); // Existing live display remains separate.
  assert.deepEqual(result.closedVwapConfirmation, confirmation());
  assert.equal(result.volumeConfirmation.lastCandleTime, last.time);
  assert.equal(result.volumeConfirmation.relative, 1);
});

test('actual futures refresh clears failed/new-context confirmation and never injects Replay data', async () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const start = app.indexOf('    async function refreshFuturesVWAP()');
  const end = app.indexOf('    function setFeedStatus(', start);
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false } };
  let body = { live: true, vwap: 999, lastCandleTime: last.time + seconds,
    closedVwapConfirmation: confirmation() };
  let fail = false;
  const context = { state, Date, Number, console: { warn() {} }, API_BASE: '',
    primeEpochSeconds: Number, isUpstoxRateLimit: () => false,
    upstoxAwareFetch: async () => {
      if (fail) throw new Error('Unavailable');
      return { ok: true, json: async () => body };
    } };
  vm.runInNewContext(app.slice(start, end) + '\nthis.run = refreshFuturesVWAP;', context);
  await context.run();
  assert.deepEqual(state.futuresClosedVwapConfirmation, confirmation());
  body = { live: false }; await context.run();
  assert.equal(state.futuresClosedVwapConfirmation, null);
  state.futuresClosedVwapConfirmation = confirmation(); fail = true; await context.run();
  assert.equal(state.futuresClosedVwapConfirmation, null);
  fail = false; state.symbol = 'BANKNIFTY'; state.futuresClosedVwapConfirmation = confirmation(); await context.run();
  assert.equal(state.futuresClosedVwapConfirmation, null);
  state.symbol = 'NIFTY'; state.tf = '1h'; state.futuresClosedVwapConfirmation = confirmation(); await context.run();
  assert.equal(state.futuresClosedVwapConfirmation, null);
  assert.match(app, /futuresVwap:\s*state\.replay\.active\s*\? null\s*: state\.futuresClosedVwapConfirmation/);
});

test('late futures responses cannot overwrite a changed symbol, timeframe or Replay context', async () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const start = app.indexOf('    async function refreshFuturesVWAP()');
  const end = app.indexOf('    function setFeedStatus(', start);
  for (const [field, value] of [['symbol', 'BANKNIFTY'], ['tf', '5m'], ['replay', { active: true }]]) {
    for (const fail of [false, true]) {
      const sentinel = { available: false, reason: 'New chart context' };
      const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false },
        futuresClosedVwapConfirmation: sentinel };
      let finish;
      const response = new Promise(resolve => { finish = resolve; });
      const context = { state, Date, Number, console: { warn() {} }, API_BASE: '',
        primeEpochSeconds: Number, isUpstoxRateLimit: () => false,
        upstoxAwareFetch: async () => {
          await response;
          if (fail) throw new Error('Old request failed');
          return { ok: true, json: async () => ({ live: true, vwap: 999,
            closedVwapConfirmation: confirmation() }) };
        } };
      vm.runInNewContext(app.slice(start, end) + '\nthis.run = refreshFuturesVWAP;', context);
      const pending = context.run();
      state[field] = value; finish(); await pending;
      assert.equal(state.futuresClosedVwapConfirmation, sentinel);
    }
  }
});

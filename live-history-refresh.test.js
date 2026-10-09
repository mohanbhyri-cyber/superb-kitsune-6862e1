import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validCandle } from './market.js';
import { isNseIntradayTime, nseCandleBucket, liveCandleBucket, liveCandleRejectionReason } from './nse-candle-time.js';
import { regularNseHours } from './options-context.js';
import { analyseSmrtAiIndicator as analyse } from './smrt-ai-indicator.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const helperStart = app.indexOf('    function crossedMtfFrames(');
const helperEnd = app.indexOf('    async function loadData()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const tickStart = app.indexOf('            tick => {', app.indexOf('        unsubscribe ='));
const tickEnd = app.indexOf('            error => {', tickStart);
const tickSource = app.slice(tickStart, tickEnd).trim().replace(/,$/, '');
const epoch = clock => Date.parse('2026-10-09T' + clock + '+05:30') / 1000;
const candle = (clock, close = 22000) => ({ time: epoch(clock),
  open: 22000, high: Math.max(22010, close), low: Math.min(21990, close), close, volume: 0 });
const json = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {
  resolve = a; reject = b;
}); return { promise, resolve, reject }; };

function fixture(fetchHistory) {
  let clock = epoch('12:04:00');
  let cooldownUntil = 0;
  const stats = { histories: [], frames: [], futures: 0, unsubscribes: 0,
    fullLoads: 0, draws: 0, warnings: [], status: [] };
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false },
    data: [candle('11:57:00'), candle('12:00:00'), candle('12:03:00')],
    quotes: {}, officialChange: {}, previousClose: {} };
  const context = vm.createContext({
    state, request: 7, loadedHistoryKey: 'NIFTY:3m', fullHistoryRequest: null,
    historyRefreshInFlight: false, liveQuoteVersion: 0, historyRefreshWarning: '',
    reconnectTimer: null,
    intervals: { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600 },
    document: { hidden: false }, Date: { now: () => clock * 1000 },
    validCandle, isNseIntradayTime, nseCandleBucket,
    liveCandleBucket: (tick, seconds) => liveCandleBucket(tick, seconds, clock),
    liveCandleRejectionReason: (tick, seconds) => liveCandleRejectionReason(tick, seconds, clock),
    isNseCashMarketOpen: () => regularNseHours(clock * 1000),
    upstoxCooldownRemaining: scope => {
      assert.equal(scope, 'history'); return Math.max(0, cooldownUntil - clock * 1000);
    },
    isUpstoxRateLimit: error => error.status === 429,
    market: {
      history: async (symbol, tf) => {
        stats.histories.push({ symbol, tf });
        return fetchHistory ? fetchHistory() : state.data.map(c => ({ ...c }));
      },
      previousHistory: () => { throw new Error('Duplicate previous-history call'); },
      mtfHistory: () => { throw new Error('Unconditional MTF reload'); }
    },
    refreshMTF: async frames => { stats.frames.push(json(frames)); },
    refreshFuturesVWAP: async () => { stats.futures++; },
    unsubscribe: () => { stats.unsubscribes++; },
    loadData: async () => { stats.fullLoads++; },
    lastAnalysisKey: 'previous-analysis',
    refreshLiveTradeFinalizer() {}, recomputeAiNifty() {}, updateTradingDate() {},
    draw: () => { stats.draws++; }, summary() {}, scheduleLiveRender() {},
    processSignalAlerts() {}, processScalpAlerts() {}, processMomentumAlerts() {}, checkAlerts() {},
    setFeedStatus: (status, detail) => { stats.status.push({ status, detail }); },
    console: { warn: (...args) => { stats.warnings.push(args[0]); } }
  });
  vm.runInContext(app.slice(helperStart, helperEnd) +
    '\nthis.refresh = refreshCandleHistory; this.framesCrossed = crossedMtfFrames;', context);
  const tick = vm.runInContext('(' + tickSource + ')', context);
  return { context, state, stats, refresh: context.refresh, tick,
    framesCrossed: context.framesCrossed,
    now: () => clock, clock: value => { clock = epoch(value); },
    cooldown: ms => { cooldownUntil = clock * 1000 + ms; },
    timer: () => {
      let callback;
      context.setInterval = (fn, ms) => { assert.equal(ms, 30000); callback = fn; return 1; };
      const start = app.indexOf('    historyRefreshTimer = setInterval(');
      const end = app.indexOf('\n    setupAllIndicatorsChat();', start);
      vm.runInContext(app.slice(start, end), context);
      return callback;
    }
  };
}

test('periodic refresh reconciles closed bars without resetting quotes, chart, or supporting histories', async () => {
  const f = fixture(() => [candle('11:57:00', 21995), candle('12:00:00', 22005),
    candle('12:03:00', 22008)]);
  f.state.quotes.NIFTY = 22025;
  f.state.offset = 31;
  const quoteObject = f.state.quotes;
  await f.refresh();
  assert.equal(f.stats.histories.length, 1);
  assert.equal(f.state.data[0].close, 21995);
  assert.equal(f.state.data[1].close, 22005);
  assert.equal(f.state.data[2].close, 22008);
  assert.equal(f.state.quotes, quoteObject);
  assert.equal(f.state.quotes.NIFTY, 22025);
  assert.equal(f.state.offset, 31);
  assert.equal(f.stats.unsubscribes, 0);
  assert.equal(f.stats.fullLoads, 0);
  assert.deepEqual(f.stats.frames, []);
  assert.equal(f.stats.futures, 0);
  assert.equal(f.context.historyRefreshInFlight, false);
  assert.equal(f.stats.draws, 1);
});

test('real subscription ticks received during a history request keep the forming close and extremes', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const refresh = f.refresh();
  f.clock('12:04:03');
  f.tick({ time: f.now(), price: 22035, volume: 8 });
  pending.resolve([candle('11:57:00', 21995), candle('12:00:00', 22005),
    { ...candle('12:03:00', 22008), high: 22038, low: 21988, volume: 5 }]);
  await refresh;
  const forming = f.state.data.at(-1);
  assert.equal(forming.close, 22035);
  assert.equal(forming.high, 22038);
  assert.equal(forming.low, 21988);
  assert.equal(forming.volume, 8);
  assert.equal(f.state.data.at(-2).close, 22005, 'Already closed server bar is authoritative');
  assert.equal(f.state.quotes.NIFTY, 22035);
  assert.equal(f.stats.unsubscribes, 0);
});

test('a genuine new 3m tick crossing a candle boundary in flight is not dropped or overwritten', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const refresh = f.refresh();
  f.clock('12:05:58');
  f.tick({ time: f.now(), price: 22035 });
  f.clock('12:06:02');
  f.tick({ time: f.now(), price: 22040 });
  pending.resolve([candle('11:57:00'), candle('12:00:00'),
    candle('12:03:00', 22008), candle('12:06:00', 22009)]);
  await refresh;
  assert.equal(f.state.data.at(-2).close, 22035);
  assert.equal(f.state.data.at(-1).time, epoch('12:06:00'));
  assert.equal(f.state.data.at(-1).close, 22040);
  assert.equal(new Set(f.state.data.map(c => c.time)).size, f.state.data.length);
  assert.deepEqual(f.stats.frames, [['5m']], 'Boundary tick refreshes 5m once, not twice');
  assert.equal(f.stats.futures, 1);
});

test('history 429 preserves data and live quotes, with no retry before the provider deadline', async () => {
  const limited = Object.assign(new Error('Rate limited'), { status: 429, retryAfterMs: 75000 });
  let fail = true;
  const f = fixture(() => { if (fail) { f.cooldown(75000); throw limited; }
    return f.state.data; });
  const before = json(f.state.data);
  await f.refresh();
  assert.deepEqual(json(f.state.data), before);
  assert.equal(f.stats.unsubscribes, 0);
  assert.equal(f.stats.fullLoads, 0);
  assert.match(f.stats.status.at(-1).detail, /75s.*quote feed preserved/);
  f.clock('12:04:03');
  f.tick({ time: f.now(), price: 22035 });
  assert.equal(f.state.quotes.NIFTY, 22035);
  assert.equal(f.state.data.at(-1).close, 22035);
  assert.match(f.stats.status.at(-1).detail, /Quotes updating.*72s/);
  f.clock('12:05:14');
  await f.refresh();
  assert.equal(f.stats.histories.length, 1);
  f.clock('12:05:15');
  fail = false;
  await f.refresh();
  assert.equal(f.stats.histories.length, 2);
  assert.equal(f.context.historyRefreshWarning, '');
});

test('non-rate-limit history failure does not blank data or cancel the quote feed', async () => {
  const f = fixture(() => { throw new Error('Network failure'); });
  const before = json(f.state.data);
  await f.refresh();
  assert.deepEqual(json(f.state.data), before);
  assert.equal(f.stats.unsubscribes, 0);
  assert.match(f.stats.status.at(-1).detail, /quote feed preserved/);
  assert.equal(f.context.historyRefreshInFlight, false);
});

test('late history success or failure cannot overwrite a changed timeframe or Replay', async () => {
  for (const mode of ['timeframe', 'replay', 'failure']) {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    const refresh = f.refresh();
    f.context.request++;
    if (mode === 'replay') f.state.replay.active = true;
    else { f.state.tf = '5m'; f.context.loadedHistoryKey = 'NIFTY:5m'; }
    f.state.data = [candle('12:00:00', 22040)];
    const current = json(f.state.data);
    if (mode === 'failure') pending.reject(Object.assign(new Error('429'), { status: 429 }));
    else pending.resolve([candle('12:03:00', 22005)]);
    await refresh;
    assert.deepEqual(json(f.state.data), current);
    assert.equal(f.stats.draws, 0);
    assert.deepEqual(f.stats.status, []);
    assert.equal(f.context.historyRefreshInFlight, false);
  }
});

test('concurrent periodic refresh attempts share the existing in-flight guard', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const tick = f.timer();
  tick(); tick();
  await f.refresh();
  assert.equal(f.stats.histories.length, 1);
  assert.equal(f.context.historyRefreshInFlight, true);
  pending.resolve(f.state.data);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.historyRefreshInFlight, false);
  assert.equal(f.stats.fullLoads, 0);
});

test('hidden, closed-session, replay, initial-load, missing and unlike-timeframe views do not refresh', async () => {
  for (const configure of [
    f => { f.context.document.hidden = true; },
    f => { f.clock('16:00:00'); },
    f => { f.state.replay.active = true; },
    f => { f.context.fullHistoryRequest = 7; },
    f => { f.state.data = []; },
    f => { f.state.tf = '5m'; },
    f => { f.cooldown(120000); }
  ]) {
    const f = fixture(); configure(f); await f.refresh();
    assert.equal(f.stats.histories.length, 0);
  }
});

test('only real session-aligned bars are merged, and partial data still produces AI WAIT', async () => {
  const f = fixture(() => [
    candle('12:00:00', 22005), candle('12:03:00', 22008),
    candle('09:12:00'), candle('15:30:00'), candle('16:00:00'),
    candle('12:09:00'), candle('12:01:00'), { ...candle('11:57:00'), high: 1 }
  ]);
  await f.refresh();
  assert.deepEqual(json(f.state.data.map(c => c.time)), [
    epoch('11:57:00'), epoch('12:00:00'), epoch('12:03:00')
  ]);
  const ai = analyse({ candles: f.state.data, seconds: 180, now: f.now() });
  assert.equal(ai.signal, 'AI WAIT');
  assert.equal(ai.score, 0);
  assert.equal(ai.regime, 'WARMING UP');
});

test('empty or invalid history is not treated as a successful refresh', async () => {
  for (const rows of [[], [candle('16:00:00')], [{ ...candle('12:03:00'), close: NaN }]]) {
    const f = fixture(() => rows);
    const before = json(f.state.data);
    await f.refresh();
    assert.deepEqual(json(f.state.data), before);
    assert.equal(f.stats.draws, 0);
    assert.equal(f.stats.status.at(-1).status, 'RECONNECTING');
  }
});

test('3m candles refresh higher timeframes when boundaries are crossed, not only at joint multiples', () => {
  const f = fixture();
  assert.deepEqual(json(f.framesCrossed(epoch('09:15:00'), epoch('09:18:00'))), []);
  assert.deepEqual(json(f.framesCrossed(epoch('09:18:00'), epoch('09:21:00'))), ['5m']);
  assert.deepEqual(json(f.framesCrossed(epoch('09:27:00'), epoch('09:30:00'))), ['5m', '15m']);
  assert.deepEqual(json(f.framesCrossed(epoch('10:12:00'), epoch('10:15:00'))), ['5m', '15m', '1h']);
  assert.deepEqual(json(f.framesCrossed(epoch('12:03:00'), epoch('12:03:00'))), []);
  assert.deepEqual(json(f.framesCrossed(epoch('15:27:00'), epoch('16:00:00'))), []);
});

test('server history crossing a boundary refreshes only due confirmations once', async () => {
  const f = fixture(() => [candle('11:57:00'), candle('12:00:00'),
    candle('12:03:00'), candle('12:06:00')]);
  f.clock('12:06:04');
  await f.refresh();
  assert.deepEqual(f.stats.frames, [['5m']]);
  assert.equal(f.stats.futures, 1);
});

test('startup no longer repeats previous-session history or an immediate full MTF refresh', () => {
  const fullLoad = app.slice(app.indexOf('    async function loadData()'),
    app.indexOf('    function activateAllIndicators()', app.indexOf('    async function loadData()')));
  assert.equal(fullLoad.includes('market.previousHistory('), false);
  assert.equal(fullLoad.includes('refreshMTF().catch('), false);
  assert.equal(fullLoad.includes('await refreshMTF();'), false,
    'Supporting confirmations no longer block the first chart or quote subscription');
  assert.equal(fullLoad.includes('loadStartupConfirmations(id);'), true,
    'Startup still requests required MTF confirmations exactly once in the background');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { historicalDateLimit, validateHistoricalDate, selectHistoricalSession,
  historicalReplayData, loadHistoricalSession, HISTORICAL_MIN_DATE } from './historical-session.js';

const now = Date.parse('2026-10-19T10:00:00+05:30');
const date = '2026-10-16';
const epoch = (date, clock) => Date.parse(date + 'T' + clock + '+05:30') / 1000;
const row = (date, clock, close = 22000) => [date + 'T' + clock + '+05:30', close, close + 10, close - 10, close, 0];
const candle = (date, clock, close = 22000) => ({ time: epoch(date, clock), open: close,
  high: close + 10, low: close - 10, close, volume: 0 });
const payload = () => ({ historical: true, live: false, available: true, date, symbol: 'NIFTY', timeframe: '1m',
  candles: [candle('2026-10-15', '15:29:00'), candle(date, '09:15:00'),
    candle(date, '09:16:00', 22010), candle(date, '09:17:00', 99999)],
  mtf: Object.fromEntries(['5m', '15m', '1h'].map(frame => [frame, [candle(date, '09:15:00')]])) });

test('historical dates use IST yesterday and reject invalid, future, current or unavailable-era dates', () => {
  assert.equal(historicalDateLimit(Date.parse('2026-10-18T18:29:59Z')), '2026-10-17');
  assert.equal(historicalDateLimit(Date.parse('2026-10-18T18:30:00Z')), '2026-10-18');
  for (const value of ['', null, undefined, '2026-02-30', '2026-2-01', '2026-13-01',
    '2021-12-31', '2026-10-19', '2026-10-20', '<script>']) {
    assert.throws(() => validateHistoricalDate(value, now));
  }
  assert.equal(validateHistoricalDate(date, now), date);
  assert.equal(validateHistoricalDate('2022-01-01', now), '2022-01-01');
});

test('session selection keeps genuine aligned regular-session rows, caps warmup and excludes future data', () => {
  const previous = Array.from({ length: 300 }, (_, i) => {
    const time = epoch('2026-10-15', '09:15:00') + i * 60;
    return [new Date(time * 1000).toISOString(), 22000, 22010, 21990, 22000, 0];
  });
  const rows = [...previous, row(date, '09:15:00'), row(date, '09:15:00', 22001),
    row(date, '15:29:00'), row(date, '15:30:00'), row(date, '09:14:00'),
    row(date, '09:15:01'), row('2026-10-19', '09:15:00'),
    [date + 'T09:16:00+05:30', null, 10, 1, 5, 0],
    [date + 'T09:16:00+05:30', 22000, 21900, 21800, 22000, 0]];
  const before = structuredClone(rows);
  const selected = selectHistoricalSession(rows, date, '1m');
  assert.equal(selected.warmupCount, 220);
  assert.equal(selected.firstSessionIndex, 220);
  assert.equal(selected.sessionCount, 2);
  assert.equal(selected.candles[220].close, 22001);
  assert.equal(selected.candles.at(-1).time, epoch(date, '15:29:00'));
  assert.deepEqual(rows, before);
  assert.throws(() => selectHistoricalSession([], date, 'invalid'));
});

test('historical browser payload rejects mismatched/live responses and revalidates all candle frames', () => {
  for (const change of [{ live: true }, { historical: false }, { available: false },
    { date: '2026-10-15' }, { timeframe: '3m' }, { symbol: 'BANKNIFTY' }]) {
    assert.throws(() => historicalReplayData({ ...payload(), ...change }, date, '1m'));
  }
  const p = payload();
  p.candles.push(candle('2026-10-19', '09:15:00', 88888));
  p.mtf['5m'].push(candle('2026-10-19', '09:15:00', 88888));
  const selected = historicalReplayData(p, date, '1m');
  assert.equal(selected.candles.length, 4);
  assert.equal(selected.mtf['5m'].length, 1);
  assert.ok(!selected.candles.some(c => c.close === 88888));
});

test('historical loader makes only bounded sequential past-range requests and reuses matching MTF', async () => {
  for (const [timeframe, expected] of [['1m', 4], ['3m', 4], ['5m', 3], ['15m', 3]]) {
    const calls = []; let active = 0;
    const data = await loadHistoricalSession({ symbol: 'NIFTY', timeframe, date, now,
      instrumentKey: 'NSE_INDEX|Nifty 50', fetchCandles: async endpoint => {
        assert.equal(active++, 0, 'Requests remain sequential');
        calls.push(endpoint); await Promise.resolve(); active--;
        return { data: { candles: [row('2026-10-15', '09:15:00'), row(date, '09:15:00')] } };
      } });
    assert.equal(calls.length, expected);
    assert.ok(calls.every(x => !x.includes('intraday') && x.includes('/' + date + '/')));
    assert.ok(calls.some(x => x.includes('/hours/1/')));
    assert.equal(data.historical, true);
    assert.equal(data.live, false);
    assert.equal(data.date, date);
    assert.equal(data.firstSessionIndex, 1);
    assert.match(data.warning, /NOT LIVE/);
  }
});

test('empty selected day stops after one request without substituting the previous session', async () => {
  let calls = 0;
  const data = await loadHistoricalSession({ symbol: 'NIFTY', timeframe: '1m', date, now,
    instrumentKey: 'NSE_INDEX|Nifty 50', fetchCandles: async () => {
      calls++; return { data: { candles: [row('2026-10-15', '09:15:00')] } };
    } });
  assert.equal(calls, 1);
  assert.equal(data.available, false);
  assert.deepEqual(data.candles, []);
  assert.match(data.reason, /holiday|unavailable/);
});

test('rate limits/controller failures stop historical requests immediately, without fallback or shortened waits', async () => {
  for (const [status, after] of [[429, 1], [429, 2], [503, 1], [503, 2]]) {
    let calls = 0;
    const failure = Object.assign(new Error('fixture safety failure'), { status, retryAfterMs: 253527, coordinator: true });
    await assert.rejects(loadHistoricalSession({ symbol: 'NIFTY', timeframe: '1m', date, now,
      instrumentKey: 'NSE_INDEX|Nifty 50', fetchCandles: async () => {
        if (++calls === after) throw failure;
        return { data: { candles: [row(date, '09:15:00')] } };
      } }), error => error === failure && error.retryAfterMs === 253527);
    assert.equal(calls, after);
  }
});

test('the earliest available date clamps warmup rather than requesting pre-2022 history', async () => {
  const calls = [];
  await loadHistoricalSession({ symbol: 'NIFTY', timeframe: '1m', date: HISTORICAL_MIN_DATE, now,
    instrumentKey: 'NSE_INDEX|Nifty 50', fetchCandles: async url => {
      calls.push(url); return { data: { candles: [row(HISTORICAL_MIN_DATE, '09:15:00')] } };
    } });
  assert.ok(calls.every(url => url.endsWith('/2022-01-01/2022-01-01')));
});

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
function replayFixture(loader = async () => payload()) {
  const nodes = new Map();
  const state = { symbol: 'NIFTY', tf: '1m', data: [candle('2026-10-19', '09:15:00')],
    quotes: { NIFTY: 77777 }, previousClose: {}, sessionOpen: {}, primeMtfData: {},
    futuresVWAP: 77777, tradeFinalizer: { state: 'BUY' }, marketMap: { trend: 'BUY' },
    mtf: {}, replay: { active: false, loading: false, date: null, source: [], mtfSource: null,
      index: 0, firstSessionIndex: 0, speed: 700, timer: null } };
  const calls = { unsubscribe: 0, draws: 0, summaries: 0, liveLoads: 0, requests: 0, alerts: 0 };
  const context = vm.createContext({ state, request: 0, reconnectTimer: 1, loadedHistoryKey: 'NIFTY:1m',
    fullHistoryRequest: null, lastAnalysisKey: 'old', intervals: { '1m': 60, '3m': 180 },
    Date, Math, Number, Object, HISTORICAL_MIN_DATE, historicalDateLimit, historicalReplayData,
    validateHistoricalDate: value => validateHistoricalDate(value, now),
    primeFinite: Number.isFinite,
    $: key => { if (!nodes.has(key)) nodes.set(key, { value: date, classList: { toggle() {} } }); return nodes.get(key); },
    unsubscribe: () => { calls.unsubscribe++; }, clearTimeout() {}, clearInterval() {},
    cancelScheduledRender() {}, historyRefreshSchedule: { reset() {} },
    market: { historicalSession: (...args) => { calls.requests++; return loader(...args); } },
    setFeedStatus: (status, details) => { state.feedStatus = status; state.feedDetails = details; },
    draw: () => { calls.draws++; }, summary: () => { calls.summaries++; },
    renderPrimeMarket() {}, renderSmartMoneyTools() {}, renderTradeFinalizer() {},
    renderAllIndicatorsConsensus() {}, renderProSuiteSummary() {}, renderWatch() {},
    setChartView: mode => { state.tvChartMode = mode; },
    renderIndicatorReadout() {},
    updateTradingDate() {}, renderMTF() {}, timeframeTrend: () => ({ side: 0 }),
    toast() {}, loadData: () => { calls.liveLoads++; },
    processSignalAlerts: () => { calls.alerts++; }
  });
  const start = app.indexOf('    function updateReplayControls()');
  const end = app.indexOf('    function timeframeTrend(', start);
  vm.runInContext(app.slice(start, end), context);
  return { state, context, calls, nodes, load: value => context.loadHistoricalDate(value ?? date),
    exit: () => context.exitReplay(true), step: () => context.stepReplay() };
}

test('selected-date replay starts at its first candle, clears live context and does not read ahead or alert', async () => {
  const f = replayFixture();
  await f.load();
  assert.equal(f.state.replay.active, true);
  assert.equal(f.state.replay.loading, false);
  assert.equal(f.state.tvChartMode, 'classic', 'Do not display a live/current external chart beside historical analysis');
  assert.equal(f.state.data.at(-1).time, epoch(date, '09:15:00'));
  assert.equal(f.state.quotes.NIFTY, 22000);
  assert.equal(f.state.futuresVWAP, null);
  assert.equal(f.state.tradeFinalizer, null);
  assert.equal(f.state.marketMap, null);
  assert.equal(f.state.primeMtfData['5m'].length, 0, '09:15 5m bar has not closed at 09:16');
  assert.equal(f.calls.unsubscribe, 1);
  assert.equal(f.calls.alerts, 0);
  assert.match(f.nodes.get('#replay-status').textContent, /HISTORICAL 2026-10-16.*1 \/ 3.*NOT LIVE/);
  f.step();
  assert.equal(f.state.data.at(-1).time, epoch(date, '09:16:00'));
  assert.ok(!f.state.data.some(c => c.close === 99999));
});

test('the toolbar badge follows feed state rather than saying LIVE after market close or on an error', () => {
  const f = replayFixture();
  for (const [status, label] of [['CLOSED', 'MARKET CLOSED'], ['RECONNECTING', 'RECONNECTING'],
    ['DATA UNAVAILABLE', 'DATA UNAVAILABLE'], ['LIVE', 'LIVE']]) {
    f.state.feedStatus = status;
    f.context.updateReplayControls();
    assert.equal(f.nodes.get('#replay-status').textContent, label);
    assert.equal(f.nodes.get('#replay-status').className.includes('live'), status === 'LIVE');
  }
});

test('an invalid date leaves live data untouched, and repeated loads do not duplicate requests', async () => {
  let complete;
  const f = replayFixture(() => new Promise(resolve => { complete = resolve; }));
  await f.load('2026-02-30');
  assert.equal(f.calls.unsubscribe, 0);
  assert.equal(f.calls.requests, 0);
  const first = f.load();
  await f.load();
  assert.equal(f.calls.requests, 1);
  assert.equal(f.nodes.get('#replay-play').disabled, true);
  assert.match(f.state.feedDetails, /HISTORICAL.*LOADING.*NOT LIVE/);
  complete(payload()); await first;
});

test('returning to live or switching chart invalidates a late historical response', async () => {
  for (const change of ['live', 'timeframe', 'symbol']) {
    let complete;
    const f = replayFixture(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.load();
    if (change === 'live') f.exit();
    if (change === 'timeframe') f.state.tf = '3m';
    if (change === 'symbol') f.state.symbol = 'BANKNIFTY';
    complete(payload()); await pending;
    assert.equal(f.state.replay.source.length, 0);
    assert.equal(f.state.data.length, 0);
    if (change === 'live') {
      assert.equal(f.calls.liveLoads, 1);
      assert.equal(f.state.replay.active, false);
      assert.equal(f.state.replay.date, null);
    }
  }
});

test('failed historical data stays explicitly historical/unavailable with no candles or automated retry', async () => {
  for (const failure of [new Error('No session candles'),
    Object.assign(new Error('broker rate limit'), { status: 429, retryAfterMs: 253527 })]) {
    const f = replayFixture(async () => { throw failure; });
    await f.load();
    assert.equal(f.state.data.length, 0);
    assert.equal(f.calls.requests, 1);
    assert.equal(f.state.feedStatus, 'REPLAY');
    assert.match(f.state.feedDetails, /HISTORICAL.*DATA UNAVAILABLE.*NOT LIVE/);
    assert.equal(f.nodes.get('#replay-play').disabled, true);
    assert.equal(f.nodes.get('#historical-load').disabled, false);
    assert.equal(f.nodes.get('#replay-live').disabled, false);
    if (failure.status === 429) assert.match(f.state.replay.message, /254s/);
  }
});

test('historical UI has a labelled date picker, explicit loading action and non-live warning', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /label for="historical-date"/);
  assert.match(html, /id="historical-date" type="date"/);
  assert.match(html, /id="historical-load" type="button"/);
  assert.match(html, /id="historical-message" role="status" aria-live="polite"/);
  assert.match(app, /historicalDate\) loadHistoricalDate\(historicalDate\)/);
});

const workerURL = new URL('./worker.js', import.meta.url);
const workerSource = readFileSync(workerURL, 'utf8');
let fixtureId = 0;
async function freshWorker() {
  const parserStub = 'data:text/javascript,' + encodeURIComponent('export function parse() { throw new Error("Unexpected breadth access"); }');
  const source = workerSource.replace(/from '(\.\/[^']+)'/g, (_, path) =>
    "from '" + new URL(path, workerURL).href + "'").replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
    '\n// historical-session fixture ' + ++fixtureId;
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
}

function workerFixture(t, fetcher) {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  Date.now = () => now;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push(String(url)); return fetcher(String(url), options); };
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  const request = params => new Request('https://example.test/api/upstox-historical-session?' + params);
  return { calls, request, env: { UPSTOX_EXTENDED_TOKEN: 'fixture-historical-token' } };
}

test('actual Worker historical route returns only historical candles and rejects invalid inputs before upstream access', async t => {
  const f = workerFixture(t, () => new Response(JSON.stringify({ data: { candles: [row(date, '09:15:00')] } })));
  const worker = await freshWorker();
  for (const params of ['date=2026-10-19', 'date=2026-02-30', 'date=2021-12-31',
    'date=' + date + '&symbol=OTHER', 'date=' + date + '&timeframe=1D']) {
    assert.equal((await worker.fetch(f.request(params), f.env)).status, 400);
  }
  assert.equal(f.calls.length, 0);
  const response = await worker.fetch(f.request('date=' + date + '&timeframe=1m'), f.env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.historical, true);
  assert.equal(data.live, false);
  assert.equal(data.date, date);
  assert.equal(data.sessionCount, 1);
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.every(url => url.startsWith('https://api.upstox.com/v3/historical-candle/') && !url.includes('intraday')));
});

test('actual Worker stops on a broker 429 and retains its provider retry deadline', async t => {
  const f = workerFixture(t, () => new Response('{}', { status: 429, headers: { 'retry-after': '254' } }));
  const worker = await freshWorker();
  for (const tf of ['1m', '3m']) {
    const response = await worker.fetch(f.request('date=' + date + '&timeframe=' + tf), f.env);
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.rateLimited, true);
    assert.equal(body.retryAfterMs, 254000);
  }
  assert.equal(f.calls.length, 1, 'No alternate date/timeframe or direct fallback bypass');
});

test('actual Worker preserves enabled coordinator failure without direct broker fallback', async t => {
  const f = workerFixture(t, () => { throw new Error('Direct broker fetch forbidden'); });
  const worker = await freshWorker();
  let bindingCalls = 0;
  const namespace = {
    idFromName: name => { assert.equal(name, 'smrt-upstox-data-v1'); return 'fixture-object'; },
    get: () => ({ fetch: async () => { bindingCalls++; return new Response(JSON.stringify({
      reason: 'Previous broker outcome unknown. [COORDINATOR_PRIOR_OUTCOME_UNKNOWN]'
    }), { status: 503 }); } })
  };
  const response = await worker.fetch(f.request('date=' + date), {
    ...f.env, UPSTOX_COORDINATOR_ENABLED: 'true', UPSTOX_COORDINATOR: namespace });
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.coordinatorFailure, true);
  assert.equal(data.historical, true);
  assert.match(data.reason, /COORDINATOR_PRIOR_OUTCOME_UNKNOWN/);
  assert.equal(bindingCalls, 1);
  assert.equal(f.calls.length, 0);
});

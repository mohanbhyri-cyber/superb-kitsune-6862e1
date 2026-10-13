import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const bar = time => ({ time, open: 22000, high: 22010, low: 21990, close: 22005, volume: 0 });

function startup() {
  const events = [], supporting = deferred();
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false },
    mtf: { loading: true, activeRequest: {}, '5m': { side: 1 } },
    sessionOpen: {}, quotes: {}, primeMtfData: { '5m': [bar(1)] } };
  const context = vm.createContext({
    state, request: 0, loadedHistoryKey: null, historyRefreshWarning: '',
    fullHistoryRequest: null, lastAnalysisKey: null,
    reconnectTimer: null, reconnectAttempts: 0, unsubscribe: null,
    clearTimeout() {}, console: { warn() {}, error() {} },
    formatTradingDate: () => '2026-10-13', isNseCashMarketOpen: () => true,
    updateTradingDate() {}, syncIndicatorControls() {},
    renderPrimeMarket() {}, renderSmartMoneyTools() {}, renderTradeFinalizer() {},
    renderAllIndicatorsConsensus() {}, renderProSuiteSummary() {},
    refreshLiveTradeFinalizer: () => events.push('analyse'),
    draw: () => {
      assert.ok(state.data.length > 0);
      assert.equal(state.primeMtfData['5m'].length, 0, 'Clear old MTF before first paint');
      events.push('draw');
    }, summary: () => events.push('summary'),
    refreshMTF: () => { events.push('mtf'); return supporting.promise; },
    // Keep other optional confirmations pending too, isolating MTF completion.
    refreshFuturesVWAP: () => new Promise(() => {}), refreshExternalNifty: async () => {},
    scheduleLiveRender: () => events.push('render-confirmations'),
    setFeedStatus: value => events.push('feed:' + value),
    signalTracker: { baseline() {} }, scalpTracker: { baseline() {} },
    momentumTracker: { baseline() {} },
    market: {
      history: async () => [bar(1791854100), bar(1791854280)],
      subscribe: () => { events.push('subscribe'); return () => {}; }
    },
    toast() {}, scheduleReconnect: () => events.push('reconnect')
  });
  const start = app.indexOf('    function startStartupConfirmations(');
  const end = app.indexOf('    function activateAllIndicators()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end) + '\nthis.load = loadData;', context);
  return { state, context, events, supporting, load: context.load };
}

test('first chart and live quote subscription do not await slow supporting histories', async () => {
  const f = startup();
  await f.load(); // Supporting promise remains unresolved throughout startup.
  assert.ok(f.events.indexOf('draw') < f.events.indexOf('subscribe'));
  assert.ok(f.events.indexOf('subscribe') < f.events.indexOf('mtf'));
  assert.equal(f.events.filter(e => e === 'mtf').length, 1);
  assert.equal(f.context.fullHistoryRequest, null);
  assert.equal(f.events.includes('render-confirmations'), false);
  assert.equal(f.state.primeMtfData['15m'].length, 0);
  f.supporting.resolve();
  await flush();
  assert.equal(f.events.filter(e => e === 'render-confirmations').length, 1);
});

test('late startup completion cannot render into another load, symbol, timeframe or Replay', async () => {
  for (const change of [f => { f.context.request++; }, f => { f.state.symbol = 'OTHER'; },
    f => { f.state.tf = '5m'; }, f => { f.state.replay.active = true; }]) {
    const f = startup();
    await f.load();
    change(f);
    f.supporting.resolve();
    await flush();
    assert.equal(f.events.includes('render-confirmations'), false);
  }
});

test('supporting failure does not erase main candles or disconnect live quotes', async () => {
  const f = startup();
  await f.load();
  const data = f.state.data, subscription = f.context.unsubscribe;
  f.supporting.reject(new Error('Fixture provider cooldown'));
  await flush();
  assert.equal(f.state.data, data);
  assert.equal(f.context.unsubscribe, subscription);
  assert.equal(f.events.includes('reconnect'), false);
  assert.equal(f.events.includes('render-confirmations'), false);
});

function mtfFixture() {
  const calls = [], renders = [];
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false },
    primeMtfData: { '5m': [], '15m': [], '1h': [] }, mtf: { loading: false } };
  const context = vm.createContext({
    state, request: 1, Date, console: { log() {}, warn() {} },
    renderMTF: () => renders.push('mtf'),
    recomputeAllIndicatorsConsensus: () => renders.push('consensus'),
    timeframeTrend: () => ({ side: 1, state: 'BULLISH' }),
    market: { mtfHistory: (symbol, tf) => {
      const pending = deferred(); calls.push({ symbol, tf, ...pending }); return pending.promise;
    } }
  });
  const start = app.indexOf('    async function refreshMTF(');
  const end = app.indexOf('    function scheduleReconnect(', start);
  vm.runInContext(app.slice(start, end) + '\nthis.refresh = refreshMTF;', context);
  return { state, context, calls, renders, refresh: context.refresh };
}

test('supporting requests stay sequential, single-flight and limited to requested frames', async () => {
  const f = mtfFixture(), job = f.refresh();
  assert.deepEqual(f.calls.map(c => c.tf), ['5m']);
  await f.refresh();
  assert.equal(f.calls.length, 1);
  for (let i = 0; i < 3; i++) {
    f.calls[i].resolve([bar(100 + i)]);
    await flush();
  }
  await job;
  assert.deepEqual(f.calls.map(c => c.tf), ['5m', '15m', '1h']);
  assert.equal(f.state.mtf.overall, 'MTF BULLISH');
  assert.equal(f.state.mtf.loading, false);
  assert.equal(f.renders.filter(r => r === 'consensus').length, 1);
  const one = f.refresh(['15m']);
  f.calls.at(-1).resolve([]);
  await one;
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls.at(-1).tf, '15m');
});

test('stale MTF work stops remaining requests and cannot apply after context changes', async () => {
  for (const change of [f => { f.context.request++; }, f => { f.state.symbol = 'OTHER'; },
    f => { f.state.tf = '5m'; }, f => { f.state.replay.active = true; }]) {
    const f = mtfFixture(), job = f.refresh();
    change(f);
    f.calls[0].resolve([bar(100)]);
    await job;
    assert.equal(f.calls.length, 1, 'No obsolete timeframe requests');
    assert.equal(f.state.primeMtfData['5m'].length, 0);
    assert.equal(f.renders.includes('consensus'), false);
    assert.equal(f.state.mtf.loading, false);
  }
});

test('older completion cannot clear loading or overwrite a newer confirmation job', async () => {
  const f = mtfFixture(), old = f.refresh();
  f.context.request++;
  f.state.mtf.activeRequest = null;
  f.state.mtf.loading = false;
  const current = f.refresh(['5m']);
  f.calls[0].resolve([bar(100)]);
  await old;
  assert.equal(f.state.mtf.loading, true);
  assert.equal(f.state.primeMtfData['5m'].length, 0);
  f.calls[1].resolve([bar(200)]);
  await current;
  assert.equal(f.state.primeMtfData['5m'][0].time, 200);
  assert.equal(f.state.mtf.loading, false);
});

test('missing background data still fails all three real mandatory Prime MTF gates', () => {
  const checks = [], result = { mtf: {} };
  const context = vm.createContext({
    result, mtfData: {}, now: 20000, seconds: 180, side: 1, last: { time: 19000 },
    console: { log() {} }, primeTechnical: () => ({ side: 1 }),
    primeStructure: () => ({ direction: 1 }),
    check: (name, ok, reason, required = true) => checks.push({ name, ok, reason, required })
  });
  const helpersStart = app.indexOf('    function primeFinite(');
  const helpersEnd = app.indexOf('    function lastClosedCandleIndex(', helpersStart);
  vm.runInContext(app.slice(helpersStart, helpersEnd), context);
  const start = app.indexOf("      for (const [tf, duration] of [['5m', 300]");
  const end = app.indexOf('      const efficiency = legacy.efficiency;', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  assert.deepEqual(checks.map(c => c.name), ['MTF 5m', 'MTF 15m', 'MTF 1h']);
  assert.ok(checks.every(c => !c.ok && c.required));
  for (const tf of ['5m', '15m', '1h']) {
    assert.equal(result.mtf[tf].fresh, false);
    assert.equal(result.mtf[tf].ready, false);
  }
});

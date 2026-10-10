import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analyseRisk } from './smrt-risk-engine.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const first = app.indexOf(start);
  const last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return app.slice(first, last);
};
const gateSource = extract('    function primeGate(', '    function refreshPrimeConfirmation()');
const startupSource = extract('    async function loadStartupConfirmations(',
  '    function activateAllIndicators()');
const mtfSource = extract('    async function refreshMTF(', '    function scheduleReconnect(');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const bars = Array.from({ length: 260 }, (_, i) => ({
  time: Date.parse(`2026-10-0${6 + Math.floor(i / 125)}T09:15:00+05:30`) / 1000 +
    (i % 125) * 180,
  open: 22000, high: 22010, low: 21990, close: 22005, volume: 0
}));
const bullish = () => ({ signal: 'BUY', state: 'BUY', side: 1, score: 90,
  confidence: 90, checks: [{ name: 'existing', ok: true }], reasons: [],
  plan: { entry: 22005, stop: 21990, target1: 22035 } });

function startupFixture({ history = async () => bars, confirmations = async () => {} } = {}) {
  const events = [];
  const state = { symbol: 'NIFTY', tf: '3m', data: [], replay: { active: false },
    quotes: {}, sessionOpen: {}, previousClose: {}, mtf: {}, primeMtfData: {} };
  const context = vm.createContext({
    state, request: 0, loadedHistoryKey: null, fullHistoryRequest: null,
    historyRefreshWarning: '', lastAnalysisKey: null, reconnectTimer: null,
    reconnectAttempts: 0, unsubscribe: null, intervals: { '3m': 180, '5m': 300 },
    primeSide: value => /NO TRADE|WAIT/.test(value || '') ? 0 : /BUY/.test(value || '') ? 1 : 0,
    market: {
      history,
      mtfHistory: () => { throw new Error('Unexpected warm-up request'); },
      subscribe: () => { events.push('subscribe'); return () => events.push('unsubscribe'); }
    },
    refreshMTF: async () => { events.push('confirmations'); await confirmations(); },
    formatTradingDate: value => new Date(value * 1000).toISOString().slice(0, 10),
    renderPrimeMarket() {}, renderSmartMoneyTools() {}, renderTradeFinalizer() {},
    renderAllIndicatorsConsensus() {}, renderProSuiteSummary() {},
    activateAllIndicators() {}, updateTradingDate() {},
    refreshLiveTradeFinalizer: () => {
      state.primeMarket = context.gateStartupConfirmation(bullish());
      state.tradeFinalizer = context.primeGate(bullish(), state.primeMarket);
    },
    draw: () => {
      events.push('draw');
      context.refreshLiveTradeFinalizer();
      assert.equal(state.tradeFinalizer.side, 0, 'First paint cannot confirm a trade');
      assert.equal(state.tradeFinalizer.plan, null);
    },
    summary: () => events.push('summary'),
    scheduleLiveRender: force => { assert.equal(force, true); events.push('render-ready'); },
    refreshFuturesVWAP: async () => {}, refreshExternalNifty: async () => {},
    signalTracker: { baseline() {} }, scalpTracker: { baseline() {} },
    momentumTracker: { baseline() {} }, isNseCashMarketOpen: () => true,
    setFeedStatus: status => events.push(status), clearTimeout() {},
    toast: message => events.push(message), scheduleReconnect: () => events.push('reconnect'),
    console: { warn() {}, error() {} }
  });
  vm.runInContext(gateSource + startupSource +
    '\nthis.load = loadData; this.gateStartupConfirmation = gateStartupConfirmation;' +
    '\nthis.primeGate = primeGate; this.confirm = loadStartupConfirmations;', context);
  return { state, context, events, load: context.load };
}

test('first chart and quote subscription do not wait for pending supporting data', async () => {
  const pending = deferred();
  const f = startupFixture({ confirmations: () => pending.promise });
  await f.load();
  assert.equal(f.state.data.length, 260);
  assert.equal(f.state.startupConfirmationsPending, true);
  assert.equal(f.events.filter(event => event === 'confirmations').length, 1);
  assert.ok(f.events.indexOf('draw') < f.events.indexOf('confirmations'));
  assert.ok(f.events.includes('subscribe'));
  assert.equal(f.context.fullHistoryRequest, null);
  assert.equal(f.state.tradeFinalizer.state, 'NO TRADE');
  pending.resolve();
  await flush();
  assert.equal(f.state.startupConfirmationsPending, false);
  assert.equal(f.context.lastAnalysisKey, null);
  assert.ok(f.events.includes('render-ready'));
});

test('main history must finish before the first paint or quote subscription', async () => {
  const pending = deferred();
  const f = startupFixture({ history: () => pending.promise });
  const loading = f.load();
  assert.equal(f.events.includes('draw'), false);
  assert.equal(f.events.includes('subscribe'), false);
  pending.resolve(bars);
  await loading;
  assert.ok(f.events.includes('draw'));
  assert.ok(f.events.includes('subscribe'));
});

test('failed supporting downloads preserve the chart/feed and leave missing-data gates intact', async () => {
  const pending = deferred();
  const f = startupFixture({ confirmations: () => pending.promise });
  await f.load();
  pending.reject(new Error('429 retry pending'));
  await flush();
  assert.equal(f.state.data.length, 260);
  assert.equal(f.events.includes('unsubscribe'), false);
  assert.equal(f.events.includes('reconnect'), false);
  assert.equal(f.state.tradeFinalizer.plan, null);
  assert.equal(f.state.primeMtfSymbol, null);
  assert.equal(f.state.primeMtfData['5m'].length, 0);
  assert.equal(f.state.startupConfirmationsPending, false, 'Downloads settled, not confirmations passed');
});

test('invalid main history does not start quotes or supporting downloads', async () => {
  const f = startupFixture({ history: async () => [] });
  await f.load();
  assert.equal(f.events.includes('draw'), false);
  assert.equal(f.events.includes('subscribe'), false);
  assert.equal(f.events.includes('confirmations'), false);
  assert.ok(f.events.includes('reconnect'));
});

test('old startup completion cannot release a new timeframe WAIT gate or render Replay', async () => {
  for (const change of ['timeframe', 'replay']) {
    const pending = deferred();
    const f = startupFixture({ confirmations: () => pending.promise });
    f.context.request = 1;
    f.state.startupConfirmationsPending = true;
    const loading = f.context.confirm(1);
    if (change === 'timeframe') { f.context.request = 2; f.state.tf = '5m'; }
    else f.state.replay.active = true;
    pending.resolve();
    await loading;
    assert.equal(f.state.startupConfirmationsPending, true);
    assert.equal(f.events.includes('render-ready'), false);
  }
});

test('startup veto blocks an otherwise bullish Prime result and disappears only after loading', () => {
  const f = startupFixture();
  f.state.startupConfirmationsPending = true;
  const gated = f.context.gateStartupConfirmation(bullish());
  assert.equal(gated.side, 0);
  assert.equal(gated.signal, 'NO TRADE');
  assert.equal(gated.plan, null);
  assert.equal(gated.score, 0);
  assert.equal(gated.checks.at(-1).ok, false);
  const finalizer = f.context.primeGate(bullish(), gated);
  assert.equal(finalizer.state, 'NO TRADE');
  assert.equal(finalizer.confidence, 0);
  assert.equal(finalizer.plan, null);
  const missing = { signal: 'NO TRADE', side: 0, reasons: ['MTF data unavailable'] };
  f.state.startupConfirmationsPending = false;
  assert.equal(f.context.gateStartupConfirmation(missing), missing);
  assert.equal(f.context.primeGate(bullish(), missing).side, 0);
  const ready = bullish();
  assert.equal(f.context.gateStartupConfirmation(ready), ready);
  assert.equal(f.context.primeGate(bullish(), ready).primeConfirmed, true);
});

test('live startup gate does not alter historical Replay confirmation rules', () => {
  const f = startupFixture();
  f.state.startupConfirmationsPending = true;
  f.state.replay.active = true;
  const historical = bullish();
  assert.equal(f.context.gateStartupConfirmation(historical), historical);
});

test('actual Prime refresh applies the startup veto before finalizer and consensus gates', () => {
  const f = startupFixture();
  f.state.startupConfirmationsPending = true;
  f.state.rawTradeFinalizer = bullish();
  f.context.window = {};
  f.context.primeClosed = () => ({ candles: [] });
  f.context.analyseAdvancedIndicators = () => ({ ready: true });
  f.context.renderIndicatorReadout = () => {};
  f.context.analyseAllIndicators = () => bullish();
  f.context.analysePrimeMarket = () => bullish();
  f.context.renderAiIndicator = () => {};
  f.context.renderBestBuySetup = () => {};
  vm.runInContext(extract('    function refreshPrimeConfirmation()',
    '    function renderSmartMoneyTools()') + '\nrefreshPrimeConfirmation();', f.context);
  assert.equal(f.state.primeMarket.side, 0);
  assert.equal(f.state.allIndicatorsConsensus.signal, 'NO TRADE');
  assert.equal(f.state.allIndicatorsConsensus.confidence, 0);
  assert.equal(f.state.tradeFinalizer.state, 'NO TRADE');
  assert.equal(f.state.tradeFinalizer.plan, null);
  assert.equal(f.state.liveTradeFinalizer, f.state.tradeFinalizer);
  assert.match(f.state.tradeFinalizer.invalidation, /still loading/);
});

test('actual draw risk expression cannot expose an active plan while confirmations load', () => {
  const f = startupFixture();
  f.state.startupConfirmationsPending = true;
  f.state.tradeFinalizer = bullish();
  f.state.trend = { atr: [10] };
  f.context.indicatorData = [{}, {}];
  f.context.analyseRisk = analyseRisk;
  const start = app.indexOf('      state.riskEngine = analyseRisk(');
  const end = app.indexOf('      // Final risk veto:', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), f.context);
  assert.equal(f.state.riskEngine.state, 'NO ACTIVE PLAN');
  assert.equal(f.state.riskEngine.ready, false);
  assert.equal(f.state.riskEngine.score, 0);
});

test('stale MTF success/failure cannot overwrite a new timeframe or clear its loading flag', async () => {
  for (const outcome of ['success', 'failure', 'replay']) {
    const pending = deferred();
    const f = startupFixture();
    const calls = [];
    f.context.renderMTF = () => {};
    f.context.recomputeAllIndicatorsConsensus = () => calls.push('recompute');
    f.context.console.log = () => {};
    f.context.market.mtfHistory = async () => {
      calls.push('fetch'); return pending.promise;
    };
    vm.runInContext(mtfSource + '\nthis.mtf = refreshMTF;', f.context);
    const loading = f.context.mtf();
    f.context.request++;
    f.state.tf = '5m';
    if (outcome === 'replay') f.state.replay.active = true;
    const currentFrames = { '5m': [{ close: 22222 }], '15m': [], '1h': [] };
    f.state.primeMtfData = currentFrames;
    f.state.mtf = { loading: true, overall: 'CURRENT VIEW' };
    if (outcome === 'failure') pending.reject(new Error('Late failure'));
    else pending.resolve(bars);
    await loading;
    assert.equal(f.state.primeMtfData, currentFrames);
    assert.equal(f.state.mtf.loading, true);
    assert.equal(f.state.mtf.overall, 'CURRENT VIEW');
    assert.deepEqual(calls, ['fetch'], 'No stale follow-up downloads or recomputation');
  }
});

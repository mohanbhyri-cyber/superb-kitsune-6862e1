import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const finite = app.slice(app.indexOf('    function primeFinite('),
  app.indexOf('    function closedCandleTiming('));
const helperStart = app.indexOf('    function finalizerDiagnosticChecklist(');
const renderStart = app.indexOf('    function renderTradeFinalizer(');
const renderer = app.slice(helperStart < 0 ? renderStart : helperStart,
  app.indexOf('    function renderCandleScanner(', renderStart));

function render(mandatory, overrides = {}, display = {}) {
  const nodes = new Map();
  const finalizer = {
    state: 'NO TRADE', score: 0, bullScore: 30, bearScore: 70,
    invalidation: 'Prime confirmation incomplete', primeConfirmed: false,
    mandatory, reasons: ['MACD histogram negative required'],
    plan: { entry: 100, stop: 105, target1: 90, target2: 85, target3: 80 },
    ...overrides
  };
  const before = JSON.stringify(finalizer);
  const context = vm.createContext({
    URLSearchParams, window: { location: { search: display.sample ? '?sample=1' : '' } },
    state: { liveTradeFinalizer: display.noFinalizer ? null : finalizer,
      symbol: display.symbol || 'NIFTY', tf: display.tf || '3m',
      feedStatus: display.feed || 'LIVE', replay: { active: !!display.replay } },
    instruments: [{ id: 'NIFTY', name: 'NIFTY 50' }, { id: 'BANKNIFTY', name: 'NIFTY BANK' }],
    isNseCashMarketOpen: () => display.open !== false, renderBestBuySetup() {},
    fmt: value => Number(value).toFixed(2),
    $: selector => {
      if (!nodes.has(selector)) nodes.set(selector, {});
      return nodes.get(selector);
    }
  });
  vm.runInContext(finite + renderer + '\nrenderTradeFinalizer();', context);
  assert.equal(JSON.stringify(finalizer), before, 'display must not mutate trading state');
  return selector => nodes.get(selector)?.textContent;
}

const bearish = {
  emaBull: false, emaBear: true, supertrendBull: false, supertrendBear: true,
  dmiBull: false, dmiBear: true, rsiBull: false, rsiBear: true,
  macdBull: false, macdBear: true, mtfSide: -1,
  adx: 34, rsi: 32.8, macdHistogram: -0.99
};

test('opposing MACD displays its real direction, not a confirmation checkmark', () => {
  const get = render({ ...bearish, macdBull: true, macdBear: false, macdHistogram: 0.99 });
  const reasons = get('#finalizer-reasons');
  assert.match(reasons, /Indicator directions \(not trade approval\):/);
  assert.match(reasons, /EMA BEARISH/);
  assert.match(reasons, /MACD BULLISH \(0\.99\)/);
  assert.doesNotMatch(reasons, /[✓✕]/);
  assert.match(reasons, /MACD histogram negative required/);
  assert.equal(get('#finalizer-state'), 'NO TRADE');
  assert.equal(get('#finalizer-score'), '0 / 100');
  for (const id of ['entry', 'stop', 'tp1', 'tp2', 'tp3'])
    assert.equal(get('#finalizer-' + id), '—');
});

test('bearish directions remain explicit without granting a trade plan', () => {
  const get = render(bearish);
  const reasons = get('#finalizer-reasons');
  for (const name of ['EMA', 'Supertrend', 'ADX/DMI', 'RSI', 'MACD', 'MTF'])
    assert.ok(reasons.includes(name + ' BEARISH'));
  assert.match(reasons, /ADX\/DMI BEARISH \(34\.0\)/);
  assert.equal(get('#finalizer-entry'), '—');
});

test('confirmed bullish plan is displayed unchanged', () => {
  const bullish = { ...bearish, mtfSide: 1, macdHistogram: 0.99 };
  for (const name of ['ema', 'supertrend', 'dmi', 'rsi', 'macd']) {
    bullish[name + 'Bull'] = true;
    bullish[name + 'Bear'] = false;
  }
  const get = render(bullish, {
    state: 'BUY', score: 85, primeConfirmed: true,
    plan: { entry: 100, stop: 95, target1: 110, target2: 115, target3: 120 }
  });
  for (const name of ['EMA', 'Supertrend', 'ADX/DMI', 'RSI', 'MACD', 'MTF'])
    assert.ok(get('#finalizer-reasons').includes(name + ' BULLISH'));
  assert.equal(get('#finalizer-state'), 'BUY');
  assert.equal(get('#finalizer-score'), '85 / 100');
  assert.equal(get('#finalizer-entry'), '₹100.00');
  assert.equal(get('#finalizer-stop'), '₹95.00');
  assert.equal(get('#finalizer-tp3'), '₹120.00');
});

test('conflicting flags show mixed, never approval', () => {
  const get = render({ ...bearish, emaBull: true, macdBull: true });
  assert.match(get('#finalizer-reasons'), /EMA MIXED/);
  assert.match(get('#finalizer-reasons'), /MACD MIXED/);
});

test('missing values are unavailable, not zero or confirmed', () => {
  const get = render({ adx: null, rsi: '', macdHistogram: undefined });
  const reasons = get('#finalizer-reasons');
  assert.match(reasons, /EMA NEUTRAL\/UNAVAILABLE/);
  assert.match(reasons, /ADX\/DMI NEUTRAL\/UNAVAILABLE/);
  assert.match(reasons, /RSI NEUTRAL\/UNAVAILABLE/);
  assert.match(reasons, /MACD NEUTRAL\/UNAVAILABLE/);
  assert.match(reasons, /MTF WAITING/);
  assert.doesNotMatch(reasons, /\(0\.0+\)/);
  assert.match(reasons, /ADX\/DMI unavailable/);
  assert.match(reasons, /RSI unavailable/);
});

test('genuine zero histogram is shown as neutral with its numeric value', () => {
  const get = render({ ...bearish, macdBull: false, macdBear: false, macdHistogram: 0 });
  assert.match(get('#finalizer-reasons'), /MACD NEUTRAL\/UNAVAILABLE \(0\.00\)/);
});

test('absent diagnostic input preserves existing waiting reason', () => {
  const get = render(undefined, { reasons: [] });
  assert.equal(get('#finalizer-reasons'),
    'WAITING · mandatory closed-candle confirmation is incomplete');
});

test('closed session heading overrides a leftover LIVE feed label without changing trade state', () => {
  const get = render(bearish, { invalidation: 'NSE regular session has ended', plan: null },
    { open: false });
  assert.match(get('#finalizer-context'), /NIFTY 50 · 3m · MARKET CLOSED · last session data/);
  assert.doesNotMatch(get('#finalizer-context'), /LIVE setup preview/);
  assert.equal(get('#finalizer-state'), 'NO TRADE');
  assert.equal(get('#finalizer-entry'), '—');
});

test('open session heading uses actual instrument/timeframe and claims LIVE only for live data', () => {
  const live = render(bearish, {}, { symbol: 'BANKNIFTY', tf: '5m' });
  assert.match(live('#finalizer-context'), /NIFTY BANK · 5m · LIVE setup preview/);
  for (const feed of ['STALE', 'FALLBACK', 'RECONNECTING', 'DATA UNAVAILABLE', 'CLOSED']) {
    const get = render(bearish, {}, { feed });
    assert.ok(get('#finalizer-context').includes(feed + ' · no live confirmation'));
    assert.doesNotMatch(get('#finalizer-context'), /LIVE setup preview/);
  }
  assert.match(render(bearish, {}, { feed: 'UNKNOWN' })('#finalizer-context'), /WAITING FOR LIVE DATA/);
});

test('Replay and sample headings remain explicitly non-live, even after hours', () => {
  for (const open of [true, false]) {
    assert.match(render(bearish, {}, { replay: true, open })('#finalizer-context'),
      /REPLAY · historical candles · not a live trade/);
    assert.match(render(bearish, {}, { sample: true, open })('#finalizer-context'),
      /SAMPLE · not a live trade/);
  }
});

test('heading updates before analysis is available and HTML does not hard-code LIVE', () => {
  const get = render(undefined, {}, { noFinalizer: true, open: false });
  assert.match(get('#finalizer-context'), /MARKET CLOSED/);
  assert.equal(get('#finalizer-state'), 'NO TRADE');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="finalizer-context"/g) || []).length, 1);
  assert.doesNotMatch(html, /NIFTY 50 · LIVE setup preview/);
});

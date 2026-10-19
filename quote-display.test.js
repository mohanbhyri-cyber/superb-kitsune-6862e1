import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { quoteDisplay } from './quote-display.js';
const epoch = clock => Date.parse('2026-10-19T' + clock + '+05:30') / 1000;
const candles = [{ time: epoch('15:24:00'), close: 22870 }, { time: epoch('15:25:00'), close: 22873.55 }];
const fixture = { candles, quote: 23073, quoteTime: epoch('10:10:17'), seconds: 60, now: epoch('16:55:00') };

test('closed-session header cannot show an old morning quote over newer real candle history', () => {
  const before = structuredClone(candles);
  const result = quoteDisplay({ ...fixture, sessionOpen: false });
  assert.equal(result.price, 22873.55);
  assert.equal(result.kind, 'candle');
  assert.match(result.description, /Last available candle close.*03:26.*NOT LIVE/);
  assert.deepEqual(candles, before, 'Display selection cannot change indicator candles');
});

test('a fresh timestamped quote is retained only while the regular session is open', () => {
  const result = quoteDisplay({ ...fixture, quote: 22874, quoteTime: epoch('15:26:15'),
    now: epoch('15:26:20'), sessionOpen: true });
  assert.equal(result.kind, 'quote');
  assert.equal(result.price, 22874);
  assert.match(result.description, /Provider quote/);
});

test('old, missing or future quote timestamps cannot pretend to be current data', () => {
  for (const quoteTime of [null, undefined, NaN, epoch('10:10:17'), epoch('15:27:00')]) {
    const result = quoteDisplay({ ...fixture, quoteTime, now: epoch('15:26:20'), sessionOpen: true });
    assert.equal(result.kind, 'candle');
    assert.equal(result.price, 22873.55);
    assert.match(result.description, /NOT LIVE/);
  }
});

test('a forming historical bar is not promoted to a completed price reference', () => {
  const result = quoteDisplay({ ...fixture, candles: [...candles, { time: epoch('15:26:00'), close: 99999 }],
    now: epoch('15:26:20'), sessionOpen: true });
  assert.equal(result.price, 22873.55);
});

test('historical replay ignores current live quote and uses only the visible historical close', () => {
  const result = quoteDisplay({ ...fixture, replay: true, sessionOpen: true,
    quoteTime: epoch('16:55:00'), quote: 99999 });
  assert.equal(result.price, 22873.55);
  assert.equal(result.kind, 'historical');
  assert.match(result.description, /HISTORICAL.*NOT LIVE/);
});

test('missing candle data does not invent a close or a quote timestamp', () => {
  const result = quoteDisplay({ ...fixture, candles: [], quote: null });
  assert.equal(result.price, null);
  assert.equal(result.description, 'Price unavailable');
  const unverified = quoteDisplay({ ...fixture, candles: [] });
  assert.equal(unverified.kind, 'unverified');
  assert.match(unverified.description, /Quote time unverified.*NOT LIVE/);
});

test('scalper level and analysis labels do not claim stale component conditions are a live approved trade', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.ok(!app.includes('IST · live-session levels'));
  assert.ok(app.includes('reference levels only · not trade approval'));
  assert.match(html, /id="price-context"/);
  assert.ok(!html.includes('LIVE ANALYSIS'));
  assert.match(html, /CLOSED-CANDLE CONDITIONS/);
});

test('the actual header renderer replaces stale headline price and stale percent together and refreshes ticker', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const nodes = new Map(['#price-context', '#price', '#change'].map(key => [key, {}]));
  const state = { symbol: 'NIFTY', tf: '1m', replay: { active: false }, data: candles,
    quotes: { NIFTY: 23073 }, quoteTimes: { NIFTY: epoch('10:10:17') },
    officialChange: { NIFTY: -0.34 }, previousClose: { NIFTY: 23000 }, sessionOpen: { NIFTY: 22900 } };
  let watches = 0;
  const context = vm.createContext({ state, intervals: { '1m': 60 }, quoteDisplay,
    Date: { now: () => epoch('16:55:00') * 1000 }, Number,
    isNseCashMarketOpen: () => false, current: () => ({ id: 'NIFTY' }),
    $: key => nodes.get(key), fmt: n => n.toFixed(2),
    formatChange: n => Number.isFinite(n) ? n.toFixed(2) + '%' : '—',
    renderWatch: () => { watches++; } });
  const start = app.indexOf('    function quoteDisplayForState()');
  const end = app.indexOf('    function formatChange(', start);
  vm.runInContext(app.slice(start, end) + '\nrenderQuoteDisplay();', context);
  assert.equal(nodes.get('#price').textContent, '22873.55');
  assert.equal(nodes.get('#change').textContent, '-0.55%');
  assert.match(nodes.get('#price-context').textContent, /NOT LIVE/);
  assert.equal(watches, 1);
  state.previousClose.NIFTY = null;
  context.renderQuoteDisplay();
  assert.equal(nodes.get('#change').textContent, '—', 'Do not invent daily change from an old official snapshot or session open');
});

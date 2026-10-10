import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fixtureId = 0;
const workerURL = new URL('./worker.js', import.meta.url);
const workerSource = readFileSync(workerURL, 'utf8');
const marketSource = readFileSync(new URL('./market.js', import.meta.url), 'utf8');
const session = date => Array.from({ length: 125 }, (_, i) => {
  const time = Date.parse(date + 'T09:15:00+05:30') + i * 180000;
  return [new Date(time).toISOString(), 22000, 22010, 21990, 22000, 0];
});
const friday = session('2026-10-09');
const thursday = session('2026-10-08');
const wednesday = session('2026-10-07');
const ok = rows => new Response(JSON.stringify({ data: { candles: rows } }));

async function fixture(t, fetcher, now = '2026-10-10T14:00:00+05:30') {
  t.mock.method(Date, 'now', () => Date.parse(now));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return fetcher(url);
  });
  const parserStub = 'data:text/javascript,' + encodeURIComponent(
    'export function parse() { throw new Error("Unexpected breadth call"); }');
  const source = workerSource.replace(/from '(\.\/[^']+)'/g, (_, path) =>
    "from '" + new URL(path, workerURL).href + "'")
    .replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
    '\n// warmup fixture ' + ++fixtureId;
  const worker = (await import('data:text/javascript;base64,' +
    Buffer.from(source).toString('base64'))).default;
  return { calls, request: async () => (await worker.fetch(new Request(
    'https://example.test/api/upstox-history?symbol=NIFTY&timeframe=3m'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json() };
}

test('weekend previous-session fallback continues to multi-session warm-up', async t => {
  const f = await fixture(t, url => {
    if (url.includes('/intraday/') || url.endsWith('/2026-10-10/2026-10-10')) return ok([]);
    if (url.endsWith('/2026-10-09/2026-10-09')) return ok(friday);
    if (url.endsWith('/2026-10-10/2026-10-03')) return ok([...wednesday, ...thursday, ...friday]);
    throw new Error('Unexpected request');
  });
  const body = await f.request();
  assert.equal(body.live, true);
  assert.equal(body.count, 260);
  assert.equal(body.currentSessionCount, 0);
  assert.equal(body.sessionDate, '2026-10-09');
  assert.equal(body.marketOpen, false);
  assert.equal(body.warmup.ready, true);
  assert.equal(body.warmup.closedCandles, 260);
  assert.equal(f.calls.length, 4, 'Only one additional range call after session fallback');
  assert.equal(new Set(body.candles.map(c => c.time)).size, 260);
  assert.equal(body.candles.at(-1).time, Date.parse('2026-10-09T15:27:00+05:30') / 1000);
});

test('overlapping range/intraday rows are deduplicated before the 260-bar cap', async t => {
  const fresh = friday.map(row => [...row]);
  fresh.at(-1)[4] = 22005;
  const f = await fixture(t, url => url.includes('/intraday/')
    ? ok(fresh) : ok([...wednesday, ...thursday, ...friday]), '2026-10-09T16:00:00+05:30');
  const body = await f.request();
  assert.equal(body.count, 260);
  assert.equal(body.candles.at(-1).close, 22005, 'Fresh intraday candle wins cached overlap');
  assert.equal(body.warmup.ready, true);
  assert.equal(body.currentSessionCount, 125);
});

test('warm-up authorization failure preserves real bars and exposes only a safe reason', async t => {
  const f = await fixture(t, url => url.includes('/intraday/') ? ok(friday)
    : new Response(JSON.stringify({ secret: 'credential-must-not-appear' }), { status: 403 }));
  const body = await f.request();
  assert.equal(body.count, 125);
  assert.equal(body.warmup.ready, false);
  assert.equal(body.warmup.status, 'UNAVAILABLE');
  assert.match(body.warmup.reason, /authorization failed \(HTTP 403\)/);
  assert.ok(!JSON.stringify(body).includes('credential-must-not-appear'));
  assert.equal(f.calls.length, 2);
});

test('warm-up 429 preserves session bars without retrying any other historical dates', async t => {
  const f = await fixture(t, url => url.includes('/intraday/') ? ok(friday)
    : new Response('{}', { status: 429, headers: { 'retry-after': '15' } }));
  const first = await f.request();
  assert.equal(first.live, true);
  assert.equal(first.warmup.status, 'RATE_LIMITED');
  assert.equal(first.warmupRetryAfterMs, 15000);
  assert.equal(first.count, 125);
  const next = await f.request();
  assert.equal(next.warmup.ready, false);
  assert.equal(f.calls.length, 2, 'Cached intraday and active range deadline prevent new requests');
});

test('empty warm-up payload reports insufficient history, not an actionable setup', async t => {
  const f = await fixture(t, url => url.includes('/intraday/') ? ok(friday) : ok([]));
  const body = await f.request();
  assert.equal(body.warmup.status, 'INSUFFICIENT_HISTORY');
  assert.equal(body.warmup.requiredClosedCandles, 220);
  assert.match(body.warmup.reason, /125\/220 distinct closed candles/);
});

test('diagnostics count only completed regular-session candles', async t => {
  const invalid = ['09:12:00', '15:30:00', '16:00:00'].map(time =>
    ['2026-10-09T' + time + '+05:30', 22000, 22010, 21990, 22000, 0]);
  const f = await fixture(t, () => ok([...friday, ...invalid]), '2026-10-09T15:28:00+05:30');
  const body = await f.request();
  assert.equal(body.count, 125);
  assert.equal(body.warmup.closedCandles, 124, 'The 15:27 forming candle is not a closed confirmation');
  assert.equal(body.warmup.ready, false);
});

test('client keeps warm-up diagnostics separate by timeframe and clears them on a failed refresh', async () => {
  let failure = false;
  const context = vm.createContext({
    Response, Date, console, AbortController, isNseIntradayTime: () => true,
    fetch: async url => failure ? new Response('{}', { status: 403 }) : new Response(JSON.stringify({
      live: true, candles: [{ time: 1791517500, open: 22000, high: 22010, low: 21990, close: 22000 }],
      warmup: { closedCandles: url.includes('3m') ? 125 : 75, requiredClosedCandles: 220,
        ready: false, reason: 'Historical warm-up request failed.' }
    })),
  });
  vm.runInContext(marketSource.replace(/^import .*;\r?\n/, '')
    .replace(/\bexport (?=(?:async )?function|class|const)/g, '') +
    '\nthis.Adapter = UpstoxMarketAdapter;', context);
  const adapter = new context.Adapter();
  await adapter.history('NIFTY', '3m');
  await adapter.history('NIFTY', '5m');
  assert.equal(adapter.historyWarmup.get('NIFTY:3m').closedCandles, 125);
  assert.equal(adapter.historyWarmup.get('NIFTY:5m').closedCandles, 75);
  failure = true;
  await assert.rejects(adapter.history('NIFTY', '3m'));
  assert.equal(adapter.historyWarmup.has('NIFTY:3m'), false);
  assert.equal(adapter.historyWarmup.get('NIFTY:5m').closedCandles, 75);
});

test('AI warm-up explanation is text-only, retains closed-session WAIT, and is absent in Replay', () => {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function renderAiIndicator()');
  const end = source.indexOf('    function renderAiNifty()', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  const state = { symbol: 'NIFTY', tf: '3m', replay: { active: false }, aiIndicator: {
    signal: 'AI WAIT', side: 0, score: 0, regime: 'MARKET CLOSED',
    reasons: ['NSE regular session is closed; no live AI trade signal']
  } };
  const context = vm.createContext({
    state, Date,
    $: selector => {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', className: '' });
      return nodes.get(selector);
    },
    market: { historyWarmup: new Map([['NIFTY:3m', {
      ready: false, closedCandles: 125, requiredClosedCandles: 220,
      reason: 'Historical warm-up authorization failed (HTTP 403).'
    }]]) }
  });
  vm.runInContext(source.slice(start, end) + '\nrenderAiIndicator();', context);
  assert.match(nodes.get('#ai-indicator-reasons').textContent, /125\/220.*HTTP 403/);
  assert.equal(nodes.get('#ai-indicator-signal').textContent, 'AI WAIT');
  assert.equal(nodes.get('#ai-indicator-status').textContent, 'Market closed · no live signal');
  state.replay.active = true;
  vm.runInContext('renderAiIndicator();', context);
  assert.ok(!nodes.get('#ai-indicator-reasons').textContent.includes('History warm-up'));
});

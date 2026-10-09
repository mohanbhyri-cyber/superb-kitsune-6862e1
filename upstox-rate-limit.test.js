import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const workerSource = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const marketSource = readFileSync(new URL('./market.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const now = Date.parse('2026-10-09T04:00:00Z');
const quote = key => 'https://api.upstox.com/v3/market-quote/quotes?instrument_key=' + key;
const intraday = (key = 'NIFTY', tf = 3) =>
  'https://api.upstox.com/v3/historical-candle/intraday/' + key + '/minutes/' + tf;
const range = (key = 'NIFTY', tf = 3, from = '2026-10-02') =>
  'https://api.upstox.com/v3/historical-candle/' + key + '/minutes/' + tf +
  '/2026-10-09/' + from;
const ok = body => new Response(JSON.stringify(body), { status: 200 });
const limited = retry => new Response(JSON.stringify({ rateLimited: true }), {
  status: 429, headers: retry === undefined ? {} : { 'retry-after': String(retry) }
});

function workerFixture(fetcher) {
  let clock = now;
  const calls = [];
  const start = workerSource.indexOf('// Limits are per API and user');
  const end = workerSource.indexOf('// LIVE QUOTE', start);
  assert.ok(start >= 0 && end > start, 'Use actual Worker request/cache implementation');
  const context = vm.createContext({
    URL, Response, Date: { now: () => clock, parse: Date.parse },
    console: { error() {} },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher(url, options, calls.length);
    }
  });
  vm.runInContext(workerSource.slice(start, end) +
    '\nthis.api = { upstoxFetch, upstoxCacheTtl, upstoxRateLimitKey };', context);
  return { ...context.api, calls, advance: ms => { clock += ms; } };
}

test('quote 429 respects Retry-After but does not stop intraday or options APIs', async () => {
  const f = workerFixture(url => url.includes('/market-quote/')
    ? limited(254) : ok({ data: { candles: [] } }));
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.status === 429 && error.retryAfterMs === 254000);
  await f.upstoxFetch(intraday(), 'fixture-a');
  await f.upstoxFetch('https://api.upstox.com/v2/option/chain?instrument_key=NIFTY', 'fixture-a');
  await assert.rejects(f.upstoxFetch(quote('BANKNIFTY'), 'fixture-a'),
    error => error.status === 429 && error.retryAfterMs === 254000);
  assert.equal(f.calls.length, 3, 'Other quote instruments share the blocked API');
  f.advance(253000);
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.retryAfterMs === 1000);
  assert.equal(f.calls.length, 3, 'No early upstream retry');
  f.advance(1000);
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'));
  assert.equal(f.calls.length, 4, 'Retry only after the full deadline');
});

test('history cooldown covers timeframe/date/instrument variants, not quotes or intraday', async () => {
  const f = workerFixture(url => url.includes('/historical-candle/') &&
    !url.includes('/intraday/') ? limited(120) : ok({ data: {} }));
  await assert.rejects(f.upstoxFetch(range(), 'fixture-a'));
  await assert.rejects(f.upstoxFetch(range('BANKNIFTY', 15, '2026-10-08'), 'fixture-a'));
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  await f.upstoxFetch(intraday(), 'fixture-a');
  assert.equal(f.calls.length, 3);
});

test('intraday cooldown covers all timeframes and credentials remain isolated', async () => {
  const f = workerFixture((url, options) =>
    options.headers.Authorization === 'Bearer fixture-a' ? limited(60) : ok({ data: {} }));
  await assert.rejects(f.upstoxFetch(intraday(), 'fixture-a'));
  await assert.rejects(f.upstoxFetch(intraday('BANKNIFTY', 15), 'fixture-a'));
  await f.upstoxFetch(intraday(), 'fixture-b');
  assert.equal(f.calls.length, 2);
});

test('missing or invalid Retry-After uses safe floor; HTTP-date header is honored', async () => {
  for (const retry of [undefined, '', ' ', 'invalid', '0', '-1', 'Infinity',
    new Date(now - 1000).toUTCString()]) {
    const f = workerFixture(() => limited(retry));
    await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
      error => error.status === 429 && error.retryAfterMs === 60000);
  }
  const f = workerFixture(() => limited(new Date(now + 300000).toUTCString()));
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.retryAfterMs === 300000);
});

test('short provider Retry-After durations are honored without a fallback minute', async () => {
  for (const seconds of [1, 10, 15, 59]) {
    const f = workerFixture((_url, _options, call) => call === 1
      ? limited(seconds) : ok({ data: { price: 22000 } }));
    await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
      error => error.retryAfterMs === seconds * 1000);
    f.advance(seconds * 1000 - 1);
    await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
      error => error.status === 429);
    assert.equal(f.calls.length, 1, 'No early request');
    f.advance(1);
    await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
    assert.equal(f.calls.length, 2, 'Retry at the provider deadline');
  }
});

test('short HTTP-date deadline is not extended to a minute', async () => {
  const f = workerFixture((_url, _options, call) => call === 1
    ? limited(new Date(now + 20000).toUTCString()) : ok({ data: {} }));
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.retryAfterMs === 20000);
  f.advance(19999);
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'));
  assert.equal(f.calls.length, 1);
  f.advance(1);
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  assert.equal(f.calls.length, 2);
});

test('concurrent 429s cannot shorten an existing API cooldown', async () => {
  let complete;
  const f = workerFixture(url => url === quote('SLOW')
    ? new Promise(resolve => { complete = resolve; }) : limited(300));
  const slow = f.upstoxFetch(quote('SLOW'), 'fixture-a');
  const slowCheck = assert.rejects(slow);
  await assert.rejects(f.upstoxFetch(quote('FAST'), 'fixture-a'));
  complete(limited(60));
  await slowCheck;
  await assert.rejects(f.upstoxFetch(quote('OTHER'), 'fixture-a'),
    error => error.retryAfterMs === 300000);
  assert.equal(f.calls.length, 2);
});

test('identical concurrent requests share one upstream call and return independent copies', async () => {
  let complete;
  const f = workerFixture(() => new Promise(resolve => { complete = resolve; }));
  const first = f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  const second = f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  complete(ok({ data: { price: 22000 } }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  a.data.price = 1;
  assert.equal(b.data.price, 22000);
  assert.equal((await f.upstoxFetch(quote('NIFTY'), 'fixture-a')).data.price, 22000);
});

test('warm-up range reuse does not extend quote/current intraday freshness', async () => {
  const f = workerFixture(() => ok({ data: {} }));
  assert.equal(f.upstoxCacheTtl(range()), 300000);
  assert.equal(f.upstoxCacheTtl(range('NIFTY', 3, '2026-10-09')), 30000);
  assert.equal(f.upstoxCacheTtl(intraday()), 30000);
  assert.equal(f.upstoxCacheTtl(quote('NIFTY')), 15000);
  await f.upstoxFetch(range(), 'fixture-a');
  await f.upstoxFetch(intraday(), 'fixture-a');
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  f.advance(30001);
  await f.upstoxFetch(range(), 'fixture-a');
  await f.upstoxFetch(intraday(), 'fixture-a');
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  assert.equal(f.calls.length, 5, 'Warm-up reused; quote and intraday refetched');
  f.advance(270000);
  await f.upstoxFetch(range(), 'fixture-a');
  assert.equal(f.calls.length, 6);
});

test('expired cached quote is not served during cooldown and no fallback is fabricated', async () => {
  const f = workerFixture((_url, _options, call) =>
    call === 1 ? ok({ data: { price: 22000 } }) : limited(120));
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  f.advance(15001);
  await assert.rejects(f.upstoxFetch(quote('BANKNIFTY'), 'fixture-a'));
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.status === 429);
  assert.equal(f.calls.length, 2);
});

test('non-429 errors do not start unrelated or same-API cooldowns', async () => {
  const f = workerFixture((_url, _options, call) => call === 1
    ? new Response('{}', { status: 401 }) : ok({ data: {} }));
  await assert.rejects(f.upstoxFetch(quote('NIFTY'), 'fixture-a'),
    error => error.status === 401 && !error.rateLimited);
  await f.upstoxFetch(quote('NIFTY'), 'fixture-a');
  assert.equal(f.calls.length, 2);
});

function marketFixture(fetcher) {
  let clock = now;
  let nextTimer = 0;
  const timers = new Map();
  const listeners = new Map();
  const calls = [];
  const document = {
    hidden: false,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const context = vm.createContext({
    URL, Response, AbortController, document, console,
    Date: { now: () => clock, parse: Date.parse },
    isNseIntradayTime: () => true,
    setTimeout: (callback, ms) => {
      const id = ++nextTimer;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { calls.push(url); return fetcher(url, options); }
  });
  const source = marketSource
    .replace(/^import .*;\r?\n/, '')
    .replace(/\bexport (?=(?:async )?function|class|const)/g, '');
  vm.runInContext(source +
    '\nthis.api = { upstoxRequest, upstoxCooldownRemaining, noteUpstoxRateLimit, UpstoxMarketAdapter };', context);
  return { ...context.api, calls, context, document, timers, listeners,
    advance: ms => { clock += ms; } };
}

test('client short remaining deadlines do not restart endpoint fallback waits', async () => {
  for (const scope of ['quote', 'history', 'mtfHistory', 'previousHistory', 'auth', 'default']) {
    const f = marketFixture(() => new Response(JSON.stringify({ retryAfterMs: 1000 }), { status: 429 }));
    await assert.rejects(f.upstoxRequest('/api/fixture', {}, scope),
      error => error.retryAfterMs === 1000);
    f.advance(999);
    await assert.rejects(f.upstoxRequest('/api/fixture', {}, scope));
    assert.equal(f.calls.length, 1);
    f.advance(1);
    await assert.rejects(f.upstoxRequest('/api/fixture', {}, scope));
    assert.equal(f.calls.length, 2, 'No unnecessary scope floor');
  }
});

test('client missing or invalid durations retain conservative scope fallback', async () => {
  for (const [scope, floor] of [['quote', 15000], ['history', 30000], ['auth', 120000]]) {
    for (const value of [undefined, null, '', 'invalid', -1, 0, Infinity]) {
      const f = marketFixture(() => ok({}));
      assert.equal(f.noteUpstoxRateLimit(value, scope), floor);
      assert.equal(f.upstoxCooldownRemaining(scope), floor);
    }
  }
});

test('client chooses the longest body/header deadline and supports HTTP-date', async () => {
  for (const [body, header, expected] of [
    [{ retryAfterMs: 1000 }, '20', 20000],
    [{ retryAfterMs: 253527 }, '1', 253527],
    [{ retry_after_ms: 5000, retry_after: 10 }, '1', 10000],
    [{}, new Date(now + 10000).toUTCString(), 10000]
  ]) {
    const f = marketFixture(() => new Response(JSON.stringify(body), {
      status: 429, headers: { 'retry-after': header }
    }));
    await assert.rejects(f.upstoxRequest('/api/fixture', {}, 'quote'),
      error => error.retryAfterMs === expected);
    assert.equal(f.upstoxCooldownRemaining('quote'), expected);
  }
});

test('client short deadlines cannot shorten an already active long cooldown', () => {
  const f = marketFixture(() => ok({}));
  f.noteUpstoxRateLimit(253527, 'quote');
  f.advance(10000);
  assert.equal(f.noteUpstoxRateLimit(1000, 'quote'), 243527);
  assert.equal(f.upstoxCooldownRemaining('quote'), 243527);
  assert.equal(f.upstoxCooldownRemaining('history'), 0);
});

test('short quote retry resumes at the deadline without fabricated ticks', async () => {
  let attempts = 0;
  const f = marketFixture(() => ++attempts === 1
    ? new Response(JSON.stringify({ retryAfterMs: 5000 }), { status: 429 })
    : ok({ live: true, price: 22000, time: now / 1000, candleEligible: true }));
  const ticks = [];
  const adapter = new f.UpstoxMarketAdapter();
  const stop = adapter.subscribe('NIFTY', '3m', tick => ticks.push(tick), () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ticks.length, 0);
  const [timerId, timer] = [...f.timers][0];
  assert.equal(timer.ms, 5000);
  f.advance(4999);
  await assert.rejects(f.upstoxRequest('/api/live-quote', {}, 'quote'));
  assert.equal(f.calls.length, 1);
  f.advance(1);
  f.timers.delete(timerId);
  await timer.callback();
  assert.equal(f.calls.length, 2);
  assert.equal(ticks.length, 1);
  assert.equal(adapter.status, 'LIVE');
  stop();
  assert.equal(f.timers.size, 0);
});

test('client honors body Retry-After, suppresses repeated context calls and keeps quotes independent', async () => {
  const f = marketFixture(url => url.includes('options')
    ? new Response(JSON.stringify({ retryAfterMs: 253527 }), { status: 429 })
    : ok({ live: true, price: 22000 }));
  const start = appSource.indexOf('    async function upstoxAwareFetch(');
  const end = appSource.indexOf('    function isUpstoxRateLimit(', start);
  assert.ok(start >= 0 && end > start);
  f.context.window = { location: { origin: 'https://example.test' } };
  f.context.upstoxRequest = f.upstoxRequest;
  const request = vm.runInContext('(' + appSource.slice(start, end).trim() + ')', f.context);
  await assert.rejects(request('/api/nifty-options'),
    error => error.status === 429 && error.retryAfterMs === 253527);
  f.advance(10000);
  await assert.rejects(request('/api/nifty-options'),
    error => error.retryAfterMs === 243527);
  assert.equal(f.calls.length, 1);
  await f.upstoxRequest('/api/live-quote', {}, 'quote');
  assert.equal(f.calls.length, 2);
  assert.equal(f.upstoxCooldownRemaining('quote'), 0);
});

test('quote subscription schedules full cooldown, does not emit fake ticks and resumes after deadline', async () => {
  let attempts = 0;
  const f = marketFixture(() => ++attempts === 1
    ? new Response(JSON.stringify({ retryAfterMs: 253527 }), { status: 429 })
    : ok({ live: true, price: 22000, time: now / 1000, candleEligible: true }));
  const ticks = [];
  const errors = [];
  const adapter = new f.UpstoxMarketAdapter();
  const stop = adapter.subscribe('NIFTY', '3m', tick => ticks.push(tick), error => errors.push(error));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(adapter.status, 'RATE LIMITED');
  assert.equal(errors.length, 1);
  assert.equal(ticks.length, 0);
  assert.equal(f.calls.length, 1);
  const [timerId, timer] = [...f.timers][0];
  assert.equal(timer.ms, 253527);
  f.advance(timer.ms);
  f.timers.delete(timerId);
  await timer.callback();
  assert.equal(f.calls.length, 2);
  assert.equal(ticks.length, 1);
  assert.equal(adapter.status, 'LIVE');
  stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('periodic history refresh skips cooldown, reconnect, hidden and in-flight states', async () => {
  const start = appSource.indexOf('    historyRefreshTimer = setInterval(');
  const end = appSource.indexOf('\n    setupAllIndicatorsChat();', start);
  assert.ok(start >= 0 && end > start, 'Use actual production refresh timer');
  let tick;
  let calls = 0;
  let remaining = 0;
  const context = vm.createContext({
    state: { replay: { active: false } },
    document: { hidden: false }, historyRefreshInFlight: false, reconnectTimer: null,
    isNseCashMarketOpen: () => true,
    upstoxCooldownRemaining: scope => { assert.equal(scope, 'history'); return remaining; },
    setInterval: (callback, ms) => { assert.equal(ms, 30000); tick = callback; return 1; },
    refreshCandleHistory: async () => { calls++; }, console
  });
  vm.runInContext(appSource.slice(start, end), context);
  remaining = 60000; tick(); assert.equal(calls, 0);
  remaining = 0; context.reconnectTimer = 1; tick(); assert.equal(calls, 0);
  context.reconnectTimer = null; context.document.hidden = true; tick(); assert.equal(calls, 0);
  context.document.hidden = false; context.historyRefreshInFlight = true; tick(); assert.equal(calls, 0);
  context.historyRefreshInFlight = false; tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(context.historyRefreshInFlight, false);
});

let fullWorkerFixtureId = 0;

test('actual Worker reuses warm-up data while fresh intraday candles override cached overlaps', async t => {
  let clock = now;
  let intradayCalls = 0;
  let warmupCalls = 0;
  t.mock.method(Date, 'now', () => clock);
  const candle = close => ['2026-10-09T09:15:00+05:30', close, close + 10, close - 10, close, 0];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/historical-candle/intraday/')) {
      intradayCalls++;
      return ok({ data: { candles: [candle(22000 + intradayCalls)] } });
    }
    if (url.includes('/historical-candle/')) {
      warmupCalls++;
      return ok({ data: { candles: [candle(21900)] } });
    }
    throw new Error('Unexpected upstream request: ' + url);
  });
  const workerURL = new URL('./worker.js', import.meta.url);
  const parserStub = 'data:text/javascript,' + encodeURIComponent(
    'export function parse() { throw new Error("Unexpected breadth request"); }');
  const source = workerSource
    .replace(/from '(\.\/[^']+)'/g, (_, path) =>
      "from '" + new URL(path, workerURL).href + "'")
    .replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
    '\n// rate-limit full fixture ' + ++fullWorkerFixtureId;
  const worker = (await import('data:text/javascript;base64,' +
    Buffer.from(source).toString('base64'))).default;
  const request = () => worker.fetch(new Request(
    'https://example.test/api/upstox-history?symbol=NIFTY&timeframe=3m'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' });
  const first = await (await request()).json();
  assert.equal(first.live, true);
  assert.equal(first.candles.at(-1).close, 22001);
  clock += 31000;
  const next = await (await request()).json();
  assert.equal(next.live, true);
  assert.equal(next.candles.at(-1).close, 22002);
  assert.equal(next.candles.at(-1).time, Date.parse('2026-10-09T09:15:00+05:30') / 1000);
  assert.equal(intradayCalls, 2);
  assert.equal(warmupCalls, 1, 'Older warm-up reused without overwriting the current session');
});

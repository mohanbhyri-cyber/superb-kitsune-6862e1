import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseSmrtAiIndicator as analyse } from './smrt-ai-indicator.js';

const workerURL = new URL('./worker.js', import.meta.url);
const workerSource = readFileSync(workerURL, 'utf8');
const initialClock = Date.parse('2026-10-09T04:00:00Z'); // 09:30 IST.
const env = { UPSTOX_EXTENDED_TOKEN: 'fixture-token' };
const historyURL = 'https://example.test/api/upstox-history?symbol=NIFTY&timeframe=3m';
const quoteURL = 'https://example.test/api/live-quote?symbol=NIFTY';
const ok = body => new Response(JSON.stringify(body), { status: 200 });
const limited = seconds => new Response('{}', {
  status: 429, headers: { 'retry-after': String(seconds) }
});
const row = (clock, close = 22000) =>
  ['2026-10-09T' + clock + '+05:30', close, close + 10, close - 10, close, 0];
const quoteBody = (clock, price = 22000) => ({
  data: { nifty: { last_price: price, last_trade_time: String(clock),
    timestamp: clock, net_change: 0, prev_close_price: price } }
});
let fixtureId = 0;

async function freshWorker() {
  // Run the real Worker with only module-resolution URLs changed.
  // Optional CSV breadth parser must never be reached by these fixtures.
  const parserStub = 'data:text/javascript,' + encodeURIComponent(
    'export function parse() { throw new Error("Unexpected breadth route"); }');
  const source = workerSource
    .replace(/from '(\.\/[^']+)'/g, (_, path) =>
      "from '" + new URL(path, workerURL).href + "'")
    .replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
    '\n// resilience fixture ' + ++fixtureId;
  return (await import('data:text/javascript;base64,' +
    Buffer.from(source).toString('base64'))).default;
}

function installCache(t, getClock, enabled = true) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const entries = new Map();
  const writes = [];
  const cache = {
    async match(request) {
      const entry = entries.get(request.url);
      return entry && entry.until > getClock() ? entry.response.clone() : undefined;
    },
    async put(request, response) {
      const seconds = Number(response.headers.get('cache-control').match(/s-maxage=(\d+)/)[1]);
      writes.push({ url: request.url, seconds });
      entries.set(request.url, { response: response.clone(),
        until: getClock() + seconds * 1000 });
    }
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true,
    value: enabled ? { default: cache } : undefined });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'caches', prior);
    else delete globalThis.caches;
  });
  return { entries, writes };
}

async function request(worker, url, withContext = false) {
  const pending = [];
  const context = withContext ? { waitUntil: promise => pending.push(promise) } : undefined;
  const response = await worker.fetch(new Request(url), env, context);
  await Promise.all(pending);
  return { response, body: await response.json() };
}

test('historical warm-up 429 preserves real 3m bars, filters after-hours, and leaves AI WAIT', async t => {
  let clock = initialClock;
  let intradayCalls = 0;
  let warmupCalls = 0;
  t.mock.method(Date, 'now', () => clock);
  installCache(t, () => clock, false);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/historical-candle/intraday/')) {
      intradayCalls++;
      return ok({ data: { candles: [
        row('09:12:00'), row('09:15:00'), row('09:18:00', 22000 + intradayCalls),
        row('15:30:00'), row('16:00:00')
      ] } });
    }
    if (url.includes('/historical-candle/')) { warmupCalls++; return limited(254); }
    throw new Error('Unexpected upstream API');
  });
  const worker = await freshWorker();
  const first = await request(worker, historyURL);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.live, true);
  assert.equal(first.body.warmupRateLimited, true);
  assert.equal(first.body.warmupRetryAfterMs, 254000);
  assert.deepEqual(first.body.candles.map(c => c.time), [
    Date.parse('2026-10-09T09:15:00+05:30') / 1000,
    Date.parse('2026-10-09T09:18:00+05:30') / 1000
  ]);
  const ai = analyse({ candles: first.body.candles, seconds: 180, now: clock / 1000 });
  assert.equal(ai.signal, 'AI WAIT');
  assert.equal(ai.regime, 'WARMING UP');
  assert.equal(ai.score, 0);
  assert.equal(ai.confluenceScore, 0);

  clock += 31000;
  const next = await request(worker, historyURL);
  assert.equal(next.body.candles.at(-1).close, 22002);
  assert.equal(next.body.warmupRetryAfterMs, 223000);
  assert.equal(intradayCalls, 2);
  assert.equal(warmupCalls, 1, 'No early retry of the blocked historical API');
  clock += 222999;
  await request(worker, historyURL);
  assert.equal(warmupCalls, 1);
  clock += 1;
  await request(worker, historyURL);
  assert.equal(warmupCalls, 2, 'Historical retry resumes at the full provider deadline');
});

test('primary intraday 429 still stops fallbacks, returns no candles, and honors full cooldown', async t => {
  let clock = initialClock;
  let calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const cache = installCache(t, () => clock);
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.includes('/historical-candle/intraday/'));
    calls++;
    return limited(120);
  });
  const worker = await freshWorker();
  const first = await request(worker, historyURL);
  assert.equal(first.response.status, 429);
  assert.equal(first.body.live, false);
  assert.deepEqual(first.body.candles, []);
  assert.equal(first.body.retryAfterMs, 120000);
  clock += 119999;
  const next = await request(worker, historyURL);
  assert.equal(next.response.status, 429);
  assert.equal(calls, 1, 'No historical/date/timeframe fallback after primary 429');
  assert.equal(cache.writes.length, 0);
  clock += 1;
  await request(worker, historyURL);
  assert.equal(calls, 2);
});

test('successful quotes share a 5s edge cache across Worker instances without retimestamping', async t => {
  let clock = initialClock;
  let calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const cache = installCache(t, () => clock);
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.includes('/market-quote/quotes'));
    calls++;
    return ok(quoteBody(clock, 22000 + calls));
  });
  const first = await request(await freshWorker(), quoteURL, true);
  clock += 4999;
  const second = await request(await freshWorker(), quoteURL);
  assert.equal(calls, 1);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.body.time, initialClock / 1000);
  assert.equal(second.body.candleEligible, true);
  assert.equal(cache.writes[0].seconds, 5);
  assert.match(first.response.headers.get('cache-control'), /max-age=0, s-maxage=5/);
  assert.equal(first.response.headers.has('authorization'), false);
  assert.equal(JSON.stringify(second.body).includes(env.UPSTOX_EXTENDED_TOKEN), false);
  clock += 1;
  const renewed = await request(await freshWorker(), quoteURL);
  assert.equal(calls, 2);
  assert.equal(renewed.body.price, 22002);
  assert.equal(renewed.body.time, clock / 1000);
});

test('edge expiry followed by provider 429 never resurrects the expired quote', async t => {
  let clock = initialClock;
  let calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const cache = installCache(t, () => clock);
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? ok(quoteBody(clock)) : limited(120));
  const worker = await freshWorker();
  await request(worker, quoteURL);
  clock += 20001; // Past both the 15s upstream and 5s edge TTLs.
  const result = await request(worker, quoteURL);
  assert.equal(result.response.status, 429);
  assert.equal(result.body.live, false);
  assert.equal(result.body.price, undefined);
  assert.equal(result.body.retryAfterMs, 120000);
  assert.equal(cache.writes.length, 1);
  await request(worker, quoteURL);
  assert.equal(calls, 2, 'No fallback or early retry after quote 429');
});

test('unsuccessful 200 quote responses are not shared or cached as LIVE', async t => {
  let clock = initialClock;
  let calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const cache = installCache(t, () => clock);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; return ok({ data: { nifty: { last_price: 'invalid' } } });
  });
  const first = await request(await freshWorker(), quoteURL);
  const second = await request(await freshWorker(), quoteURL);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.live, false);
  assert.equal(second.body.live, false);
  assert.equal(calls, 2);
  assert.equal(cache.writes.length, 0);
});

test('edge cache does not invent candle timestamps or after-hours eligibility', async t => {
  let clock = Date.parse('2026-10-09T16:00:00+05:30');
  t.mock.method(Date, 'now', () => clock);
  installCache(t, () => clock);
  t.mock.method(globalThis, 'fetch', async () =>
    ok({ data: { nifty: { last_price: 22000 } } }));
  const first = await request(await freshWorker(), quoteURL);
  const second = await request(await freshWorker(), quoteURL);
  assert.equal(first.body.time, null);
  assert.equal(first.body.timeSource, 'UNAVAILABLE');
  assert.equal(second.body.candleEligible, false);
  assert.deepEqual(second.body, first.body);
});

test('unavailable edge cache remains an optional optimization, not a feed dependency', async t => {
  t.mock.method(Date, 'now', () => initialClock);
  const cache = installCache(t, () => initialClock);
  t.mock.method(globalThis.caches.default, 'match', async () => { throw new Error('Unavailable'); });
  t.mock.method(globalThis.caches.default, 'put', async () => { throw new Error('Unavailable'); });
  t.mock.method(globalThis, 'fetch', async () => ok(quoteBody(initialClock)));
  const result = await request(await freshWorker(), quoteURL);
  assert.equal(result.body.live, true);
  assert.equal(result.body.time, initialClock / 1000);
  assert.equal(cache.writes.length, 0);
});

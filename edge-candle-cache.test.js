import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { nseCandleBucket, nseSessionBounds } from './nse-candle-time.js';
import { regularNseHours } from './options-context.js';

const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const epoch = time => Date.parse('2026-10-13T' + time + '+05:30');
const ok = body => new Response(JSON.stringify(body), { status: 200 });
const candleRequest = (route = 'upstox-history', tf = '3m') => new Request(
  'https://example.test/api/' + route + '?symbol=NIFTY&timeframe=' + tf);

test('the main history route edge TTL permits a 30s missing-candle retry', async () => {
  const normalized = source.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('    if (\n      url.pathname === "/api/upstox-history"');
  const end = normalized.indexOf('    if (', start + 8);
  assert.ok(start >= 0 && end > start);
  let ttl;
  await vm.runInNewContext('(async () => {\n' + normalized.slice(start, end) + '\n})()', {
    url: new URL('https://example.test/api/upstox-history'),
    request: candleRequest(), token: 'test-only', coordinator: null, context: {},
    cachedApiResponse: async (_request, seconds) => { ttl = seconds; }
  });
  assert.equal(ttl, 30, 'A 60s edge cache would serve the same incomplete response on the faster retry');
});

function edgeFixture(time = '09:17:59', shared = new Map()) {
  let clock = epoch(time);
  const writes = [];
  const cache = {
    async match(request) {
      const hit = shared.get(request.url);
      return hit && hit.until > clock ? hit.response.clone() : undefined;
    },
    async put(request, response) {
      const seconds = Number(response.headers.get('cache-control')
        .match(/s-maxage=(\d+)/)[1]);
      writes.push({ url: request.url, seconds });
      shared.set(request.url, { response: response.clone(), until: clock + seconds * 1000 });
    }
  };
  const start = source.indexOf('function candleApiCacheWindow(');
  const end = source.indexOf('function getISTParts(', start);
  assert.ok(start >= 0 && end > start, 'Test the production edge cache implementation');
  const context = vm.createContext({
    URL, Request, Response, Headers, Date: { now: () => clock },
    nseCandleBucket, nseSessionBounds, caches: { default: cache },
    console: { warn() {} }
  });
  vm.runInContext(source.match(/const TIMEFRAMES = \{[\s\S]*?\};/)[0] +
    source.slice(start, end) + '\nthis.api = { cachedApiResponse, candleApiCacheWindow };', context);
  return { ...context.api, cache, shared, writes,
    advance: ms => { clock += ms; }, clock: () => clock,
    setClock: value => { clock = value; } };
}

function upstreamFixture(time, fetcher) {
  let clock = epoch(time);
  let calls = 0;
  const start = source.indexOf('// Limits are per API and user');
  const end = source.indexOf('// LIVE QUOTE', start);
  const context = vm.createContext({
    URL, Response, Date: { now: () => clock, parse: Date.parse },
    nseCandleBucket, nseSessionBounds, regularNseHours,
    console: { error() {} }, fetch: (...args) => fetcher(++calls, ...args)
  });
  vm.runInContext(source.slice(start, end) + '\nthis.api = { upstoxFetch };', context);
  return { ...context.api, advance: ms => { clock += ms; }, calls: () => calls };
}

test('3m edge history expires at close and a different Worker cannot reuse the old epoch', async () => {
  const f = edgeFixture();
  let calls = 0;
  const load = () => ok({ snapshot: ++calls });
  const req = candleRequest();
  const first = await f.cachedApiResponse(req, 60, load);
  assert.equal((await first.json()).snapshot, 1);
  assert.equal(f.writes[0].seconds, 1);
  assert.notEqual(f.writes[0].url, req.url);
  f.advance(999);
  assert.equal((await (await f.cachedApiResponse(req, 60, load)).json()).snapshot, 1);
  const next = edgeFixture('09:18:00', f.shared);
  assert.equal((await (await next.cachedApiResponse(req, 60, load)).json()).snapshot, 2);
  assert.equal(calls, 2);
  assert.equal(next.writes[0].seconds, 60);
  assert.notEqual(next.writes[0].url, f.writes[0].url);
});

test('MTF 5m, 15m and 1h caches end at their own NSE-anchored boundary', async () => {
  for (const [tf, before, after] of [
    ['5m', '09:19:59', '09:20:00'],
    ['15m', '09:29:59', '09:30:00'],
    ['1h', '10:14:59', '10:15:00']
  ]) {
    const f = edgeFixture(before);
    let calls = 0;
    const req = candleRequest('upstox-mtf-history', tf);
    const load = () => ok({ snapshot: ++calls });
    await f.cachedApiResponse(req, 300, load);
    assert.equal(f.writes[0].seconds, 1, tf);
    const next = edgeFixture(after, f.shared);
    assert.equal((await (await next.cachedApiResponse(req, 300, load)).json()).snapshot, 2);
  }
});

test('all main intervals and futures VWAP use the matching candle boundary', () => {
  const f = edgeFixture('09:17:59');
  for (const [tf, end] of [['1m', '09:18:00'], ['3m', '09:18:00'],
    ['5m', '09:20:00'], ['15m', '09:30:00']]) {
    assert.equal(f.candleApiCacheWindow(candleRequest('upstox-history', tf), f.clock())
      .deadline, epoch(end));
    const req = new Request('https://example.test/api/nifty-futures-vwap?interval=' + parseInt(tf));
    assert.equal(f.candleApiCacheWindow(req, f.clock()).deadline, epoch(end));
  }
  assert.equal(f.candleApiCacheWindow(new Request('https://example.test/api/upstox-history'),
    f.clock()).deadline, epoch('09:18:00'));
});

test('partial final hour cache ends at 15:30, not 16:15', async () => {
  const f = edgeFixture('15:29:59');
  const req = candleRequest('upstox-mtf-history', '1h');
  const window = f.candleApiCacheWindow(req, f.clock());
  assert.equal(window.deadline, epoch('15:30:00'));
  await f.cachedApiResponse(req, 300, () => ok({ snapshot: 1 }));
  assert.equal(f.writes[0].seconds, 1);
  const after = edgeFixture('15:30:00', f.shared);
  assert.notEqual(after.candleApiCacheWindow(req, after.clock()).key.url, window.key.url);
});

test('pre-open and a new trading date cannot reuse the previous session edge response', async () => {
  const f = edgeFixture('09:14:59');
  const req = candleRequest();
  await f.cachedApiResponse(req, 60, () => ok({ snapshot: 1 }));
  assert.equal(f.writes[0].seconds, 1);
  f.advance(1000);
  assert.equal((await (await f.cachedApiResponse(req, 60, () => ok({ snapshot: 2 }))).json()).snapshot, 2);
  const priorKey = f.writes.at(-1).url;
  f.setClock(Date.parse('2026-10-14T09:15:00+05:30'));
  assert.notEqual(f.candleApiCacheWindow(req, f.clock()).key.url, priorKey);
});

test('identical concurrent cache misses share one loader and independent response bodies', async () => {
  const f = edgeFixture('09:16:00');
  let finish;
  let calls = 0;
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = f.cachedApiResponse(candleRequest(), 60, load);
  const second = f.cachedApiResponse(candleRequest(), 60, load);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  finish(ok({ snapshot: 1 }));
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(f.writes.length, 1);
});

test('a slow old-epoch edge response is not cached or shared with a post-close caller', async () => {
  const f = edgeFixture();
  let finish;
  const old = f.cachedApiResponse(candleRequest(), 60,
    () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  f.advance(2000);
  const fresh = await f.cachedApiResponse(candleRequest(), 60, () => ok({ snapshot: 2 }));
  finish(ok({ snapshot: 1 }));
  assert.equal((await fresh.json()).snapshot, 2);
  assert.equal((await (await old).json()).snapshot, 1);
  assert.equal(f.writes.length, 1, 'Only the fresh epoch may be cached');
  assert.equal((await (await f.cachedApiResponse(candleRequest(), 60,
    () => { throw new Error('Should reuse fresh cache'); })).json()).snapshot, 2);
});

test('fractional-second edge TTL never rounds up beyond candle close', async () => {
  const f = edgeFixture();
  f.advance(501);
  await f.cachedApiResponse(candleRequest(), 60, () => ok({ snapshot: 1 }));
  assert.equal(f.writes.length, 0);
});

test('a cache lookup completing after close cannot return its pre-close hit', async () => {
  const f = edgeFixture();
  f.cache.match = async () => {
    f.advance(2000);
    return ok({ snapshot: 1 });
  };
  const response = await f.cachedApiResponse(candleRequest(), 60, () => ok({ snapshot: 2 }));
  assert.equal((await response.json()).snapshot, 2);
  assert.equal(f.writes.length, 0, 'An old request epoch cannot fill the new epoch');
});

test('edge failures and loader rejection are not cached, and single-flight is released', async () => {
  const f = edgeFixture('09:16:00');
  const req = candleRequest();
  const blocked = await f.cachedApiResponse(req, 60, () => new Response('{}', { status: 429 }));
  assert.equal(blocked.status, 429);
  assert.equal(f.writes.length, 0);
  await assert.rejects(f.cachedApiResponse(req, 60, () => { throw new Error('Network failure'); }));
  assert.equal((await (await f.cachedApiResponse(req, 60, () => ok({ snapshot: 3 }))).json()).snapshot, 3);
});

test('cache write failures inside waitUntil do not reject a successful feed response', async () => {
  const f = edgeFixture('09:16:00');
  const tasks = [];
  f.cache.put = async () => { throw new Error('Cache unavailable'); };
  const response = await f.cachedApiResponse(candleRequest(), 60, () => ok({ snapshot: 1 }),
    { waitUntil: task => tasks.push(task) });
  assert.equal((await response.json()).snapshot, 1);
  await Promise.all(tasks);
});

test('quote, previous-session and unrelated caches keep their original keys and TTLs', async () => {
  const f = edgeFixture();
  for (const [route, ttl, body] of [
    ['live-quote', 5, { live: true, price: 22000, time: f.clock() / 1000 }],
    ['upstox-previous-history', 3600, { snapshot: 1 }],
    ['nifty-options', 60, { snapshot: 1 }]
  ]) {
    const req = new Request('https://example.test/api/' + route);
    assert.equal(f.candleApiCacheWindow(req, f.clock()), null);
    await f.cachedApiResponse(req, ttl, () => ok(body));
    assert.equal(f.writes.at(-1).url, req.url);
    assert.equal(f.writes.at(-1).seconds, ttl);
  }
});

test('unsupported intervals do not create an invented candle epoch', () => {
  const f = edgeFixture();
  assert.equal(f.candleApiCacheWindow(candleRequest('upstox-history', 'invalid'), f.clock()), null);
  assert.equal(f.candleApiCacheWindow(candleRequest('upstox-mtf-history', '3m'), f.clock()), null);
  assert.equal(f.candleApiCacheWindow(new Request('https://example.test/api/nifty-futures-vwap?interval=2'),
    f.clock()), null);
});

test('a post-close upstream caller waits for an old flight, then shares one fresh fetch', async () => {
  let finish;
  const f = upstreamFixture('09:17:59', call => call === 1
    ? new Promise(resolve => { finish = resolve; }) : ok({ snapshot: call }));
  const endpoint = 'https://api.upstox.com/v3/historical-candle/intraday/NIFTY/minutes/3';
  const first = f.upstoxFetch(endpoint, 'fixture-token');
  f.advance(2000);
  const second = f.upstoxFetch(endpoint, 'fixture-token');
  const third = f.upstoxFetch(endpoint, 'fixture-token');
  assert.equal(f.calls(), 1, 'Do not overlap the old and new upstream requests');
  finish(ok({ snapshot: 1 }));
  assert.equal((await first).snapshot, 1);
  assert.equal((await second).snapshot, 2);
  assert.equal((await third).snapshot, 2);
  assert.equal(f.calls(), 2);
});

test('native hour upstream cache expires at NSE hour close and shortened final session candle', async () => {
  for (const before of ['10:14:59', '15:29:59']) {
    const f = upstreamFixture(before, call => ok({ snapshot: call }));
    const endpoint = 'https://api.upstox.com/v3/historical-candle/intraday/NIFTY/hours/1';
    assert.equal((await f.upstoxFetch(endpoint, 'fixture-token')).snapshot, 1);
    f.advance(1000);
    assert.equal((await f.upstoxFetch(endpoint, 'fixture-token')).snapshot, 2);
    assert.equal(f.calls(), 2);
  }
});

test('old in-flight 429 is honored after a candle close without a fresh bypass request', async () => {
  let finish;
  const f = upstreamFixture('09:17:59', () => new Promise(resolve => { finish = resolve; }));
  const endpoint = 'https://api.upstox.com/v3/historical-candle/intraday/NIFTY/minutes/3';
  const first = f.upstoxFetch(endpoint, 'fixture-token');
  f.advance(2000);
  const next = f.upstoxFetch(endpoint, 'fixture-token');
  const rejected = Promise.all([assert.rejects(first, error => error.status === 429),
    assert.rejects(next, error => error.status === 429)]);
  finish(new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));
  await rejected;
  await assert.rejects(f.upstoxFetch(endpoint, 'fixture-token'), error => error.retryAfterMs === 120000);
  assert.equal(f.calls(), 1);
});

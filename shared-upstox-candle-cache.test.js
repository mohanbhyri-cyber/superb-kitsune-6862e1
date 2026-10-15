import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { nseCandleBucket, nseSessionBounds } from './nse-candle-time.js';
import { regularNseHours } from './options-context.js';

const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const start = source.indexOf('// Limits are per API and user');
const end = source.indexOf('// LIVE QUOTE', start);
const intraday = (tf = 3) => 'https://api.upstox.com/v3/historical-candle/intraday/NIFTY/minutes/' + tf;
const range = unit => 'https://api.upstox.com/v3/historical-candle/NIFTY/' + unit + '/1/2026-10-09/2026-09-01';
const body = price => ({ status: 'success', data: { candles: [
  ['2026-10-09T09:15:00+05:30', price, price + 10, price - 10, price, 0] ] } });
const ok = value => new Response(JSON.stringify(value));
const limited = seconds => new Response('{}', { status: 429, headers: { 'retry-after': String(seconds) } });

function fixture(fetcher, options = {}) {
  let clock = Date.parse('2026-10-09T09:30:00+05:30');
  const entries = new Map(), writes = [], cooldownWrites = [], calls = [];
  const cache = {
    async match(request) {
      if (options.readFails) throw new Error('Optional cache read failed');
      const entry = entries.get(request.url);
      return entry && entry.until > clock ? entry.response.clone() : undefined;
    },
    async put(request, response) {
      if (options.writeFails) throw new Error('Optional cache write failed');
      const seconds = Number(response.headers.get('cache-control').match(/s-maxage=(\d+)/)[1]);
      const target = request.url.includes('/__smrt_upstox_cooldown/') ? cooldownWrites : writes;
      target.push({ url: request.url, response: response.clone(), seconds });
      entries.set(request.url, { response: response.clone(), until: clock + seconds * 1000 });
    }
  };
  const instance = () => {
    const context = vm.createContext({ URL, Request, Response, Headers, TextEncoder, Uint8Array,
      crypto: webcrypto, caches: options.disabled ? undefined : { default: cache },
      Date: { now: () => clock, parse: Date.parse }, nseCandleBucket, nseSessionBounds, regularNseHours,
      console: { error() {} }, fetch: async (url, request) => {
        calls.push({ url, request }); return fetcher(url, request, calls.length);
      } });
    vm.runInContext(source.slice(start, end) + '\nthis.get = upstoxFetch;', context);
    return context.get;
  };
  return { instance, calls, entries, writes, cooldownWrites, cache, now: () => clock,
    advance: ms => { clock += ms; } };
}

test('separate Worker instances share real intraday responses without retimestamping or credentials', async () => {
  const f = fixture((_url, _request, call) => ok(body(22000 + call)));
  const first = await f.instance()(intraday(), 'test-credential-A');
  const expected = structuredClone(first);
  first.data.candles[0][4] = 99999;
  const second = await f.instance()(intraday(), 'test-credential-A');
  assert.deepEqual(JSON.parse(JSON.stringify(second)), expected);
  assert.equal(f.calls.length, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].seconds, 30);
  assert.equal(f.writes[0].url.includes('test-credential'), false);
  assert.equal(f.writes[0].response.headers.has('authorization'), false);
  assert.equal((await f.writes[0].response.clone().text()).includes('test-credential'), false);
});

test('a shared hit cannot renew or extend the original 30-second candle expiry', async () => {
  const f = fixture((_url, _request, call) => ok(body(22000 + call)));
  await f.instance()(intraday(), 'credential');
  f.advance(25000);
  const second = f.instance();
  assert.equal((await second(intraday(), 'credential')).data.candles[0][4], 22001);
  f.advance(5000);
  assert.equal((await second(intraday(), 'credential')).data.candles[0][4], 22002);
  assert.equal(f.calls.length, 2);
});

test('shared intraday entries expire at 1/3/5/15/60-minute candle boundaries', async () => {
  for (const tf of [1, 3, 5, 15, 60]) {
    const f = fixture((_url, _request, call) => ok(body(22000 + call)));
    f.advance((tf === 60 ? 45 : tf) * 60000 - 2000);
    await f.instance()(intraday(tf), 'credential');
    f.advance(1999);
    assert.equal((await f.instance()(intraday(tf), 'credential')).data.candles[0][4], 22001);
    f.advance(1);
    assert.equal((await f.instance()(intraday(tf), 'credential')).data.candles[0][4], 22002);
    assert.equal(f.calls.length, 2, String(tf));
  }
});

test('late pre-boundary responses cannot fill the next candle shared cache', async () => {
  let resolve, started;
  const startedPromise = new Promise(r => { started = r; });
  const f = fixture((_url, _request, call) => call === 1
    ? new Promise(r => { resolve = r; started(); }) : ok(body(22000 + call)));
  f.advance(179000);
  const pending = f.instance()(intraday(), 'credential');
  await startedPromise;
  f.advance(2000); resolve(ok(body(22001))); await pending;
  assert.equal(f.writes.length, 0);
  assert.equal((await f.instance()(intraday(), 'credential')).data.candles[0][4], 22002);
});

test('accounts are isolated and quote/option responses do not enter the shared candle cache', async () => {
  const f = fixture((_url, _request, call) => ok(body(22000 + call)));
  await f.instance()(intraday(), 'credential-A');
  await f.instance()(intraday(), 'credential-B');
  assert.equal(f.calls.length, 2);
  assert.equal(f.entries.size, 2);
  const before = f.writes.length;
  for (const path of ['/v3/market-quote/quotes', '/v2/option/chain']) {
    await f.instance()('https://api.upstox.com' + path, 'credential-A');
    await f.instance()('https://api.upstox.com' + path, 'credential-A');
  }
  assert.equal(f.writes.length, before);
  assert.equal(f.calls.length, 6);
});

test('expired cached candles never hide HTTP 429 or shorten its required cooldown', async () => {
  const f = fixture((_url, _request, call) => call === 1 ? ok(body(22001)) : limited(120));
  const instance = f.instance(); await instance(intraday(), 'credential');
  f.advance(30000);
  await assert.rejects(instance(intraday(), 'credential'), error => error.retryAfterMs === 120000);
  f.advance(30000);
  await assert.rejects(instance(intraday(), 'credential'), error => error.retryAfterMs === 90000);
  assert.equal(f.calls.length, 2);
  assert.equal(f.writes.length, 1, 'Never store rate-limit failures');
});

test('missing/corrupt/failed shared cache remains optional and never supplies fabricated candles', async () => {
  for (const options of [{ disabled: true }, { readFails: true }, { writeFails: true }]) {
    const f = fixture(() => ok(body(22000)), options);
    assert.equal((await f.instance()(intraday(), 'credential')).data.candles[0][4], 22000);
  }
  for (const value of [{ status: 'error', data: { candles: body(22000).data.candles } },
    { data: { candles: [] } }, { data: { candles: [['bad', 1, 1, 1, 1, 0]] } }]) {
    const f = fixture(() => ok(value));
    await f.instance()(intraday(), 'credential');
    await f.instance()(intraday(), 'credential');
    assert.equal(f.calls.length, 2);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture((_url, _request, call) => ok(body(22000 + call)));
  await f.instance()(intraday(), 'credential');
  for (const entry of f.entries.values()) entry.response = new Response('not JSON', {
    headers: { 'x-smrt-candle-expires-at': '9999999999999' } });
  assert.equal((await f.instance()(intraday(), 'credential')).data.candles[0][4], 22002);
});

test('minute and hourly multi-day warm-up ranges use the same bounded five-minute reuse policy', async () => {
  for (const unit of ['minutes', 'hours']) {
    const f = fixture((_url, _request, call) => ok(body(22000 + call)));
    await f.instance()(range(unit), 'credential');
    assert.equal(f.writes[0].seconds, 300);
    f.advance(299999);
    assert.equal((await f.instance()(range(unit), 'credential')).data.candles[0][4], 22001);
    f.advance(1);
    assert.equal((await f.instance()(range(unit), 'credential')).data.candles[0][4], 22002);
  }
});

test('separate Workers honor one shared cooldown across instruments, timeframes and candle boundaries', async () => {
  const f = fixture((_url, _request, call) => call === 1 ? limited(254) : ok(body(22002)));
  await assert.rejects(f.instance()(intraday(), 'credential'), error => error.retryAfterMs === 254000);
  assert.equal(f.cooldownWrites.length, 1);
  assert.equal(f.writes.length, 0, 'A retry deadline is not market data');
  const write = f.cooldownWrites[0];
  assert.equal(write.url.includes('credential'), false);
  assert.equal(write.response.headers.has('authorization'), false);
  assert.equal(await write.response.clone().text(), '');
  f.advance(180000);
  await assert.rejects(f.instance()(intraday(15).replace('NIFTY', 'BANKNIFTY'), 'credential'),
    error => error.status === 429 && error.rateLimited && error.retryAfterMs === 74000);
  f.advance(73999);
  await assert.rejects(f.instance()(intraday(5), 'credential'));
  assert.equal(f.calls.length, 1, 'No second provider request before the original deadline');
  f.advance(1);
  assert.equal((await f.instance()(intraday(), 'credential')).data.candles[0][4], 22002);
  assert.equal(f.calls.length, 2);
});

test('shared cooldowns isolate credentials and quote/history/intraday APIs', async () => {
  const quote = key => 'https://api.upstox.com/v3/market-quote/quotes?instrument_key=' + key;
  const f = fixture((_url, _request, call) => call === 1 ? limited(120) : ok(body(22000)));
  await assert.rejects(f.instance()(quote('NIFTY'), 'credential-A'));
  await assert.rejects(f.instance()(quote('BANKNIFTY'), 'credential-A'),
    error => error.retryAfterMs === 120000);
  await f.instance()(quote('NIFTY'), 'credential-B');
  await f.instance()(intraday(), 'credential-A');
  await f.instance()(range('minutes'), 'credential-A');
  assert.equal(f.calls.length, 4);
});

test('shared cooldown reads do not renew the deadline or lose it when cache becomes unavailable', async () => {
  const options = {};
  const f = fixture((_url, _request, call) => call === 1 ? limited(120) : ok(body(22000)), options);
  await assert.rejects(f.instance()(intraday(), 'credential'));
  const second = f.instance();
  f.advance(10000);
  await assert.rejects(second(intraday(5), 'credential'), error => error.retryAfterMs === 110000);
  assert.equal(f.cooldownWrites.length, 1, 'A read must never restart Retry-After');
  options.readFails = true;
  f.advance(10000);
  await assert.rejects(second(intraday(15), 'credential'), error => error.retryAfterMs === 100000);
  assert.equal(f.calls.length, 1, 'Keep the locally learned deadline if coordination fails');
});

test('an already visible longer shared deadline cannot be shortened by a late shorter 429', async () => {
  let complete, started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture(url => url === intraday(5)
    ? new Promise(resolve => { complete = resolve; started(); }) : limited(300));
  const slow = f.instance()(intraday(5), 'credential');
  const slowCheck = assert.rejects(slow, error => error.retryAfterMs === 300000);
  await began;
  await assert.rejects(f.instance()(intraday(), 'credential'));
  complete(limited(10));
  await slowCheck;
  await assert.rejects(f.instance()(intraday(15), 'credential'), error => error.retryAfterMs === 300000);
  assert.equal(f.calls.length, 2);
});

test('fractional shared retry expiry uses the absolute deadline, not rounded cache TTL', async () => {
  const f = fixture((_url, _request, call) => call === 1 ? limited(1.001) : ok(body(22000)));
  await assert.rejects(f.instance()(intraday(), 'credential'));
  assert.equal(f.cooldownWrites[0].seconds, 2);
  f.advance(1000);
  await assert.rejects(f.instance()(intraday(), 'credential'));
  assert.equal(f.calls.length, 1);
  f.advance(1);
  await f.instance()(intraday(), 'credential');
  assert.equal(f.calls.length, 2, 'Do not wait an extra second or fallback minute');
});

test('a session close cannot reset a shared provider cooldown', async () => {
  const f = fixture(() => limited(120));
  f.advance(6 * 3600000 - 1000); // 15:29:59 IST.
  await assert.rejects(f.instance()(intraday(), 'credential'));
  f.advance(60000);
  await assert.rejects(f.instance()(intraday(5), 'credential'), error => error.retryAfterMs === 60000);
  assert.equal(f.calls.length, 1);
});

test('only an unexpired genuine cache hit may be reused while its API is cooling down', async () => {
  const f = fixture((_url, _request, call) => call === 1 ? ok(body(22000)) : limited(120));
  await f.instance()(intraday(), 'credential');
  await assert.rejects(f.instance()(intraday(5), 'credential'));
  assert.equal((await f.instance()(intraday(), 'credential')).data.candles[0][4], 22000);
  f.advance(30000);
  await assert.rejects(f.instance()(intraday(), 'credential'), error => error.retryAfterMs === 90000);
  assert.equal(f.calls.length, 2, 'Fresh reuse must not extend TTL or retry the provider');
});

test('optional coordination failures preserve local cooldown and non-429 failures publish no deadline', async () => {
  for (const options of [{ disabled: true }, { readFails: true }, { writeFails: true }]) {
    const f = fixture(() => limited(60), options);
    const instance = f.instance();
    await assert.rejects(instance(intraday(), 'credential'));
    f.advance(10000);
    await assert.rejects(instance(intraday(5), 'credential'), error => error.retryAfterMs === 50000);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture((_url, _request, call) => call === 1
    ? new Response('{}', { status: 401 }) : ok(body(22000)));
  await assert.rejects(f.instance()(intraday(), 'credential'), error => error.status === 401);
  await f.instance()(intraday(), 'credential');
  assert.equal(f.cooldownWrites.length, 0);
  assert.equal(f.calls.length, 2);
});

test('real main-chart and MTF routes reuse one intraday fetch across separate Workers', async t => {
  const f = fixture(() => ok(body(22000)));
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: f.cache } });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'caches', prior);
    else delete globalThis.caches;
  });
  t.mock.method(Date, 'now', f.now);
  let intradayCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/historical-candle/intraday/')) {
      intradayCalls++;
      return ok({ status: 'success', data: { candles: [
        ['2026-10-09T09:15:00+05:30', 22000, 22010, 21990, 22000, 0],
        ['2026-10-09T09:20:00+05:30', 22001, 22011, 21991, 22001, 0],
        ['2026-10-09T09:25:00+05:30', 22002, 22012, 21992, 22002, 0]
      ] } });
    }
    assert.ok(url.includes('/historical-candle/'), url);
    return ok({ status: 'success', data: { candles: [
      ['2026-10-08T15:20:00+05:30', 21900, 21910, 21890, 21900, 0]
    ] } });
  });
  const workerURL = new URL('./worker.js', import.meta.url);
  const parserStub = 'data:text/javascript,' + encodeURIComponent(
    'export function parse() { throw new Error("Unexpected CSV route"); }');
  let sequence = 0;
  const load = async () => {
    const code = source.replace(/from '(\.\/[^']+)'/g, (_, path) =>
      "from '" + new URL(path, workerURL).href + "'")
      .replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
      '\n// shared-route fixture ' + ++sequence;
    return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default;
  };
  const request = async (worker, path) => (await worker.fetch(new Request(
    'https://example.test' + path), { UPSTOX_EXTENDED_TOKEN: 'route-fixture-credential' })).json();
  const main = await request(await load(), '/api/upstox-history?symbol=NIFTY&timeframe=5m');
  const mtf = await request(await load(), '/api/upstox-mtf-history?symbol=NIFTY&timeframe=5m&count=260');
  assert.equal(main.live, true);
  assert.equal(mtf.live, true);
  assert.equal(intradayCalls, 1, 'Different routes/Worker instances reuse identical upstream candles');
  const mainLatest = main.candles.at(-1), mtfLatest = mtf.candles.at(-1);
  for (const field of ['time', 'open', 'high', 'low', 'close']) {
    assert.equal(mainLatest[field], mtfLatest[field], field);
  }
  assert.equal(mainLatest.time, Date.parse('2026-10-09T09:25:00+05:30') / 1000);
  assert.equal(mainLatest.volume, 0, 'Index volume is not fabricated');
  for (const write of f.writes) assert.equal(write.url.includes('route-fixture-credential'), false);
});

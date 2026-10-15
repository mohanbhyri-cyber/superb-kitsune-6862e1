import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UpstoxCoordinator, allowedUpstoxEndpoint, UPSTOX_APP_BUDGETS } from './upstox-coordinator.js';
import { coordinatedUpstoxRequest, upstoxCredentialDigest } from './upstox-coordinator-client.js';

const workerURL = new URL('./worker.js', import.meta.url);
const workerSource = readFileSync(workerURL, 'utf8');
let workerId = 0;
async function loadWorker() {
  const parser = import.meta.resolve('csv-parse/sync');
  const source = workerSource.replace(/from '(\.\/[^']+)'/g, (_, path) =>
    "from '" + new URL(path, workerURL).href + "'")
    .replace("from 'csv-parse/sync'", "from '" + parser + "'") + '\n// coordinator fixture ' + ++workerId;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const { upstoxCoordinatorPolicies: policies } = await loadWorker();
const intraday = (tf = 3) => 'https://api.upstox.com/v3/historical-candle/intraday/NIFTY/minutes/' + tf;
const quote = key => 'https://api.upstox.com/v3/market-quote/quotes?instrument_key=' + key;
const range = unit => 'https://api.upstox.com/v3/historical-candle/NIFTY/' + unit + '/1/2026-10-15/2026-09-01';
const candles = (price = 22000) => ({ status: 'success', data: { candles: [
  ['2026-10-15T09:15:00+05:30', price, price + 10, price - 10, price, 0]
] } });
const quoted = (price = 22000) => ({ status: 'success', data: { nifty: {
  last_price: price, last_trade_time: String(Date.parse('2026-10-15T09:30:00+05:30'))
} } });
const ok = body => new Response(JSON.stringify(body));
const limited = retry => new Response('{}', { status: 429,
  headers: retry === undefined ? {} : { 'retry-after': String(retry) } });

function fixture(t, fetcher = () => ok(candles())) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  let clock = Date.parse('2026-10-15T09:30:00+05:30'), puts = 0;
  const records = new Map(), calls = [], bindings = [], names = [];
  const faults = { read: false, write: false, failPut: 0 };
  const env = { UPSTOX_EXTENDED_TOKEN: 'fixture-coordinator-secret', UPSTOX_COORDINATOR_ENABLED: 'true' };
  const storage = {
    async get(key) { if (faults.read) throw new Error('Storage failed'); return structuredClone(records.get(key)); },
    async put(key, value) {
      puts++;
      if (faults.write || faults.failPut === puts) throw new Error('Storage failed');
      records.set(key, structuredClone(value));
    }
  };
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options }); return fetcher(url, options, calls.length);
  });
  let controller = new UpstoxCoordinator({ storage }, env, policies);
  const namespace = { idFromName(name) { names.push(name); return name; }, get() {
    return { async fetch(request) {
      bindings.push({ url: request.url, text: await request.clone().text() });
      return controller.fetch(request);
    } };
  } };
  env.UPSTOX_COORDINATOR = namespace;
  return { env, namespace, records, calls, bindings, names, faults, storage,
    controller: () => controller,
    request: endpoint => coordinatedUpstoxRequest(endpoint, env.UPSTOX_EXTENDED_TOKEN, namespace),
    raw: request => controller.fetch(request),
    restart: () => { controller = new UpstoxCoordinator({ storage }, env, policies); },
    now: () => clock, advance: ms => { clock += ms; },
    key: endpoint => 'budget:v1:' + policies.scope(endpoint) };
}

test('controller allows only the app market-data GET endpoints, never orders, auth, redirects or credential URLs', () => {
  for (const endpoint of [intraday(), range('hours'), range('minutes'), quote('NIFTY'),
    'https://api.upstox.com/v2/option/chain?instrument_key=NIFTY&expiry_date=2026-10-20',
    'https://api.upstox.com/v2/option/contract?instrument_key=NIFTY',
    'https://api.upstox.com/v2/instruments/search?query=NIFTY&segments=FO']) {
    assert.ok(allowedUpstoxEndpoint(endpoint), endpoint);
  }
  for (const endpoint of ['http://api.upstox.com/v3/market-quote/quotes',
    'https://evil.test/v3/market-quote/quotes', 'https://api.upstox.com.evil.test/v3/market-quote/quotes',
    'https://user:secret@api.upstox.com/v3/market-quote/quotes',
    'https://api.upstox.com:8443/v3/market-quote/quotes',
    'https://api.upstox.com/v2/order/place', 'https://api.upstox.com/v2/login/authorization/token',
    quote('NIFTY') + '&access_token=secret', intraday() + '#secret', intraday() + '?token=secret']) {
    assert.equal(allowedUpstoxEndpoint(endpoint), null, endpoint);
  }
});

test('encoded path separators cannot escape the market-data allowlist', () => {
  assert.equal(allowedUpstoxEndpoint(intraday().replace('NIFTY', '%2f..%2forder')), null);
  assert.equal(allowedUpstoxEndpoint(intraday().replace('NIFTY', '%5c..%5corder')), null);
});

test('production configuration remains unchanged and coordinator activation requires the isolated preview entrypoint', () => {
  const production = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  const preview = JSON.parse(readFileSync(new URL('./wrangler.coordinator.jsonc', import.meta.url), 'utf8'));
  assert.equal(production.main, 'worker.js');
  assert.equal(production.durable_objects, undefined);
  assert.equal(production.vars?.UPSTOX_COORDINATOR_ENABLED, undefined);
  assert.equal(preview.name, 'smrt-upstox-coordinator-preview');
  assert.equal(preview.main, 'worker.coordinator.js');
  assert.equal(preview.vars.UPSTOX_COORDINATOR_ENABLED, 'true');
  assert.deepEqual(preview.migrations[0].new_sqlite_classes, ['UpstoxRequestCoordinator']);
  const excluded = readFileSync(new URL('./.assetsignore', import.meta.url), 'utf8');
  for (const name of ['upstox-coordinator*.js', 'worker.coordinator.js', 'wrangler.coordinator.jsonc']) {
    assert.ok(excluded.includes(name), name + ' must not be served as a static asset');
  }
});

test('many independent binding clients share one provider request and independent genuine response copies', async t => {
  const f = fixture(t);
  const responses = await Promise.all(Array.from({ length: 30 }, () => f.request(intraday())));
  assert.equal(f.calls.length, 1);
  responses[0].data.candles[0][4] = 999;
  assert.equal(responses[1].data.candles[0][4], 22000);
  assert.equal(responses[1].data.candles[0][0], '2026-10-15T09:15:00+05:30');
  assert.equal(responses[1].data.candles[0][5], 0);
  assert.equal(f.records.get(f.key(intraday())).times.length, 1);
  assert.equal(f.records.get(f.key(intraday())).inProgress, false);
  assert.deepEqual([...new Set(f.names)], ['smrt-upstox-data-v1']);
  assert.equal(JSON.stringify([f.bindings, [...f.records], f.names]).includes(f.env.UPSTOX_EXTENDED_TOKEN), false);
  assert.equal(f.calls[0].options.redirect, 'manual');
});

test('workerd-compatible manual redirects fail closed without following or caching a new location', async t => {
  let redirectStatus = 301;
  const f = fixture(t, () => new Response(null, { status: redirectStatus,
    headers: { location: 'https://untrusted.test/credential-target' } }));
  for (const status of [301, 302, 303, 307, 308]) {
    redirectStatus = status;
    await assert.rejects(f.request(quote('NIFTY')), e =>
      e.status === 502 && e.message.includes('unexpected redirect') && !e.message.includes('untrusted'));
    assert.equal(f.controller().cache.size, 0);
    assert.equal(f.records.get(f.key(quote('NIFTY'))).inProgress, false);
  }
  assert.equal(f.calls.length, 5, 'Only the original allowlisted URL is requested once per attempt');
  for (const call of f.calls) {
    assert.equal(call.url, quote('NIFTY'));
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'manual');
  }
});

test('one-time startup pause survives reads, restarts, changed configuration and credential rotation', async t => {
  const f = fixture(t, () => ok(quoted()));
  f.env.UPSTOX_COORDINATOR_STARTUP_PAUSE_MS = '1800000';
  await Promise.all(Array.from({ length: 20 }, () =>
    assert.rejects(f.request(quote('NIFTY')), e => e.status === 429 && e.retryAfterMs === 1800000)));
  const until = f.records.get('startup:v1').until;
  assert.equal(until, f.now() + 1800000);
  assert.equal(f.records.size, 1);
  assert.equal(f.calls.length, 0);
  f.advance(10000);
  f.restart(); f.env.UPSTOX_COORDINATOR_STARTUP_PAUSE_MS = '1000';
  f.env.UPSTOX_EXTENDED_TOKEN = 'rotated-startup-fixture';
  await assert.rejects(f.request(quote('NIFTY')), e => e.retryAfterMs === 1790000);
  delete f.env.UPSTOX_COORDINATOR_STARTUP_PAUSE_MS;
  f.restart();
  await assert.rejects(f.request(quote('NIFTY')), e => e.retryAfterMs === 1790000);
  assert.equal(f.records.get('startup:v1').until, until);
  assert.equal(f.calls.length, 0);
  f.advance(1790000); f.restart();
  await f.request(quote('NIFTY'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.records.get('startup:v1').until, until);
});

test('invalid startup configuration, corrupt deadlines and failed initial storage all fail closed', async t => {
  for (const invalid of ['0', '-1', 'true', '1800001', 'NaN']) {
    const f = fixture(t);
    f.env.UPSTOX_COORDINATOR_STARTUP_PAUSE_MS = invalid;
    await assert.rejects(f.request(intraday()), e => e.status === 503);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(t);
  f.records.set('startup:v1', { until: NaN });
  await assert.rejects(f.request(intraday()), e => e.status === 503);
  assert.equal(f.calls.length, 0);
  f.records.delete('startup:v1');
  f.env.UPSTOX_COORDINATOR_STARTUP_PAUSE_MS = '1800000'; f.faults.write = true;
  await assert.rejects(f.request(intraday()), e => e.status === 503);
  assert.equal(f.calls.length, 0);
  assert.equal(f.records.size, 0);
});

test('same-API queue stops behind the first 429 while an unrelated quote API continues', async t => {
  let complete, started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture(t, url => url === intraday() ? new Promise(resolve => {
    complete = resolve; started();
  }) : ok(quoted()));
  const first = f.request(intraday()), firstCheck = assert.rejects(first, e => e.retryAfterMs === 120000);
  await began;
  const second = f.request(intraday(5)), secondCheck = assert.rejects(second, e => e.retryAfterMs === 120000);
  assert.equal((await f.request(quote('NIFTY'))).data.nifty.last_price, 22000);
  complete(limited(120)); await Promise.all([firstCheck, secondCheck]);
  assert.equal(f.calls.length, 2, 'One intraday attempt and one independent quote attempt');
});

test('full provider cooldown survives a restart, timeframe/session change and credential rotation', async t => {
  const f = fixture(t, (_url, _options, call) => call === 1 ? limited(254) : ok(candles()));
  f.advance(6 * 3600000 - 1000);
  await assert.rejects(f.request(intraday()), e => e.retryAfterMs === 254000);
  f.advance(180000); f.restart();
  f.env.UPSTOX_EXTENDED_TOKEN = 'rotated-fixture-secret';
  await assert.rejects(f.request(intraday(15)), e => e.retryAfterMs === 74000);
  assert.equal(f.calls.length, 1);
  f.advance(74000);
  await f.request(intraday(15));
  assert.equal(f.calls.length, 2);
});

test('rolling second/minute/half-hour budgets survive restart and release only when a slot expires', async t => {
  for (const budget of UPSTOX_APP_BUDGETS) {
    const f = fixture(t);
    const now = f.now();
    f.records.set(f.key(intraday()), { retryAt: 0, inProgress: false,
      times: Array.from({ length: budget.limit }, (_, i) =>
        now - budget.window + 500 + Math.floor(i * (budget.window - 500) / budget.limit)) });
    f.restart();
    await assert.rejects(f.request(intraday()), e => e.status === 429 && e.retryAfterMs >= 1000);
    assert.equal(f.calls.length, 0, String(budget.window));
    f.advance(1000);
    await f.request(intraday());
    assert.equal(f.calls.length, 1);
  }
});

test('shared hits do not consume a budget slot, retimestamp data or extend the original TTL', async t => {
  const f = fixture(t, (_url, _options, call) => ok(quoted(22000 + call)));
  await f.request(quote('NIFTY')); f.advance(14999);
  assert.equal((await f.request(quote('NIFTY'))).data.nifty.last_price, 22001);
  assert.equal(f.records.get(f.key(quote('NIFTY'))).times.length, 1);
  f.advance(1);
  assert.equal((await f.request(quote('NIFTY'))).data.nifty.last_price, 22002);
  assert.equal(f.calls.length, 2);
});

test('1/3/5/15/60-minute boundaries expire central cache with exactly the existing Worker policies', async t => {
  for (const tf of [1, 3, 5, 15, 60]) {
    const f = fixture(t, (_url, _options, call) => ok(candles(22000 + call)));
    const endpoint = tf === 60 ? intraday().replace('minutes/3', 'hours/1') : intraday(tf);
    f.advance((tf === 60 ? 45 : tf) * 60000 - 2000);
    await f.request(endpoint); f.advance(1999);
    assert.equal((await f.request(endpoint)).data.candles[0][4], 22001);
    f.advance(1);
    assert.equal((await f.request(endpoint)).data.candles[0][4], 22002);
  }
});

test('post-close clients cannot join a delayed pre-close snapshot or renew it in the new candle', async t => {
  let complete, started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture(t, (_url, _options, call) => call === 1
    ? new Promise(resolve => { complete = resolve; started(); }) : ok(candles(22002)));
  f.advance(179000);
  const old = f.request(intraday()); await began;
  f.advance(2000); const fresh = f.request(intraday());
  complete(ok(candles(22001)));
  assert.equal((await old).data.candles[0][4], 22001);
  assert.equal((await fresh).data.candles[0][4], 22002);
  assert.equal(f.calls.length, 2);
});

test('HTTP-date, short, fractional, absent and invalid Retry-After retain their real or conservative deadlines', async t => {
  for (const [header, expected] of [[1.001, 1001], [10, 10000], [undefined, 60000], ['bad', 60000],
    ['0', 60000], ['Infinity', 60000], ['Thu, 15 Oct 2026 04:00:20 GMT', 20000]]) {
    const f = fixture(t, () => limited(header));
    await assert.rejects(f.request(intraday()), e => e.retryAfterMs === expected);
    f.advance(1); f.restart();
    await assert.rejects(f.request(intraday(5)), e => e.retryAfterMs === Math.max(1000, expected - 1));
    assert.equal(f.calls.length, 1);
  }
});

test('errors, empty/invalid candles and invalid quotes are never shared as successful data', async t => {
  for (const [endpoint, make] of [[intraday(), () => new Response('{}', { status: 401 })],
    [intraday(), () => new Response('{}', { status: 500 })],
    [intraday(), () => ok({ status: 'error', data: candles().data })],
    [intraday(), () => ok({ data: { candles: [] } })],
    [intraday(), () => ok({ data: { candles: [['bad', 1, 1, 1, 1, 0]] } })],
    [quote('NIFTY'), () => ok({ data: { nifty: { last_price: 'invalid' } } })]]) {
    const f = fixture(t, make);
    await f.request(endpoint).catch(() => {});
    await f.request(endpoint).catch(() => {});
    assert.equal(f.calls.length, 2);
    assert.equal(f.records.get(f.key(endpoint)).retryAt, 0);
  }
});

test('failed/timed-out attempts remain counted and a conservative pause survives restart', async t => {
  const f = fixture(t, () => { throw new Error('Network failure'); });
  await assert.rejects(f.request(intraday()), e => e.status === 503);
  assert.equal(f.records.get(f.key(intraday())).times.length, 1);
  f.advance(10000); f.restart();
  await assert.rejects(f.request(intraday()), e => e.status === 429 && e.retryAfterMs === 50000);
  assert.equal(f.calls.length, 1);
});

test('storage read/reservation failures make zero upstream calls; uncertain completion cannot retry after restart', async t => {
  for (const fault of ['read', 'write']) {
    const f = fixture(t); f.faults[fault] = true;
    await assert.rejects(f.request(intraday()), e => e.status === 503);
    assert.equal(f.calls.length, 0);
  }
  for (const result of [() => ok(candles()), () => limited(300)]) {
    const f = fixture(t, result); f.faults.failPut = 2;
    await assert.rejects(f.request(intraday()), e => e.status === 503);
    assert.equal(f.records.get(f.key(intraday())).inProgress, true);
    f.faults.failPut = 0; f.restart();
    await assert.rejects(f.request(intraday(5)), e => e.status === 503);
    assert.equal(f.calls.length, 1, 'Do not forget an unknown broker outcome/deadline');
  }
});

test('corrupt state and an uncertain in-progress marker fail closed rather than resetting the budget', async t => {
  for (const state of [{ times: [], retryAt: 0, inProgress: true },
    { times: ['invalid'], retryAt: 0, inProgress: false },
    { times: [], retryAt: NaN, inProgress: false }]) {
    const f = fixture(t); f.records.set(f.key(intraday()), state);
    await assert.rejects(f.request(intraday()), e => e.status === 503);
    assert.equal(f.calls.length, 0);
  }
});

test('missing/broken enabled binding never retries directly and mismatched credentials never reach Upstox', async t => {
  const f = fixture(t);
  for (const namespace of [undefined, { idFromName() { throw new Error('Binding failed'); } }]) {
    await assert.rejects(coordinatedUpstoxRequest(intraday(), f.env.UPSTOX_EXTENDED_TOKEN, namespace),
      e => e.status === 503 && e.coordinator);
  }
  await assert.rejects(coordinatedUpstoxRequest(intraday(), 'different-secret', f.namespace), e => e.status === 503);
  assert.equal(f.calls.length, 0);
  const malformed = await f.raw(new Request('https://internal/fetch', { method: 'POST', body: '{bad' }));
  assert.equal(malformed.status, 400);
  const wrongMethod = await f.raw(new Request('https://internal/fetch'));
  assert.equal(wrongMethod.status, 405);
});

test('full main-history and MTF routes on separate Workers share central intraday data', async t => {
  const f = fixture(t, () => ok(candles()));
  const firstWorker = (await loadWorker()).default, secondWorker = (await loadWorker()).default;
  const main = await (await firstWorker.fetch(new Request(
    'https://example.test/api/upstox-history?symbol=NIFTY&timeframe=5m'), f.env)).json();
  const mtf = await (await secondWorker.fetch(new Request(
    'https://example.test/api/upstox-mtf-history?symbol=NIFTY&timeframe=5m&count=260'), f.env)).json();
  assert.equal(main.live, true); assert.equal(mtf.live, true);
  assert.equal(main.candles.at(-1).time, mtf.candles.at(-1).time);
  assert.equal(main.candles.at(-1).close, mtf.candles.at(-1).close);
  assert.equal(f.calls.filter(call => call.url.includes('/intraday/')).length, 1);
  assert.equal(f.calls.every(call => call.options.method === 'GET'), true);
});

test('cache is bounded by bytes and entry count and oversized data cannot crowd it out', async t => {
  const f = fixture(t, url => ok({ ...quoted(), padding: 'x'.repeat(url.includes('BIG') ? 600000 : 140000) }));
  for (let i = 0; i < 70; i++) { await f.request(quote('CACHE' + i)); f.advance(1000); }
  const c = f.controller();
  assert.ok(c.cacheBytes <= 8 * 1024 * 1024);
  assert.ok(c.cache.size <= 64);
  const before = c.cacheBytes;
  await f.request(quote('BIG'));
  assert.equal(c.cacheBytes, before, 'An oversized individual response is not retained');
});

test('provider fetch has a bounded abort signal and a timeout persists the conservative retry pause', async t => {
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    deadlines.push(ms);
    const controller = new AbortController();
    if (ms === 20000) setImmediate(() => controller.abort(new Error('Fixture timeout')));
    return controller.signal;
  });
  const f = fixture(t, (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  await assert.rejects(f.request(intraday()), e => e.status === 503);
  assert.deepEqual(deadlines, [30000, 20000]);
  assert.equal(f.records.get(f.key(intraday())).retryAt, f.now() + 60000);
});

test('the health route reports coordinator cooldown/unavailability without falsely declaring the broker token invalid', async t => {
  const f = fixture(t, () => limited(120));
  const worker = (await loadWorker()).default;
  const request = () => worker.fetch(new Request('https://example.test/api/health'), f.env);
  const blocked = await request();
  assert.equal(blocked.status, 429);
  const result = await blocked.json();
  assert.equal(result.tokenValid, null);
  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterMs, 120000);
  f.env.UPSTOX_COORDINATOR = undefined;
  const missing = await request();
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).tokenValid, null);
  assert.equal(f.calls.length, 1);
});

test('all real market-data handlers and their fallbacks use the binding when enabled', async t => {
  const f = fixture(t, url => {
    if (url.startsWith('https://niftyindices.com/')) return new Response('ISIN Code,Series\n' +
      Array.from({ length: 50 }, (_, i) => 'INE' + String(i).padStart(9, '0') + ',EQ').join('\n'));
    throw new Error('Direct Upstox request must never be used');
  });
  const routed = [];
  const broken = { idFromName: name => name, get: () => ({ fetch: async request => {
    routed.push(JSON.parse(await request.text()).endpoint);
    return new Response(JSON.stringify({ ok: false, reason: 'Fixture unavailable' }), { status: 503 });
  } }) };
  for (const path of ['/api/live-quote?symbol=NIFTY', '/api/upstox-history?symbol=NIFTY&timeframe=3m',
    '/api/upstox-previous-history?symbol=NIFTY&timeframe=3m',
    '/api/upstox-mtf-history?symbol=NIFTY&timeframe=5m', '/api/nifty-daily-history?symbol=NIFTY',
    '/api/nifty-futures-vwap?interval=3', '/api/nifty-options', '/api/nifty-breadth', '/api/health']) {
    const before = routed.length;
    const worker = (await loadWorker()).default;
    const result = await (await worker.fetch(new Request('https://example.test' + path),
      { ...f.env, UPSTOX_COORDINATOR: broken })).json();
    assert.equal(result.live === true || result.available === true, false, path);
    assert.ok(routed.length > before, path + ' must reach the shared binding');
  }
  assert.equal(f.calls.some(call => call.url.startsWith('https://api.upstox.com/')), false);
  assert.ok(routed.some(url => url.includes('/option/contract')));
  assert.ok(routed.some(url => url.includes('/instruments/search')));
});

test('every real market-data route preserves central HTTP 429 and the full remaining deadline', async t => {
  for (const path of ['/api/live-quote?symbol=NIFTY', '/api/upstox-history?symbol=NIFTY&timeframe=3m',
    '/api/upstox-previous-history?symbol=NIFTY&timeframe=3m',
    '/api/upstox-mtf-history?symbol=NIFTY&timeframe=5m', '/api/nifty-daily-history?symbol=NIFTY',
    '/api/nifty-futures-vwap?interval=3', '/api/nifty-options', '/api/nifty-breadth', '/api/health']) {
    const f = fixture(t, url => url.startsWith('https://niftyindices.com/')
      ? new Response('ISIN Code,Series\n' + Array.from({ length: 50 }, (_, i) =>
        'INE' + String(i).padStart(9, '0') + ',EQ').join('\n')) : limited(120));
    const worker = (await loadWorker()).default;
    const request = () => worker.fetch(new Request('https://example.test' + path), f.env);
    const first = await request();
    assert.equal(first.status, 429, path);
    const firstBody = await first.json();
    assert.equal(firstBody.rateLimited, true, path);
    assert.equal(firstBody.retryAfterMs, 120000, path);
    f.advance(10000); f.restart();
    const next = await request();
    assert.equal(next.status, 429, path);
    assert.equal((await next.json()).retryAfterMs, 110000, path);
    assert.equal(f.calls.filter(call => call.url.startsWith('https://api.upstox.com/')).length, 1, path);
  }
});

test('a binding alone does not enable coordination or change the existing production path', async t => {
  const f = fixture(t, () => ok(quoted()));
  const worker = (await loadWorker()).default;
  const env = { ...f.env, UPSTOX_COORDINATOR_ENABLED: 'false', UPSTOX_COORDINATOR: {
    idFromName() { throw new Error('Disabled binding must not be called'); }
  } };
  const response = await worker.fetch(new Request('https://example.test/api/live-quote?symbol=NIFTY'), env);
  assert.equal((await response.json()).live, true);
  assert.equal(f.bindings.length, 0);
  assert.equal(f.calls.length, 1);
});

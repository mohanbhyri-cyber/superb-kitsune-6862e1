import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./market.js', import.meta.url), 'utf8');
const candle = { time: 1792554300, open: 22000, high: 22010, low: 21990, close: 22005 };
const success = () => new Response(JSON.stringify({ live: true, candles: [candle],
  warmup: { ready: false, closedCandles: 1 } }));

function fixture(fetcher) {
  const timers = new Map();
  const calls = [];
  let sequence = 0;
  const context = vm.createContext({ Response, Date, console, AbortController,
    isNseIntradayTime: () => true,
    setTimeout: (callback, delay) => {
      const id = ++sequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => { calls.push({ url, options }); return fetcher(url, options); }
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/, '')
    .replace(/\bexport (?=(?:async )?function|class|const)/g, '') +
    '\nthis.Adapter = UpstoxMarketAdapter;', context);
  const adapter = new context.Adapter();
  return { adapter, calls, timers, expire() {
    const entry = [...timers.values()][0];
    assert.equal(entry.delay, 90000);
    entry.callback();
  } };
}

test('initial history has a bounded deadline and aborts a stalled response without retrying', async () => {
  const f = fixture(() => new Promise(() => {}));
  const pending = f.adapter.history('NIFTY', '1m');
  const rejected = assert.rejects(pending, error => error.code === 'HISTORY_TIMEOUT' &&
    /90 seconds.*signals remain unavailable/.test(error.message));
  assert.equal(f.calls[0].options.signal.aborted, false);
  f.expire();
  await rejected;
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.adapter.status, 'OFFLINE');
  assert.equal(f.calls.length, 1, 'No alternate route or immediate retry');
  assert.equal(f.timers.size, 0);
});

test('deadline covers a stalled response body, not just response headers', async () => {
  let finishBody;
  const f = fixture(async () => ({ ok: true, status: 200,
    json: () => new Promise(resolve => { finishBody = resolve; }) }));
  const pending = f.adapter.history('NIFTY', '1m');
  const rejected = assert.rejects(pending, { code: 'HISTORY_TIMEOUT' });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(typeof finishBody, 'function');
  f.expire();
  await rejected;
  finishBody({ live: true, candles: [candle], warmup: { ready: true } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(f.adapter.status, 'OFFLINE', 'Late data cannot restore LIVE');
  assert.equal(f.adapter.historyWarmup.size, 0, 'Late data cannot populate warm-up state');
  assert.equal(f.adapter.lastUpdate, null);
});

test('late headers from an abort-ignoring transport cannot make timed-out data live', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.adapter.history('NIFTY', '3m');
  const rejected = assert.rejects(pending, { code: 'HISTORY_TIMEOUT' });
  f.expire();
  await rejected;
  finish(success());
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(f.adapter.status, 'OFFLINE');
  assert.equal(f.adapter.historyWarmup.size, 0);
  assert.equal(f.calls.length, 1);
});

test('successful genuine candles retain existing validation and clear the deadline', async () => {
  const f = fixture(async () => success());
  const data = await f.adapter.history('NIFTY', '1m');
  assert.equal(data.length, 1);
  assert.equal(data[0].time, candle.time);
  assert.equal(data[0].close, candle.close);
  assert.equal(f.adapter.status, 'LIVE');
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls[0].options.signal.aborted, false);
});

test('provider 429 keeps its full retry allowance and does not trigger a second fetch', async () => {
  const f = fixture(async () => new Response('{}', { status: 429,
    headers: { 'retry-after': '254' } }));
  await assert.rejects(f.adapter.history('NIFTY', '1m'), error =>
    error.status === 429 && error.retryAfterMs > 253000);
  await assert.rejects(f.adapter.history('NIFTY', '1m'), error => error.status === 429);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('safe controller lock remains visible and is not reset by the deadline wrapper', async () => {
  const f = fixture(async () => new Response(JSON.stringify({
    coordinatorFailure: true,
    reason: 'Fixed category [COORDINATOR_PRIOR_OUTCOME_UNKNOWN]' }), { status: 503 }));
  await assert.rejects(f.adapter.history('NIFTY', '1m'), error =>
    error.coordinator === true && error.code === 'COORDINATOR_PRIOR_OUTCOME_UNKNOWN');
  assert.equal(f.adapter.status, 'DATA UNAVAILABLE');
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('ordinary connection errors clear the timer without exposing raw transport details', async () => {
  const f = fixture(async () => { throw new Error('private transport details'); });
  await assert.rejects(f.adapter.history('NIFTY', '1m'), error =>
    error.message === 'Unable to connect to live market history');
  assert.equal(f.timers.size, 0);
  assert.equal(f.adapter.status, 'OFFLINE');
});

test('unsupported intervals still reject before contacting the broker', async () => {
  const f = fixture(async () => { throw new Error('Must not fetch'); });
  await assert.rejects(f.adapter.history('NIFTY', 'invalid'), /Unsupported timeframe/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
});

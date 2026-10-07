import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('3m history loads multiple genuine sessions to meet the 220 closed-candle gate', async () => {
  const original = globalThis.fetch;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const rows = [];
  for (let daysBack = 1; daysBack <= 3; daysBack++) {
    const start = new Date(today + 'T09:15:00+05:30').getTime() - daysBack * 86400000;
    for (let i = 0; i < 125; i++) rows.push([new Date(start + i * 180000).toISOString(), 100, 102, 99, 101, 10]);
  }
  const current = Array.from({ length: 29 }, (_, i) => [
    new Date(new Date(today + 'T09:15:00+05:30').getTime() + i * 180000).toISOString(), 101, 103, 100, 102, 20
  ]);
  const endpoints = [];
  globalThis.fetch = async url => {
    endpoints.push(String(url));
    return Response.json({ status: 'success', data: { candles: String(url).includes('/intraday/') ? current : rows } });
  };
  try {
    const response = await worker.fetch(new Request('https://test.invalid/api/upstox-history?symbol=NIFTY&timeframe=3m'), { UPSTOX_TOKEN: 'test-multi-session' }, {});
    const body = await response.json();
    assert.equal(body.live, true);
    assert.equal(body.candles.length, 260);
    assert.equal(body.currentSessionCount, 29);
    assert.equal(new Set(body.candles.map(c => c.time)).size, 260);
    assert.equal(body.candles.at(-1).close, 102);
    assert.equal(endpoints.length, 2);
    assert.ok(endpoints[1].includes('/minutes/3/'));
  } finally { globalThis.fetch = original; }
});

test('Worker shares health and quote provider requests and fails closed on 429 across routes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({}, { status: 429, headers: { 'retry-after': '120' } });
  };
  try {
    const env = { UPSTOX_TOKEN: 'test-rate-limit-credential' };
    const responses = await Promise.all(['/api/live-quote', '/api/health'].map(path => worker.fetch(new Request('https://test.invalid' + path), env, {})));
    assert.equal(calls, 1);
    for (const response of responses) {
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get('retry-after')) >= 119);
      const body = await response.json();
      assert.equal(body.live, false);
      assert.equal(body.price, undefined);
      assert.deepEqual(body.candles, []);
    }
    const history = await worker.fetch(new Request('https://test.invalid/api/upstox-history?symbol=NIFTY&timeframe=1m'), env, {});
    assert.equal(history.status, 429);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('Worker never substitutes history when the quote provider fails', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 503 }); };
  try {
    const response = await worker.fetch(new Request('https://test.invalid/api/live-quote'), { UPSTOX_TOKEN: 'test-unavailable' }, {});
    const body = await response.json();
    assert.equal(body.live, false);
    assert.equal(body.price, undefined);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

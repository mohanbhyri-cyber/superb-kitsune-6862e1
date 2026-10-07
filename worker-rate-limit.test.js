import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

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

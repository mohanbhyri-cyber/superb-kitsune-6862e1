import test from 'node:test';
import assert from 'node:assert/strict';
import { upstoxRequest, upstoxCooldownRemaining } from '../market.js';

test('simultaneous identical GETs share one fetch and independent response bodies', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ price: 123 }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const [a, b] = await Promise.all([
      upstoxRequest('/api/live-quote?symbol=NIFTY', { cache: 'no-store' }, 'quote'),
      upstoxRequest('/api/live-quote?symbol=NIFTY', { cache: 'no-store' }, 'quote')
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await a.json(), { price: 123 });
    assert.deepEqual(await b.json(), { price: 123 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('429 respects retry-after and blocks immediate duplicate requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}', { status: 429, headers: { 'retry-after': '20' } });
  };
  try {
    await assert.rejects(upstoxRequest('/api/test-rate-limit', {}, 'quote'), { status: 429 });
    assert.ok(upstoxCooldownRemaining('quote') >= 19000);
    await assert.rejects(upstoxRequest('/api/test-rate-limit', {}, 'quote'), { status: 429 });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

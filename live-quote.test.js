import test from 'node:test';
import assert from 'node:assert/strict';
import liveQuote from './live-quote.js';

async function invoke(timestamp) {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.UPSTOX_ANALYTICS_TOKEN;
  process.env.UPSTOX_ANALYTICS_TOKEN = 'test-only-token';
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { 'NSE_INDEX:Nifty 50': { last_price: 25000, ...(timestamp === undefined ? {} : { timestamp }) } }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await liveQuote(new Request('https://example.com/?symbol=NIFTY'));
    return await response.json();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.UPSTOX_ANALYTICS_TOKEN;
    else process.env.UPSTOX_ANALYTICS_TOKEN = originalToken;
  }
}

test('normalizes seconds and milliseconds consistently', async () => {
  const seconds = Math.floor(Date.now() / 1000) - 5;
  for (const value of [seconds, seconds * 1000]) {
    const quote = await invoke(value);
    assert.equal(quote.live, true);
    assert.equal(quote.time, seconds);
    assert.equal(quote.timestamp, seconds);
  }
});

test('does not mark missing, invalid or future timestamps as live', async () => {
  for (const value of [undefined, 'not-a-time', Math.floor(Date.now() / 1000) + 3600]) {
    const quote = await invoke(value);
    assert.equal(quote.live, false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestCoordinator, retryAfterMs, endpointTtl } from './request-coordinator.js';

test('concurrent panels share a response and receive independent bodies; expiry refetches', async () => {
  let now = 0, calls = 0;
  const coordinator = new RequestCoordinator({ now: () => now, fetcher: async () => {
    calls++; return Response.json({ live: true, candles: [] });
  }});
  const responses = await Promise.all(Array.from({ length: 10 }, () => coordinator.request('/api/upstox-history?a=1&b=2', {}, { ttl: 60000 })));
  await Promise.all(responses.map(r => r.json()));
  assert.equal(calls, 1);
  await coordinator.request('/api/upstox-history?b=2&a=1', {}, { ttl: 60000 });
  assert.equal(calls, 1);
  now = 60001;
  await coordinator.request('/api/upstox-history?a=1&b=2', {}, { ttl: 60000 });
  assert.equal(calls, 2);
});

test('429 stops other endpoints, honors Retry-After and doubles successive cooldowns', async () => {
  let now = 0, calls = 0;
  const coordinator = new RequestCoordinator({ now: () => now, fetcher: async () => {
    calls++; return Response.json({}, { status: 429, headers: { 'retry-after': '90' } });
  }});
  await assert.rejects(coordinator.request('/quote'), e => e.status === 429 && e.retryAfterMs === 90000);
  await assert.rejects(coordinator.request('/history'), e => e.status === 429);
  assert.equal(calls, 1);
  now = 90001;
  await assert.rejects(coordinator.request('/quote'), e => e.retryAfterMs === 120000);
  now += 120001;
  await assert.rejects(coordinator.request('/quote'), e => e.retryAfterMs === 240000);
});

test('credentials isolate requests and cache; errors and unavailable data are never cached', async () => {
  let calls = 0;
  const coordinator = new RequestCoordinator({ fetcher: async () => { calls++; return Response.json({ live: false }); } });
  const config = scope => ({ scope, ttl: 60000, valid: async r => (await r.json()).live === true });
  await coordinator.request('/history', {}, config('a'));
  await coordinator.request('/history', {}, config('a'));
  await coordinator.request('/history', {}, config('b'));
  assert.equal(calls, 3);
});

test('Retry-After dates and body delays use the longest wait; history TTLs differ', () => {
  const response = new Response('', { headers: { 'retry-after': 'Thu, 01 Jan 1970 00:02:00 GMT' } });
  assert.equal(retryAfterMs(response, { retryAfterMs: 150000 }, 0), 150000);
  assert.equal(endpointTtl('/api/upstox-history'), 60000);
  assert.equal(endpointTtl('/api/upstox-mtf-history'), 300000);
  assert.equal(endpointTtl('/api/upstox-previous-history'), 3600000);
});

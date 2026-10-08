import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let fixtureId = 0;

const epoch = clock => Date.parse('2026-10-08T' + clock + '+05:30') / 1000;

async function workerWith(t, body, clock = '16:00:00') {
  t.mock.method(Date, 'now', () => epoch(clock) * 1000);
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(body), { status: 200 }));
  // Execute the production Worker, changing only module-resolution URLs.
  // The optional breadth parser is stubbed: these tests never exercise CSV.
  const workerURL = new URL('./worker.js', import.meta.url);
  const parserStub = 'data:text/javascript,' + encodeURIComponent(
    'export function parse() { throw new Error("Unexpected breadth route"); }');
  const source = readFileSync(workerURL, 'utf8')
    .replace(/from '(\.\/[^']+)'/g, (_, path) =>
      "from '" + new URL(path, workerURL).href + "'")
    .replace("from 'csv-parse/sync'", "from '" + parserStub + "'") +
    '\n// fixture ' + ++fixtureId;
  return (await import('data:text/javascript;base64,' +
    Buffer.from(source).toString('base64'))).default;
}

test('Worker never replaces missing exchange/provider timestamps with Date.now()', async t => {
  const worker = await workerWith(t, { data: { nifty: { last_price: 22000 } } });
  const response = await worker.fetch(new Request('https://example.test/api/live-quote'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' });
  const body = await response.json();
  assert.equal(body.price, 22000);
  assert.equal(body.time, null);
  assert.equal(body.timeSource, 'UNAVAILABLE');
  assert.equal(body.candleEligible, false);
});

test('Worker labels provider snapshots and marks 4pm quotes ineligible for candle creation', async t => {
  const worker = await workerWith(t, { data: { nifty: {
    last_price: 22000, last_trade_time: '0', timestamp: '2026-10-08T16:00:00+05:30'
  } } });
  const body = await (await worker.fetch(new Request('https://example.test/api/live-quote'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json();
  assert.equal(body.time, epoch('16:00:00'));
  assert.equal(body.timeSource, 'QUOTE_SNAPSHOT');
  assert.equal(body.candleEligible, false);
});

test('Worker uses valid last-trade timestamp instead of a later snapshot timestamp', async t => {
  const worker = await workerWith(t, { data: { nifty: {
    last_price: 22000, last_trade_time: String(epoch('15:29:59') * 1000),
    timestamp: '2026-10-08T16:00:00+05:30'
  } } });
  const body = await (await worker.fetch(new Request('https://example.test/api/live-quote'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json();
  assert.equal(body.time, epoch('15:29:59'));
  assert.equal(body.timeSource, 'LAST_TRADE');
  assert.equal(body.candleEligible, true); // App also checks current-session wall time.
});

test('Worker history endpoints strip pre-open, 15:30-start and 4pm candles', async t => {
  const rows = ['09:12:00', '09:15:00', '15:27:00', '15:30:00', '16:00:00']
    .map(clock => ['2026-10-08T' + clock + '+05:30', 22000, 22010, 21990, 22000, 0]);
  const worker = await workerWith(t, { data: { candles: rows } });
  for (const route of ['upstox-history', 'upstox-mtf-history']) {
    const body = await (await worker.fetch(new Request(
      'https://example.test/api/' + route + '?symbol=NIFTY&timeframe=5m'),
      { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json();
    assert.equal(body.live, true);
    assert.deepEqual(body.candles.map(row => row.time), [epoch('09:15:00'), epoch('15:27:00')]);
  }
});

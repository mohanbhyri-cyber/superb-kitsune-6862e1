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

test('production futures route separates completed confirmation from forming display across intervals', async t => {
  const worker = await workerWith(t, {}, '12:00:05');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    requests.push(url.pathname);
    if (url.pathname.endsWith('/instruments/search')) {
      return new Response(JSON.stringify({ data: [{ instrument_key: 'NSE_FO|fixture',
        instrument_type: 'FUT', segment: 'NSE_FO', underlying_symbol: 'NIFTY',
        trading_symbol: 'NIFTY FUT FIXTURE', expiry: '2026-10-29' }] }));
    }
    assert.match(url.pathname, /historical-candle\/intraday/);
    const seconds = Number(url.pathname.split('/').at(-1)) * 60;
    const rows = [];
    for (let time = epoch('09:15:00'); time <= epoch('12:00:00'); time += seconds) {
      const forming = time + seconds > epoch('12:00:05');
      rows.push([new Date(time * 1000).toISOString(), 110, forming ? 1000 : 120,
        100, forming ? 999 : 115, forming ? 1000000 : 100]);
    }
    // Genuine after-hours data cannot enter either confirmation series.
    rows.push(['2026-10-08T16:00:00+05:30', 110, 1000, 100, 999, 1000000]);
    return new Response(JSON.stringify({ data: { candles: rows.reverse() } }));
  });
  for (const interval of [1, 3, 5, 15]) {
    const seconds = interval * 60;
    const body = await (await worker.fetch(new Request(
      'https://example.test/api/nifty-futures-vwap?interval=' + interval),
      { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json();
    const closed = body.closedVwapConfirmation;
    assert.equal(body.live, true);
    assert.equal(body.futuresPrice, 999);
    assert.equal(closed.available, true);
    assert.equal(closed.seconds, seconds);
    assert.equal(closed.lastCandleTime, epoch('12:00:00') - seconds);
    assert.equal(closed.futuresPrice, 115);
    assert.ok(Math.abs(closed.vwap - (120 + 100 + 115) / 3) < 1e-10);
    if (interval < 15) {
      assert.equal(body.volumeConfirmation.available, true);
      assert.equal(body.volumeConfirmation.lastCandleTime, closed.lastCandleTime);
      assert.equal(body.volumeConfirmation.relative, 1);
    } else assert.equal(body.volumeConfirmation.available, false); // Only 11 closed 15m bars.
  }
  assert.equal(requests.filter(path => path.endsWith('/instruments/search')).length, 1);
  assert.equal(requests.filter(path => path.includes('/intraday/')).length, 4);
});

test('production futures route does not turn missing provider volume into valid closed VWAP', async t => {
  const worker = await workerWith(t, {}, '10:18:05');
  const rows = Array.from({ length: 22 }, (_, i) => [
    new Date((epoch('09:15:00') + i * 180) * 1000).toISOString(),
    110, 120, 100, 115, i === 5 ? null : 100
  ]);
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const data = url.pathname.endsWith('/instruments/search')
      ? [{ instrument_key: 'NSE_FO|fixture', instrument_type: 'FUT', segment: 'NSE_FO',
        underlying_symbol: 'NIFTY', trading_symbol: 'NIFTY FUT FIXTURE', expiry: '2026-10-29' }]
      : { candles: rows };
    return new Response(JSON.stringify({ data }));
  });
  const body = await (await worker.fetch(new Request(
    'https://example.test/api/nifty-futures-vwap?interval=3'),
    { UPSTOX_EXTENDED_TOKEN: 'fixture-token' })).json();
  assert.equal(body.live, true);
  assert.equal(body.closedVwapConfirmation.available, false);
});

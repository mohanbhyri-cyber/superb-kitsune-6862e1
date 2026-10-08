import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNseIntradayTime, nseCandleBucket, liveCandleBucket, quoteCandleTime } from './nse-candle-time.js';

const epoch = clock => Date.parse('2026-10-08T' + clock + '+05:30') / 1000;

test('NSE candle starts are restricted to 09:15 inclusive to 15:30 exclusive', () => {
  for (const time of ['09:14:59', '15:30:00', '16:00:00', '21:00:00'])
    assert.equal(isNseIntradayTime(epoch(time)), false, time);
  for (const time of ['09:15:00', '15:27:00', '15:29:59'])
    assert.equal(isNseIntradayTime(epoch(time)), true, time);
  for (const value of [null, undefined, '', NaN, 0, -1])
    assert.equal(isNseIntradayTime(value), false);
});

test('3-minute and hourly buckets are anchored to session open, not midnight UTC', () => {
  assert.equal(nseCandleBucket(epoch('09:17:59'), 180), epoch('09:15:00'));
  assert.equal(nseCandleBucket(epoch('09:18:00'), 180), epoch('09:18:00'));
  assert.equal(nseCandleBucket(epoch('15:29:59'), 180), epoch('15:27:00'));
  assert.equal(nseCandleBucket(epoch('09:59:00'), 3600), epoch('09:15:00'));
  assert.equal(nseCandleBucket(epoch('10:15:00'), 3600), epoch('10:15:00'));
  assert.equal(nseCandleBucket(epoch('16:00:00'), 180), null);
  for (const seconds of [0, NaN, -60, 86400])
    assert.equal(nseCandleBucket(epoch('10:00:00'), seconds), null);
});

test('after-hours quotes cannot manufacture a 4pm candle or revise the final bar', () => {
  for (const clock of ['15:30:00', '16:00:00', '21:00:00']) {
    const now = epoch(clock);
    assert.equal(liveCandleBucket({ time: now, price: 22000 }, 180, now), null);
    assert.equal(liveCandleBucket({ time: epoch('15:29:59') }, 180, now), null);
  }
});

test('stale, missing, future, prior-day and ineligible quotes are display-only', () => {
  const now = epoch('12:00:00');
  for (const tick of [{ time: null }, { time: 0 }, { time: now - 31 },
    { time: now + 6 }, { time: now - 86400 }, { time: now, candleEligible: false }])
    assert.equal(liveCandleBucket(tick, 180, now), null);
  assert.equal(liveCandleBucket({ time: now - 5 }, 180, now), epoch('11:57:00'));
  const saturday = Date.parse('2026-10-10T12:00:00+05:30') / 1000;
  assert.equal(liveCandleBucket({ time: saturday }, 180, saturday), null);
});

test('provider trade timestamps win; no timestamp is replaced with the fetch clock', () => {
  const time = epoch('12:00:00');
  assert.deepEqual(quoteCandleTime({ last_trade_time: String(time * 1000),
    timestamp: '2026-10-08T16:00:00+05:30' }), { time, timeSource: 'LAST_TRADE' });
  assert.deepEqual(quoteCandleTime({ last_trade_time: '0',
    timestamp: '2026-10-08T12:00:00+05:30' }), { time, timeSource: 'QUOTE_SNAPSHOT' });
  for (const quote of [{}, { last_trade_time: '' }, { last_trade_time: null }, { timestamp: 'invalid' }])
    assert.deepEqual(quoteCandleTime(quote), { time: null, timeSource: 'UNAVAILABLE' });
});

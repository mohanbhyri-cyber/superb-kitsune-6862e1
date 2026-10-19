import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCandleRefreshSchedule } from './candle-refresh-schedule.js';

const ms = time => Date.parse('2026-10-13T' + time + '+05:30');
const seconds = time => ms(time) / 1000;

test('3m refresh is due two seconds after the NSE-anchored close, not every 30s', () => {
  const schedule = createCandleRefreshSchedule();
  schedule.markLoaded('NIFTY:3m', 180, ms('09:17:50'), undefined);
  assert.equal(schedule.take('NIFTY:3m', 180, ms('09:17:59')), null);
  assert.equal(schedule.take('NIFTY:3m', 180, ms('09:18:00')), null);
  assert.equal(schedule.take('NIFTY:3m', 180, ms('09:18:01')), null);
  const job = schedule.take('NIFTY:3m', 180, ms('09:18:02'));
  assert.equal(job.target, seconds('09:15:00'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('09:18:03')), null);
  schedule.finish(job, true, ms('09:18:03'));
  for (const time of ['09:18:30', '09:19:00', '09:20:00', '09:21:01']) {
    assert.equal(schedule.take('NIFTY:3m', 180, ms(time)), null);
  }
  assert.equal(schedule.take('NIFTY:3m', 180, ms('09:21:02')).target,
    seconds('09:18:00'));
});

test('1m, 5m and 15m use session anchoring and a two-second grace', () => {
  for (const [timeframe, interval, end, before, after] of [
    ['1m', 60, '09:16:00', '09:16:01', '09:16:02'],
    ['5m', 300, '09:20:00', '09:20:01', '09:20:02'],
    ['15m', 900, '09:30:00', '09:30:01', '09:30:02']
  ]) {
    const schedule = createCandleRefreshSchedule();
    assert.equal(schedule.take('NIFTY:' + timeframe, interval, ms(before)), null);
    const job = schedule.take('NIFTY:' + timeframe, interval, ms(after));
    assert.equal(job.target, ms(end) / 1000 - interval);
  }
});

test('a successful initial load does not immediately request the same history again', () => {
  const schedule = createCandleRefreshSchedule();
  schedule.markLoaded('NIFTY:3m', 180, ms('12:04:00'), seconds('12:00:00'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:04:01')), null);
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:05:59')), null);
  assert.ok(schedule.take('NIFTY:3m', 180, ms('12:06:02')));
});

test('a startup response missing the last closed candle remains due', () => {
  const schedule = createCandleRefreshSchedule();
  schedule.markLoaded('NIFTY:3m', 180, ms('12:06:05'), seconds('12:00:00'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:06:06')).target,
    seconds('12:03:00'));
});

test('late history retries once after 60s, then waits for another boundary', () => {
  const schedule = createCandleRefreshSchedule();
  const first = schedule.take('NIFTY:3m', 180, ms('12:06:02'));
  schedule.finish(first, false, ms('12:06:04'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:07:03')), null);
  const retry = schedule.take('NIFTY:3m', 180, ms('12:07:04'));
  assert.ok(retry);
  schedule.finish(retry, false, ms('12:07:05'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:08:05')), null);
  assert.ok(schedule.take('NIFTY:3m', 180, ms('12:09:02')));
});

test('a missing 1m closed candle gets one 30s retry inside the same minute', () => {
  const schedule = createCandleRefreshSchedule();
  const first = schedule.take('NIFTY:1m', 60, ms('12:06:02'));
  schedule.finish(first, 'pending', ms('12:06:04'));
  assert.equal(schedule.take('NIFTY:1m', 60, ms('12:06:33')), null);
  const retry = schedule.take('NIFTY:1m', 60, ms('12:06:34'));
  assert.ok(retry);
  assert.equal(retry.target, first.target);
  schedule.finish(retry, 'pending', ms('12:06:35'));
  assert.equal(schedule.take('NIFTY:1m', 60, ms('12:06:59')), null);
  assert.ok(schedule.take('NIFTY:1m', 60, ms('12:07:02')));
});

test('the shorter missing-candle retry does not shorten error backoff', () => {
  const schedule = createCandleRefreshSchedule();
  const first = schedule.take('NIFTY:3m', 180, ms('12:06:02'));
  schedule.finish(first, false, ms('12:06:04'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:06:34')), null);
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:07:03')), null);
  assert.ok(schedule.take('NIFTY:3m', 180, ms('12:07:04')));
});

test('a skipped request consumes no attempt and does not leave a flight stuck', () => {
  const schedule = createCandleRefreshSchedule();
  const first = schedule.take('NIFTY:3m', 180, ms('12:06:02'));
  schedule.finish(first, null, ms('12:06:03'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('12:06:03')), null);
  const retry = schedule.take('NIFTY:3m', 180, ms('12:06:04'));
  assert.ok(retry);
  schedule.finish(retry, false, ms('12:06:05'));
  assert.ok(schedule.take('NIFTY:3m', 180, ms('12:07:05')));
});

test('resuming a tab reconciles the current bucket once, not every missed bucket', () => {
  const schedule = createCandleRefreshSchedule();
  schedule.markLoaded('NIFTY:3m', 180, ms('10:01:00'), seconds('09:57:00'));
  const job = schedule.take('NIFTY:3m', 180, ms('11:07:00'));
  assert.equal(job.target, seconds('11:03:00'));
  schedule.finish(job, true, ms('11:07:01'));
  assert.equal(schedule.take('NIFTY:3m', 180, ms('11:07:02')), null);
});

test('late jobs cannot mark a reset, another timeframe, symbol or bucket complete', () => {
  for (const change of ['reset', 'timeframe', 'symbol', 'bucket']) {
    const schedule = createCandleRefreshSchedule();
    const old = schedule.take('NIFTY:3m', 180, ms('12:06:02'));
    if (change === 'reset') schedule.reset();
    const key = change === 'symbol' ? 'BANKNIFTY:3m' :
      change === 'timeframe' ? 'NIFTY:5m' : 'NIFTY:3m';
    const interval = change === 'timeframe' ? 300 : 180;
    const now = change === 'bucket' ? ms('12:09:02') : ms('12:06:03');
    const current = schedule.take(key, interval, now);
    assert.ok(current);
    schedule.finish(old, true, now);
    schedule.finish(current, false, now);
    assert.ok(schedule.take(key, interval, now + 60000), change);
  }
});

test('no pre-open, after-close, invalid-interval or fabricated opening target', () => {
  const schedule = createCandleRefreshSchedule();
  for (const time of ['09:14:59', '09:15:03', '15:30:00', '16:00:00']) {
    assert.equal(schedule.take('NIFTY:3m', 180, ms(time)), null);
  }
  for (const interval of [NaN, 0, -1, 86400]) {
    assert.equal(schedule.take('NIFTY:bad', interval, ms('12:06:02')), null);
  }
  assert.equal(schedule.take('NIFTY:3m', 180, NaN), null);
});

test('a new trading date is not suppressed by yesterday\'s completed bucket', () => {
  const schedule = createCandleRefreshSchedule();
  const previous = schedule.take('NIFTY:3m', 180, ms('15:27:02'));
  schedule.finish(previous, true, ms('15:27:03'));
  const tomorrow = Date.parse('2026-10-14T09:18:02+05:30');
  assert.equal(schedule.take('NIFTY:3m', 180, tomorrow).target,
    Date.parse('2026-10-14T09:15:00+05:30') / 1000);
});

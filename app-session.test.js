import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { liveCandleBucket, liveCandleRejectionReason, nseSessionBounds } from './nse-candle-time.js';
import { regularNseHours } from './options-context.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('            tick => {', app.indexOf('        unsubscribe ='));
const end = app.indexOf('            error => {', start);
assert.ok(start >= 0 && end > start, 'Find actual production subscription callback');
const callback = app.slice(start, end).trim().replace(/,$/, '');
const epoch = clock => Date.parse('2026-10-08T' + clock + '+05:30') / 1000;

function runTick(now, initialTime, tick) {
  const original = { time: initialTime, open: 22000, high: 22010, low: 21990, close: 22000, volume: 0 };
  const state = { tf: '3m', symbol: 'NIFTY', data: [{ ...original }],
    quotes: {}, officialChange: {}, previousClose: {} };
  const context = {
    state, intervals: { '3m': 180, '5m': 300, '15m': 900, '1h': 3600 },
    Date: { now: () => now * 1000 }, liveQuoteVersion: 0,
    historyRefreshWarning: '', upstoxCooldownRemaining: () => 0,
    crossedMtfFrames: () => [],
    liveCandleBucket: (tick, seconds) => liveCandleBucket(tick, seconds, now),
    liveCandleRejectionReason: (tick, seconds) => liveCandleRejectionReason(tick, seconds, now),
    isNseCashMarketOpen: () => regularNseHours(now * 1000),
    nseSessionMinutesFromEpoch: time => (time - nseSessionBounds(time).open) / 60,
    refreshLiveTradeFinalizer() {}, recomputeAiNifty() {}, scheduleLiveRender() {},
    setFeedStatus: (status, message) => { state.feedStatus = status; state.feedMessage = message; }, updateTradingDate() {},
    processSignalAlerts() {}, processScalpAlerts() {}, processMomentumAlerts() {}, checkAlerts() {},
    refreshFuturesVWAP: async () => {}, refreshMTF: async () => {}
  };
  vm.runInNewContext('(' + callback + ')', context)(tick);
  return { state, original };
}

test('actual app callback preserves session candles while updating after-hours quote display', () => {
  const { state, original } = runTick(epoch('16:00:00'), epoch('15:27:00'),
    { time: epoch('16:00:00'), price: 22020 });
  assert.deepEqual(state.data, [original]);
  assert.equal(state.quotes.NIFTY, 22020);
  assert.equal(state.feedStatus, 'CLOSED');
});

test('actual app callback ignores stale or untimestamped quotes for OHLC', () => {
  for (const time of [null, epoch('11:59:00')]) {
    const { state, original } = runTick(epoch('12:00:00'), epoch('11:57:00'),
      { time, price: 22020 });
    assert.deepEqual(state.data, [original]);
    assert.equal(state.feedStatus, 'STALE');
  }
});

test('actual app callback still creates and updates fresh in-session 3m candles', () => {
  const now = epoch('12:00:05');
  const { state } = runTick(now, epoch('11:57:00'), { time: now, price: 22020 });
  assert.equal(state.data.length, 2);
  assert.equal(state.data[1].time, epoch('12:00:00'));
  assert.equal(state.data[1].close, 22020);
  assert.equal(state.feedStatus, 'LIVE');
  const result = runTick(now, epoch('12:00:00'), { time: now, price: 22020 });
  assert.equal(result.state.data.length, 1);
  assert.equal(result.state.data[0].high, 22020);
});

test('actual app callback explains rejected quotes without changing genuine candles or quote display', () => {
  const now = epoch('12:00:00');
  for (const [tick, reason] of [
    [{ time: null, price: 22020 }, /no valid provider timestamp/],
    [{ time: now - 31, price: 22020 }, /31s old/],
    [{ time: now + 6, price: 22020 }, /6s ahead/],
    [{ time: now, price: 22020, candleEligible: false }, /not eligible/]
  ]) {
    const { state, original } = runTick(now, epoch('11:57:00'), tick);
    assert.deepEqual(state.data, [original]);
    assert.equal(state.quotes.NIFTY, 22020);
    assert.equal(state.feedStatus, 'STALE');
    assert.match(state.feedMessage, reason);
  }
});

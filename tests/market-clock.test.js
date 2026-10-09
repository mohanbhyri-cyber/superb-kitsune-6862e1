import test from 'node:test';
import assert from 'node:assert/strict';
import { observeServerDate, clockStatus, isClosedCandle, marketNowMs } from '../market-clock.js';

test('rejects missing or invalid server dates', () => {
  assert.equal(observeServerDate('', 1000, 1100), false);
  assert.equal(observeServerDate('bad', 1000, 1100), false);
});
test('detects device clock two minutes behind server', () => {
  const server = Date.parse('2026-10-09T09:17:00Z');
  const localSent = server - 120000;
  assert.equal(observeServerDate(new Date(server).toUTCString(), localSent, localSent + 100), true);
  assert.ok(Math.abs(clockStatus().offsetMs - 119950) <= 1000);
  assert.equal(clockStatus().safeForLiveSignals, false);
  assert.ok(Math.abs(marketNowMs(localSent + 50) - server) <= 1000);
});
test('checks completed candles by supplied timestamp, not guessed exchange time', () => {
  assert.equal(isClosedCandle(1000, 60, 1059999), false);
  assert.equal(isClosedCandle(1000, 60, 1060000), true);
});

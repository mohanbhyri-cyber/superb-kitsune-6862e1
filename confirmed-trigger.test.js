import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmedTrigger } from './confirmed-trigger.js';

function fixture(side = 1) {
  const now = Date.parse('2026-10-06T05:00:00Z');
  return { now, seconds: 300,
    finalizer: { side, primeConfirmed: true, time: now / 1000 - 300 },
    consensus: { signal: side === 1 ? 'BUY' : 'SELL', confidence: 90 } };
}
test('confirmed BUY and SELL remain available during market hours', () => {
  assert.equal(confirmedTrigger(fixture()).signal, 'BUY');
  assert.equal(confirmedTrigger(fixture(-1)).signal, 'SELL');
});
test('closed market, stale/forming candles, missing data and conflicts block the trigger', () => {
  for (const change of [
    d => d.now = Date.parse('2026-10-06T12:30:00Z'),
    d => d.finalizer.time -= 600,
    d => d.finalizer.time += 1,
    d => d.finalizer.time = null,
    d => d.finalizer.primeConfirmed = false,
    d => d.finalizer.side = 0,
    d => d.consensus.signal = 'NO TRADE',
    d => d.consensus.signal = 'SELL',
    d => d.consensus.confidence = null,
    d => d.consensus.confidence = 79,
    d => d.replay = true,
    d => d.sample = true,
    d => d.seconds = null
  ]) {
    const input = fixture(); change(input);
    const result = confirmedTrigger(input);
    assert.equal(result.signal, 'WAIT');
    assert.equal(result.side, 0);
    assert.equal(result.score, 0);
  }
});

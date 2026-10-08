import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseBestBuySetup as analyse } from './smrt-best-buy.js';

function fixture() {
  return {
    candles: [
      { time: 1000, open: 100, high: 112, low: 99, close: 110 },
      { time: 1180, open: 110, high: 120, low: 109, close: 118 }
    ],
    seconds: 180, now: 1200, sessionOpen: true, atr: 5,
    finalizer: { state: 'BUY', side: 1, time: 1000, primeConfirmed: true,
      plan: { entry: 110, stopLoss: 105, target1: 120, target2: 125, target3: 130 } },
    prime: { signal: 'BUY', side: 1, time: 1000,
      checks: [{ name: 'Structure', ok: true, required: true }] },
    consensus: { signal: 'BUY', confidence: 90, primeConfirmed: true,
      opposingCount: 0, votes: [{ side: 1 }] }
  };
}

test('buy setup uses the latest completed candle and an existing valid plan', () => {
  const data = fixture();
  const result = analyse(data);
  assert.equal(result.signal, 'BUY');
  assert.equal(result.time, 1000);
  assert.equal(result.plan.stop, 105);
  assert.equal(result.rr1, 2);
  data.candles[1].close = 111;
  assert.deepEqual(analyse(data), result);
});

test('missing, stale, mismatched, closed-session and opposing evidence hides buy levels', () => {
  for (const change of [
    d => d.candles = [], d => d.candles[0].low = 111,
    d => d.now = 2400, d => d.finalizer.time = 999,
    d => d.prime.time = 999, d => d.sessionOpen = false,
    d => d.finalizer.primeConfirmed = false,
    d => d.prime.checks[0].ok = false,
    d => d.prime.checks = [], d => d.consensus = null,
    d => d.consensus.confidence = 79,
    d => d.consensus.votes.push({ side: -1 }),
    d => d.consensus.primeConfirmed = false, d => d.sample = true
  ]) {
    const data = fixture(); change(data);
    const result = analyse(data);
    assert.notEqual(result.signal, 'BUY');
    assert.equal(result.side, 0);
    assert.equal(result.plan, null);
    assert.equal(result.rr1, null);
  }
});

test('bearish or invalid risk plans cannot create a buy', () => {
  for (const change of [
    d => { d.prime.side = -1; d.prime.signal = 'SELL'; },
    d => d.finalizer.plan = null,
    d => d.finalizer.plan.stopLoss = 111,
    d => d.finalizer.plan.target1 = 116,
    d => d.finalizer.plan.target2 = 119,
    d => d.finalizer.plan.target3 = null,
    d => d.finalizer.plan.entry = 'bad'
  ]) {
    const data = fixture(); change(data);
    assert.equal(analyse(data).signal, 'NO TRADE');
    assert.equal(analyse(data).plan, null);
  }
});

test('previous buy is cleared at the next candle; replay is explicitly labeled', () => {
  const data = fixture();
  assert.equal(analyse(data).signal, 'BUY');
  data.now = 1360;
  assert.equal(analyse(data).signal, 'WAIT');
  assert.equal(analyse(data).plan, null);
  data.now = 1200;
  data.sessionOpen = false;
  data.replay = true;
  assert.equal(analyse(data).mode, 'REPLAY');
  assert.equal(analyse(data).signal, 'BUY');
});

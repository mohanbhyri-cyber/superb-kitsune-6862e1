import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseSmrtAiIndicator as analyse } from './smrt-ai-indicator.js';

function fixture() {
  const series = value => Array(221).fill(value);
  return {
    candles: Array.from({ length: 221 }, (_, time) => ({ time, close: 110 })),
    calc: { e9: series(108), e21: series(106), e50: series(104), e200: series(100), rsi: series(60), hist: series(1), vwap: series(105) },
    trend: { direction: series(1), adx: series(30), plusDI: series(30), minusDI: series(10) },
    mtf: { overall: 'BULLISH' }, marketMap: { action: 'BUY' },
    niftyEdge: { latest: { signal: 'BUY', side: 1, time: 219 } },
    finalizer: { state: 'CALL', primeConfirmed: true, time: 219 },
    consensus: { signal: 'BUY', confidence: 90 },
    momentum: series({ signal: 'BUY', time: 219 }),
    liquidity: { ready: true, side: 1, state: 'BULLISH', time: 219 },
    efficiency: { ready: true, score: 80, regime: 'TRENDING', time: 219 }
  };
}
test('closed-candle momentum array and liquidity side participate', () => {
  const data = fixture();
  assert.equal(analyse(data).signal, 'AI CALL');
  data.momentum[220] = { signal: 'SELL', time: 220 };
  assert.equal(analyse(data).signal, 'AI CALL');
  data.liquidity.side = -1;
  assert.equal(analyse(data).signal, 'AI WAIT');
});
test('missing, warming, stale and conflicting inputs fail closed', () => {
  for (const change of [d => d.efficiency = null, d => d.efficiency.ready = false,
    d => d.efficiency.time = 218, d => d.momentum[219] = null,
    d => d.momentum[219] = { signal: 'SELL', time: 219 },
    d => d.momentum[219] = { signal: 'BUY', time: 218 },
    d => d.candles.pop(), d => d.finalizer.primeConfirmed = false]) {
    const data = fixture(); change(data);
    assert.equal(analyse(data).signal, 'AI WAIT');
  }
});

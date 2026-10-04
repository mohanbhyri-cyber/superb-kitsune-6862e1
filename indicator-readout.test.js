import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indicatorReadout } from './indicator-readout.js';
test('warm-up and invalid candles show WAIT', () => {
  assert.equal(indicatorReadout([]).cloud, 'WAIT');
  const candles = Array(220).fill({ high: 2, low: 1, close: null });
  assert.equal(indicatorReadout(candles).bands, 'WAIT');
});
test('flat Bollinger bands and displaced Ichimoku values are finite', () => {
  const candles = Array.from({ length: 220 }, (_, i) => ({ time: 1700000000 + i * 60, open: 100, high: 100, low: 100, close: 100, volume: 0 }));
  const result = indicatorReadout(candles, { stochasticRsi: { value: 0.5, signal: 'WAIT' } });
  assert.equal(result.bands, 'Upper 100.00 | Middle 100.00 | Lower 100.00');
  assert.equal(result.stochastic, '50.00 / 100 | WAIT');
  assert.match(result.cloud, /Span A 100.00/);
  candles[219] = { ...candles[219], high: 200, close: 150 };
  assert.match(indicatorReadout(candles).cloud, /Span A 100.00 \| Span B 100.00/);
});

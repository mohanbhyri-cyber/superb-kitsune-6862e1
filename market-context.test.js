import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseMarketContext } from './market-context.js';

test('computes session, previous day/week levels and does not invent them', () => {
  const candles = [
    { time: Date.UTC(2025, 8, 29, 4), high: 110, low: 90, close: 100 },
    { time: Date.UTC(2025, 9, 1, 4), high: 120, low: 95, close: 115 },
    { time: Date.UTC(2025, 9, 6, 4), high: 125, low: 105, close: 120 },
    { time: Date.UTC(2025, 9, 7, 4), high: 130, low: 110, close: 125 }
  ].map(row => ({ ...row, time: row.time / 1000 }));
  const result = analyseMarketContext(candles, { e21: [100, 105, 110, 115], e50: [95, 100, 105, 110], atr: [2, 2, 2, 2] });
  assert.equal(result.ready, true);
  assert.ok(result.session && result.previousDay && result.previousWeek);
  assert.equal(analyseMarketContext(candles.slice(0, 2)).ready, false);
});

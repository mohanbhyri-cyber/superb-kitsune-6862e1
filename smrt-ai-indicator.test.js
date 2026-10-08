import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseSmrtAiIndicator as analyse } from './smrt-ai-indicator.js';

function fixture() {
  const series = value => Array(221).fill(value);
  const time = Date.parse('2026-10-08T12:00:00+05:30') / 1000;
  return {
    candles: Array.from({ length: 221 }, (_, index) => ({ time: time - (219 - index) * 60, close: 110 })),
    seconds: 60, now: time + 60,
    calc: { e9: series(108), e21: series(106), e50: series(104), e200: series(100), rsi: series(60), hist: series(1), vwap: series(105) },
    trend: { direction: series(1), adx: series(30), plusDI: series(30), minusDI: series(10) },
    mtf: { overall: 'BULLISH' }, marketMap: { action: 'BUY' },
    niftyEdge: { latest: { signal: 'BUY', side: 1, time } },
    finalizer: { state: 'CALL', primeConfirmed: true, time },
    consensus: { signal: 'BUY', confidence: 90 },
    momentum: series({ signal: 'BUY', time }),
    liquidity: { ready: true, side: 1, state: 'BULLISH', time },
    efficiency: { ready: true, score: 80, regime: 'TRENDING', time }
  };
}
const dataTime = data => data.candles.at(-2).time;

test('closed-candle momentum array and liquidity side participate', () => {
  const data = fixture();
  assert.equal(analyse(data).signal, 'AI CALL');
  data.momentum[220] = { signal: 'SELL', time: dataTime(data) + 60 };
  assert.equal(analyse(data).signal, 'AI CALL');
  data.liquidity.side = -1;
  assert.equal(analyse(data).signal, 'AI WAIT');
});
test('missing, warming, stale and conflicting inputs fail closed', () => {
  for (const change of [d => d.efficiency = null, d => d.efficiency.ready = false,
    d => d.efficiency.time = dataTime(d) - 60, d => d.momentum[219] = null,
    d => d.momentum[219] = { signal: 'SELL', time: dataTime(d) },
    d => d.momentum[219] = { signal: 'BUY', time: dataTime(d) - 60 },
    d => d.candles.pop(), d => d.finalizer.primeConfirmed = false]) {
    const data = fixture(); change(data);
    assert.equal(analyse(data).signal, 'AI WAIT');
  }
});

// Session controls must override even perfectly aligned technical inputs.
test('after-hours AI stays WAIT with explicit closed status and the last real session candle', () => {
  const data = fixture();
  data.now = Date.parse('2026-10-08T16:03:00+05:30') / 1000;
  const realTime = dataTime(data);
  data.candles.splice(-1, 0, { time: data.now - 180, close: 110 });
  const result = analyse(data);
  assert.equal(result.signal, 'AI WAIT');
  assert.equal(result.regime, 'MARKET CLOSED');
  assert.equal(result.time, realTime);
  assert.equal(result.score, 0);
  assert.equal(result.confluenceScore, 0);
  assert.match(result.reasons[0], /session is closed/);
});

test('future and stale closed-candle timestamps fail closed despite aligned indicators', () => {
  const data = fixture();
  data.now = dataTime(data);
  assert.equal(analyse(data).regime, 'FORMING');
  data.now = dataTime(data) + 1000;
  assert.equal(analyse(data).regime, 'STALE DATA');
  assert.equal(analyse(data).signal, 'AI WAIT');
});

test('out-of-session candle timestamps never participate in AI confirmation', () => {
  const data = fixture();
  data.candles[data.candles.length - 2].time = Date.parse('2026-10-08T16:00:00+05:30') / 1000;
  assert.equal(analyse(data).regime, 'INVALID DATA');
  assert.equal(analyse({ ...data, replay: true }).regime, 'INVALID DATA');
});

test('valid historical replay is not vetoed by the real-time session clock', () => {
  const data = fixture();
  data.now = Date.parse('2026-10-08T16:00:00+05:30') / 1000;
  assert.equal(analyse(data).signal, 'AI WAIT');
  assert.equal(analyse({ ...data, replay: true }).signal, 'AI CALL');
});

test('mixed numeric EMA values are distinguished from missing indicators and all blockers are exposed', () => {
  const data = fixture();
  data.calc.e9.fill(103);
  data.trend.adx.fill(15);
  data.calc.rsi.fill(50);
  data.finalizer = { state: 'NO TRADE', time: dataTime(data), reasons: ['MTF confirmation incomplete'] };
  const result = analyse(data);
  assert.equal(result.signal, 'AI WAIT');
  assert.match(result.reasons[0], /EMA.*stack is mixed/);
  assert.ok(result.reasons.some(reason => /ADX/.test(reason)));
  assert.ok(result.reasons.some(reason => /RSI/.test(reason)));
  assert.ok(result.reasons.some(reason => /MTF confirmation incomplete/.test(reason)));
  data.calc.e9[219] = null;
  assert.match(analyse(data).reasons[0], /indicators unavailable/);
});

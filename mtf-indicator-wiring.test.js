import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { candleConfluence } from './smrt-candle-scanner.js';
import { finalizeTrade } from './smrt-trade-finalizer.js';
import { indicators } from './market.js';
import { trendIndicators } from './trend-indicators.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
function section(from, to, offset = 0) {
  const start = app.indexOf(from, offset), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}
function scanner(side, strength = 4) {
  return { latest: { patterns: [{ name: 'Test pattern', side, strength }] } };
}

test('actual MTF BULLISH/BEARISH labels contribute the existing two confluence points', () => {
  for (const [side, labels] of [[1, ['MTF BULLISH', 'BULLISH', 'STRONG BULLISH', 'MTF BUY']],
    [-1, ['MTF BEARISH', 'BEARISH', 'STRONG BEARISH', 'MTF SELL']]]) {
    for (const label of labels) {
      const result = candleConfluence(scanner(side), { trend: side === 1 ? 'BULLISH' : 'BEARISH' },
        null, { overall: label });
      assert.equal(result.score, 8, label);
      assert.equal(result.action, side === 1 ? 'BUY REVERSAL' : 'SELL REVERSAL', label);
    }
  }
});

test('MTF cannot create a pattern or lower the existing eight-point threshold', () => {
  assert.equal(candleConfluence(null, null, null, { overall: 'MTF BULLISH' }).action, 'NO TRADE');
  assert.equal(candleConfluence(scanner(0), null, null, { overall: 'MTF BULLISH' }).action, 'NO TRADE');
  const result = candleConfluence(scanner(1, 3), { trend: 'BULLISH' }, null, { overall: 'MTF BULLISH' });
  assert.equal(result.score, 7);
  assert.equal(result.action, 'NO TRADE');
});

test('neutral, mixed, missing, unavailable and opposite MTF give no agreement points', () => {
  for (const label of [undefined, '', 'MTF MIXED', 'MTF WARMING UP', 'DATA UNAVAILABLE',
    'NO TRADE BUY', 'WAITING SELL', 'NOT READY BUY', 'BULLISH BEARISH', 'MTF BEARISH']) {
    const result = candleConfluence(scanner(1), { trend: 'BULLISH' }, null, { overall: label });
    assert.equal(result.score, 6, String(label));
    assert.equal(result.action, 'NO TRADE');
  }
});

function rawFixture() {
  return { data: [
    { time: 100, open: 99, high: 102, low: 98, close: 100 },
    { time: 280, open: 99, high: 102, low: 98, close: 100 },
    { time: 460, open: 100, high: 100, low: 100, close: 100 }],
  calc: { e9: [99,99,99], e21: [98,98,98], e50: [97,97,97],
    rsi: [60,60,60], hist: [1,1,1], vwap: [95,95,95] },
  trend: { direction: [1,1,1], adx: [30,30,30], plusDI: [25,25,25],
    minusDI: [10,10,10], atr: [5,5,5] }, marketMap: { trend: 'BULLISH' },
  mtf: { overall: 'MTF WARMING UP' } };
}
function analysisKey(state) {
  const code = section('      const analysisKey =', '      if (analysisKey !== lastAnalysisKey)',
    app.indexOf('    function draw()'));
  return vm.runInNewContext('(function(){' + code + 'return analysisKey;})()',
    { state, closedCandle: state.data.at(-2) });
}

test('real draw cache key tracks MTF changes without a new candle or quote', () => {
  const fixture = rawFixture();
  const state = { data: fixture.data, mtf: fixture.mtf, signalSensitivity: 'fast', futuresVWAP: 95 };
  const first = analysisKey(state), rawBefore = finalizeTrade(fixture);
  assert.equal(rawBefore.state, 'NO TRADE');
  assert.equal(analysisKey(state), first, 'Unchanged MTF keeps the cache fast');
  state.mtf.overall = 'MTF BULLISH';
  assert.notEqual(analysisKey(state), first, 'MTF is a real Finalizer dependency');
  assert.equal(finalizeTrade(fixture).state, 'BUY SETUP');
  state.mtf.overall = 'MTF MIXED';
  assert.equal(finalizeTrade(fixture).state, 'NO TRADE');
  state.mtf.overall = 'MTF BEARISH';
  assert.equal(finalizeTrade(fixture).state, 'NO TRADE', 'Opposing MTF never approves bullish inputs');
});

test('fresh MTF cannot bypass missing ADX, opposing MACD, choppy regime or failed Prime', () => {
  for (const change of [x => { x.trend.adx[1] = 10; },
    x => { x.calc.hist[1] = -1; },
    x => { x.efficiency = { ready: true, score: 20, noise: 'HIGH', regime: 'CHOPPY' }; }]) {
    const fixture = rawFixture(); fixture.mtf.overall = 'MTF BULLISH'; change(fixture);
    const result = finalizeTrade(fixture);
    assert.equal(result.state, 'NO TRADE');
    assert.equal(result.plan, null);
  }
  const fixture = rawFixture(); fixture.mtf.overall = 'MTF BULLISH';
  const context = vm.createContext({ candidate: finalizeTrade(fixture),
    prime: { side: 0, reasons: ['Structure and volume confirmation incomplete'] } });
  vm.runInContext(section('    function primeSide(', '    function primeClosed(') +
    section('    function primeGate(', '    function refreshPrimeConfirmation('), context);
  vm.runInContext('this.final = primeGate(candidate, prime);', context);
  assert.equal(context.final.state, 'NO TRADE');
  assert.equal(context.final.plan, null);
});

test('MTF overall colours match real direction labels without mutating input', () => {
  const code = section('    function renderMTF()', '    async function refreshMTF(');
  for (const [label, color] of [['MTF BULLISH','up'], ['MTF BEARISH','down'],
    ['MTF MIXED','muted'], ['MTF WARMING UP','muted'], ['DATA UNAVAILABLE','muted']]) {
    const nodes = new Map(); const state = { mtf: { overall: label } };
    const context = vm.createContext({ state, $: selector => {
      if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); } });
    vm.runInContext(section('    function primeSide(', '    function primeClosed(') + code +
      '\nrenderMTF();', context);
    assert.equal(nodes.get('#mtf-overall').className, color, label);
    assert.equal(state.mtf.overall, label);
  }
});

test('Prime and raw Finalizer use matching completed-candle ADX, RSI and MACD inputs', () => {
  const bars = Array.from({ length: 260 }, (_, i) => {
    const close = 20000 + i * 0.8 + Math.sin(i / 4) * 6;
    return { time: 1000 + i * 180, open: close - 0.5, high: close + 2,
      low: close - 2, close, volume: 0 };
  });
  const forming = { ...bars.at(-1), time: bars.at(-1).time + 180,
    open: 99999, high: 99999, low: 1, close: 1 };
  const context = vm.createContext({ indicators, trendIndicators,
    console: { error() {} }, bars });
  vm.runInContext(section('    function primeFinite(', '    function primeEpochSeconds(') +
    section('    function primeTechnical(', '    function analysePrimeMarket('), context);
  const technical = vm.runInContext('primeTechnical(bars)', context);
  const data = [...bars, forming];
  const raw = finalizeTrade({ data, calc: indicators(data), trend: trendIndicators(data),
    mtf: { overall: 'MTF BULLISH' }, marketMap: { trend: 'BULLISH' } });
  assert.ok(raw.mandatory);
  assert.equal(raw.time, bars.at(-1).time);
  assert.equal(raw.mandatory.adx, technical.values.adx);
  assert.equal(raw.mandatory.rsi, technical.values.rsi);
  assert.equal(raw.mandatory.macdHistogram, technical.values.hist);
  assert.ok(technical.values.adx >= 0 && technical.values.adx <= 100);
  assert.ok(technical.values.rsi >= 0 && technical.values.rsi <= 100);
});

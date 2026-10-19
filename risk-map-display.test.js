import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { riskMapDisplay } from './risk-map-display.js';
import { analyseAllIndicators } from './smrt-all-indicators.js';

const time = Date.parse('2026-10-13T10:00:00+05:30') / 1000;
function sample(side = 1) {
  return { sessionOpen: true, closedTime: time, atr: 10,
    finalizer: { state: side === 1 ? 'BUY' : 'SELL', side, time,
      primeConfirmed: true, reasons: [], plan: { entry: 100,
        stopLoss: 100 - side * 10, target1: 100 + side * 15,
        target2: 100 + side * 20, target3: 100 + side * 30 } },
    prime: { time, side, checks: [{ name: 'Closed-candle freshness', ok: true },
      { name: 'Required confirmation', required: true, ok: true }] },
    consensus: { signal: side === 1 ? 'BUY' : 'SELL', confidence: 100 },
    risk: { ready: true, quality: 'GOOD', score: 100 } };
}
function withheld(input, status) {
  const result = riskMapDisplay(input);
  assert.equal(result.status, status);
  assert.equal(result.plan, null);
  assert.equal(result.analysis, null);
  assert.ok(result.reason);
  return result;
}

test('confirmed BUY and SELL display only validated final-plan risk and signed reward', () => {
  for (const side of [1, -1]) {
    const input = sample(side), original = structuredClone(input);
    const result = riskMapDisplay(input);
    assert.equal(result.status, 'RISK ACCEPTABLE · 100/100');
    assert.equal(result.plan, input.finalizer.plan);
    assert.equal(result.analysis.risk, 10);
    assert.equal(result.analysis.rr1, 1.5);
    assert.match(result.reason, side === 1 ? /Confirmed BUY/ : /Confirmed SELL/);
    assert.deepEqual(input, original, 'Display must not change plans or confirmations');
  }
});

test('market closed hides even a previously confirmed plan', () => {
  withheld({ ...sample(), sessionOpen: false }, 'MARKET CLOSED');
  withheld({}, 'MARKET CLOSED');
});

test('missing completed-candle data is explicit instead of an unexplained no-plan label', () => {
  withheld({ sessionOpen: true }, 'WAIT · DATA UNAVAILABLE');
  for (const closedTime of [null, '', false, 0, NaN]) {
    withheld({ ...sample(), closedTime }, 'WAIT · DATA UNAVAILABLE');
  }
});

test('stale or missing freshness confirmation never displays active levels', () => {
  for (const checks of [[], null, {}, [{ name: 'Closed-candle freshness', ok: false }]]) {
    const input = sample(); input.prime.checks = checks;
    withheld(input, 'WAIT · STALE / UNAVAILABLE DATA');
  }
});

test('mismatched or missing plan candle timestamps withhold all levels', () => {
  for (const field of ['prime', 'finalizer']) {
    const input = sample(); input[field].time = time - 180;
    withheld(input, 'WAIT · CANDLE MISMATCH');
  }
  const input = sample(); delete input.finalizer.time;
  withheld(input, 'WAIT · CANDLE MISMATCH');
});

test('an earlier acceptable raw plan cannot leak into a blocked finalizer display', () => {
  const input = sample();
  input.finalizer = { state: 'NO TRADE', side: 0, plan: null,
    reasons: ['Required structure confirmation missing'] };
  const result = withheld(input, 'WAIT · CONFIRMATION INCOMPLETE');
  assert.match(result.reason, /structure confirmation/);
});

test('explicit risk veto remains blocked whether or not the old plan is present', () => {
  for (const keepPlan of [true, false]) {
    const input = sample();
    input.risk = { ready: true, quality: 'BLOCK', reasons: ['Risk veto'] };
    if (!keepPlan) input.finalizer.plan = null;
    const result = withheld(input, 'RISK BLOCKED');
    assert.equal(result.reason, 'Risk veto');
  }
});

test('all Finalizer, Prime and Consensus confirmations remain mandatory', () => {
  for (const change of [
    x => { x.finalizer.primeConfirmed = false; },
    x => { x.finalizer.state = 'WAIT'; },
    x => { x.finalizer.side = -1; },
    x => { x.prime.side = 0; },
    x => { x.prime.checks[1].ok = false; },
    x => { x.consensus.signal = 'SELL'; },
    x => { x.consensus.signal = 'BUY / SELL'; },
    x => { x.consensus.signal = 'NO TRADE'; }
  ]) {
    const input = sample(); change(input);
    withheld(input, 'WAIT · CONFIRMATION INCOMPLETE');
  }
});

test('malformed levels and targets on the losing side cannot create positive R/R', () => {
  for (const side of [1, -1]) {
    for (const field of ['entry', 'stopLoss', 'target1', 'target2', 'target3']) {
      for (const value of [null, '', false, 0, NaN, -1]) {
        const input = sample(side); input.finalizer.plan[field] = value;
        withheld(input, 'RISK BLOCKED');
      }
    }
    const input = sample(side); input.finalizer.plan.target1 = 100 - side * 15;
    withheld(input, 'RISK BLOCKED');
  }
});

test('optional checks are optional, but risk cautions are visibly explained', () => {
  const input = sample();
  input.prime.checks.push({ name: 'Optional context', required: false, ok: false });
  input.finalizer.plan.target1 = 105;
  const result = riskMapDisplay(input);
  assert.equal(result.status, 'RISK CAUTION · 65/100');
  assert.match(result.reason, /below 1R/);
  assert.equal(result.analysis.rr1, 0.5);
});

test('Replay may show a historical confirmed plan, explicitly not a live trade', () => {
  const result = riskMapDisplay({ ...sample(), replay: true, sessionOpen: false });
  assert.equal(result.status, 'REPLAY · RISK ACCEPTABLE · 100/100');
  assert.match(result.reason, /Historical sample · not a live trade/);
});

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
function section(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}
function panels(input) {
  const nodes = new Map();
  const node = (tagName = 'fragment') => ({ tagName, textContent: '', className: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(fragment) { this.children = fragment.children; } });
  const state = { tf: '3m', symbol: 'NIFTY', replay: { active: input.replay || false },
    data: [{ time, high: 101, low: 99, close: 100 }],
    marketMap: { atr: input.atr, trend: 'BULLISH', reversal: 'NONE', breakout: 'NONE' },
    tradeFinalizer: input.finalizer, liveTradeFinalizer: input.finalizer,
    primeMarket: input.prime, allIndicatorsConsensus: input.consensus,
    riskEngine: input.risk, feedStatus: 'LIVE' };
  const context = vm.createContext({ state, intervals: { '3m': 180 },
    Date: class extends Date { static now() { return (time + 180) * 1000; } },
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    document: { createElement: node, createDocumentFragment: node },
    riskMapDisplay, fmt: value => Number(value).toFixed(2), quote: () => 100,
    isNseCashMarketOpen: () => input.sessionOpen, regularNseHours: () => input.sessionOpen,
    primeSide: value => /BUY/.test(value || '') ? 1 : /SELL/.test(value || '') ? -1 : 0 });
  vm.runInContext(section('    function primeFinite(', '    function primeEpochSeconds(') +
    section('    function primeClosed(', '    function nseSessionMinutesFromEpoch(') +
    section('    function renderChartIndicatorStatus(', '    function renderAllIndicatorsConsensus()') +
    section('    function updateMarketMapPanel()', '    function renderChartConsensus('), context);
  const render = () => vm.runInContext('renderChartIndicatorStatus(state.allIndicatorsConsensus); updateMarketMapPanel();', context);
  render();
  return { state, nodes, render, context,
    row: label => nodes.get('#chart-status-rows').children.find(row =>
      row.children[0]?.textContent === label)?.children[1]?.textContent };
}

test('actual chart box and Market Map render the same confirmed BUY / SELL risk', () => {
  for (const side of [1, -1]) {
    const input = sample(side), p = panels(input);
    assert.equal(p.row('Risk Engine'), p.nodes.get('#market-map-risk-engine').textContent);
    assert.equal(p.row('Risk reason'), undefined);
    assert.match(p.nodes.get('#market-map-risk-reason').textContent, /Confirmed (BUY|SELL)/);
    assert.match(p.nodes.get('#chart-status-rows').children.find(row =>
      row.children[0]?.textContent === 'Risk Engine').className, /chart-risk-row/);
    assert.equal(p.row('Entry'), '100.00');
    assert.equal(p.row('Stop distance'), '10.00 pts');
    assert.equal(p.row('ATR (volatility)'), '10.00 pts');
    assert.equal(p.row('Target 1 R/R'), '1 : 1.50');
    assert.equal(p.nodes.get('#market-map-rr').textContent, '1 : 1.50');
    assert.equal(p.nodes.get('#market-map-entry-stop').textContent,
      '₹100.00 / ₹' + input.finalizer.plan.stopLoss.toFixed(2));
  }
});

test('screenshot-like mixed votes show diagnostic agreement without approving a trade', () => {
  const raw = analyseAllIndicators({ finalizer: { state: 'NO TRADE' },
    mtf: { overall: 'BULLISH' }, technicalIndicators: {
      ichimoku: 'BULLISH', coppock: 'BULLISH',
      williamsR: 'BEARISH', fisher: 'BEARISH', ibs: 'BULLISH', qstick: 'BULLISH' } });
  assert.equal(raw.alignment, 80);
  assert.equal(raw.totalVotes, 4);
  assert.equal(raw.minimumActiveGroups, 6);
  const input = sample();
  input.finalizer = { state: 'NO TRADE', side: 0, plan: null,
    primeConfirmed: false, reasons: ['MACD histogram positive required'] };
  input.prime.side = 0;
  input.consensus = raw;
  const p = panels(input);
  vm.runInContext(section('    function primeGate(', '    function refreshPrimeConfirmation('), p.context);
  vm.runInContext('state.allIndicatorsConsensus = primeGate(state.allIndicatorsConsensus, state.primeMarket, "signal");', p.context);
  assert.equal(p.state.allIndicatorsConsensus.confidence, 0);
  const before = JSON.stringify(p.state);
  p.render();
  assert.equal(p.row('Directional votes'), '3 bullish / 1 bearish');
  assert.equal(p.row('Weighted alignment'), '80%');
  assert.equal(p.row('Active groups'), '4 / 9 · need 6');
  assert.equal(p.row('Trade approval'), 'WAIT · NOT APPROVED');
  assert.equal(p.row('Trend Composite'), 'BULLISH');
  assert.equal(p.row('Reversal Composite'), 'BEARISH');
  assert.equal(p.row('Trade Finalizer'), 'WAIT');
  assert.equal(p.row('Agreement'), undefined);
  assert.equal(p.row('Entry'), '—');
  assert.equal(p.nodes.get('#market-map-rr').textContent, '—');
  assert.equal(JSON.stringify(p.state), before, 'Diagnostics cannot alter gated trading state');
});

test('missing or malformed directional votes show no invented agreement', () => {
  for (const votes of [undefined, [], [{ name: 'Neutral', side: 0 }]]) {
    const input = sample(); input.finalizer.plan = null;
    input.consensus = { signal: 'NO TRADE', confidence: 0, alignment: 100, votes };
    const p = panels(input);
    assert.equal(p.row('Directional votes'), '—');
    assert.equal(p.row('Weighted alignment'), '—');
    assert.equal(p.row('Active groups'), '—');
    assert.equal(p.row('Trade approval'), 'WAIT · NOT APPROVED');
  }
});

test('high diagnostic alignment still cannot override session and risk vetoes', () => {
  for (const change of [x => { x.sessionOpen = false; },
    x => { x.risk = { ready: true, quality: 'BLOCK', reasons: ['Risk veto'] }; }]) {
    const input = sample();
    input.consensus = { ...input.consensus, confidence: 0, alignment: 100,
      totalGroups: 9, minimumActiveGroups: 6, votes: [{ name: 'Trend Composite', side: 1, weight: 2 }] };
    change(input);
    const p = panels(input);
    assert.equal(p.row('Weighted alignment'), '100%');
    assert.equal(p.row('Active groups'), '1 / 9 · need 6');
    assert.equal(p.row('Trade approval'), 'WAIT · NOT APPROVED');
    assert.equal(p.row('Entry'), '—');
  }
});

test('confirmed final plan remains approved and trigger scores are diagnostic, not accuracy', () => {
  const p = panels(sample());
  p.state.triggerSignal = { signal: 'BUY', side: 1, score: 73 };
  p.render();
  assert.equal(p.row('Trade approval'), 'CONFIRMED');
  assert.equal(p.row('Trade Finalizer'), 'BUY');
  assert.equal(p.row('SMRT Trigger'), 'BULLISH · 73/100');
  assert.equal(p.row('Risk reason'), undefined);
});

test('actual panels withhold levels and agree for closed, stale, blocked and incomplete setups', () => {
  for (const change of [
    x => { x.sessionOpen = false; },
    x => { x.prime.checks[0].ok = false; },
    x => { x.finalizer.plan.target1 = 85; },
    x => { x.finalizer.plan = null; },
    x => { x.prime.time -= 180; }
  ]) {
    const input = sample(); change(input);
    const p = panels(input);
    assert.equal(p.row('Risk Engine'), p.nodes.get('#market-map-risk-engine').textContent);
    assert.equal(p.row('Risk reason'), undefined);
    assert.ok(p.nodes.get('#market-map-risk-reason').textContent, 'Detailed Market Map reason remains available');
    for (const label of ['Entry', 'Stop-loss', 'Target 1 / 2', 'Stop distance', 'Target 1 R/R']) {
      assert.equal(p.row(label), '—', label);
    }
    for (const id of ['#market-map-entry-stop', '#market-map-targets', '#market-map-rr']) {
      assert.equal(p.nodes.get(id).textContent, '—', id);
    }
    assert.equal(p.nodes.get('#market-map-premium-bias').textContent, 'NO TRADE');
  }
});

test('losing Market Map data clears a previous risk plan and all displayed levels', () => {
  const p = panels(sample()); p.state.marketMap = null; p.render();
  assert.equal(p.nodes.get('#market-map-risk-engine').textContent, 'WAIT · DATA UNAVAILABLE');
  assert.equal(p.row('Risk Engine'), p.nodes.get('#market-map-risk-engine').textContent);
  assert.equal(p.row('Entry'), '—');
  for (const id of ['#market-map-entry-stop', '#market-map-targets', '#market-map-rr', '#market-map-atr-risk']) {
    assert.equal(p.nodes.get(id).textContent, '—');
  }
  assert.ok(html.includes('id="market-map-risk-reason"'));
  assert.ok(html.includes('<small>ATR (volatility)</small>'));
  assert.match(css, /\.chart-risk-row \{ flex-direction: column/);
  assert.match(css, /\.chart-risk-row strong \{ white-space: normal; overflow-wrap: anywhere/);
});

test('compact chart removes only the requested explanations and keeps session, risk and approval states', () => {
  const chartHtml = html.slice(html.indexOf('<section id="chart-indicator-status"'),
    html.indexOf('<div class="single-chart-oscillators"'));
  assert.ok(chartHtml.includes('id="chart-status-context"'));
  assert.ok(chartHtml.includes('id="chart-status-rows"'));
  assert.doesNotMatch(chartHtml, /chart-status-note|Component directions and alignment/);
  assert.match(html, /id="market-map-risk-reason"/);
  assert.match(html, /id="trade-finalizer-panel"/);
  assert.match(html, /app\.js\?v=124/);
  for (const change of [() => {}, x => { x.sessionOpen = false; },
    x => { x.prime.checks[0].ok = false; },
    x => { x.risk = { ready: true, quality: 'BLOCK', reasons: ['Risk veto'] }; },
    x => { x.replay = true; x.sessionOpen = false; }]) {
    const input = sample(); change(input);
    const expected = riskMapDisplay(input), p = panels(input);
    const before = JSON.stringify(p.state);
    p.render();
    assert.equal(JSON.stringify(p.state), before, 'Presentation cannot change any trade/risk state');
    assert.equal(p.row('Risk reason'), undefined);
    assert.ok(p.nodes.get('#chart-status-rows').children.every(child => child.tagName === 'div'),
      'No appended explanatory paragraph, including after another render');
    assert.equal(p.row('Risk Engine'), expected.status);
    assert.equal(p.row('Trade approval'), expected.plan ? 'CONFIRMED' : 'WAIT · NOT APPROVED');
    assert.equal(p.row('Entry'), expected.plan ? '100.00' : '—');
    assert.equal(p.nodes.get('#chart-status-context').textContent, input.replay
      ? 'Replay · completed candle' : input.sessionOpen
        ? 'Completed candle · 3m' : 'Market closed · last session · 3m');
    assert.equal(p.nodes.get('#market-map-risk-reason').textContent, expected.reason);
  }
});

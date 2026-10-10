import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analyseSmrtAiIndicator } from './smrt-ai-indicator.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const intervals = { '1m': 60, '3m': 180, '5m': 300, '15m': 900 };
const epoch = time => Date.parse('2026-10-09T' + time + '+05:30') / 1000;
const display = time => new Date(time * 1000).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
}) + ' IST';

function section(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'Locate actual app code: ' + from);
  return app.slice(start, end);
}

function history(seconds, end = epoch('13:30:00')) {
  const bars = [];
  for (let day = 13; day >= 0; day--) {
    const open = epoch('09:15:00') - day * 86400;
    if ([0, 6].includes(new Date(open * 1000).getUTCDay())) continue;
    for (let time = open; time + seconds <= open + 375 * 60 && time <= end; time += seconds) {
      bars.push({ time, open: 110, high: 111, low: 109, close: 110, volume: 0 });
    }
  }
  return bars.slice(-221);
}

function fixture(tf = '3m', replay = true, now = epoch('13:33:00')) {
  const state = { tf, data: history(intervals[tf]), replay: { active: replay },
    liveTradeFinalizer: { state: 'NO TRADE', plan: null }, feedStatus: 'CLOSED' };
  const nodes = new Map();
  const node = () => ({ textContent: '', className: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(fragment) { this.children = fragment.children; }
  });
  const context = vm.createContext({ state, intervals,
    Date: class extends Date { static now() { return now * 1000; } },
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    document: { createElement: node, createDocumentFragment: node },
    isNseCashMarketOpen: () => false,
    fmt: value => Number(value).toFixed(2),
    analyseSmrtAiIndicator, renderAiIndicator() {}
  });
  vm.runInContext(section('    function primeFinite(', '    function primeEpochSeconds(') +
    section('    function primeClosed(', '    function nseSessionMinutesFromEpoch(') +
    section('    function recomputeAiIndicator(', '    function recomputeAllIndicatorsConsensus()') +
    section('    function renderChartIndicatorStatus(', '    function renderAllIndicatorsConsensus()'), context);
  const drawStart = app.indexOf('    function draw()');
  const start = app.indexOf('      const analysisNow =', drawStart);
  const end = app.indexOf('      const analysisKey =', start);
  assert.ok(start > drawStart && end > start);
  const normalization = app.slice(start, end);
  return { state, context,
    run: () => {
      vm.runInContext('(function () {\n' + normalization + '\n' +
        'state.aiIndicatorCandles = indicatorData; recomputeAiIndicator(indicatorData);\n' +
        'this.primeTime = primeClosed(state.data, Number(intervals[state.tf]), analysisNow).candles.at(-1)?.time;\n' +
        'renderChartIndicatorStatus({ confidence: 0, votes: [] });\n}).call(this);', context);
      const rows = nodes.get('#chart-status-rows').children;
      const row = rows.find(row => row.children[0]?.textContent === 'Last closed candle');
      return { chart: row.children[1].textContent, ai: state.aiIndicator, prime: context.primeTime };
    },
    render: () => {
      vm.runInContext('renderChartIndicatorStatus({ confidence: 0, votes: [] });', context);
      return nodes.get('#chart-status-rows').children.find(row =>
        row.children[0]?.textContent === 'Last closed candle').children[1].textContent;
    }
  };
}

test('Replay chart, AI and Prime identify the same completed bar across supported timeframes', () => {
  for (const tf of Object.keys(intervals)) {
    const f = fixture(tf);
    const original = structuredClone(f.state.data);
    const result = f.run();
    const visible = original.at(-1).time;
    assert.equal(result.chart, display(visible), tf);
    assert.equal(result.ai.time, visible, tf);
    assert.equal(result.prime, visible, tf);
    assert.equal(result.ai.signal, 'AI WAIT', 'Missing confirmations are not overridden');
    assert.equal(result.ai.score, 0);
    assert.deepEqual(f.state.data, original, 'Display correction cannot create or mutate bars');
    assert.equal(f.state.aiIndicatorCandles.at(-1).syntheticForming, true);
  }
});

test('stepping 3m Replay advances all timestamps together without reading ahead', () => {
  const f = fixture();
  const source = [...f.state.data,
    { ...f.state.data.at(-1), time: epoch('13:33:00'), close: 110.5 },
    { ...f.state.data.at(-1), time: epoch('13:36:00'), close: 109.5 },
    { ...f.state.data.at(-1), time: epoch('13:39:00'), close: 999999 }];
  for (let index = 220; index <= 222; index++) {
    f.state.data = source.slice(0, index + 1);
    const result = f.run();
    assert.equal(result.chart, display(source[index].time));
    assert.equal(result.ai.time, source[index].time);
    assert.equal(result.prime, source[index].time);
    assert.equal(f.state.aiIndicatorCandles.some(row => row.close === 999999), false,
      'Unseen future source candles cannot influence analysis');
  }
});

test('live chart still excludes a forming bar until its real close', () => {
  const f = fixture('3m', false, epoch('13:31:00'));
  const result = f.run();
  assert.equal(result.chart, display(epoch('13:27:00')));
  assert.equal(result.ai.time, epoch('13:27:00'));
  assert.equal(result.prime, epoch('13:27:00'));
  assert.equal(f.state.aiIndicatorCandles.length, f.state.data.length);
});

test('after-hours view keeps the final genuine session candle and closed-session AI WAIT', () => {
  const f = fixture('3m', false, Date.parse('2026-10-10T12:00:00+05:30') / 1000);
  f.state.data = history(180, epoch('15:27:00'));
  const result = f.run();
  assert.equal(result.chart, display(epoch('15:27:00')));
  assert.equal(result.ai.time, epoch('15:27:00'));
  assert.equal(result.ai.regime, 'MARKET CLOSED');
  assert.equal(result.ai.signal, 'AI WAIT');
  assert.equal(result.ai.confluenceScore, 0);
});

test('missing candles or an invalid timeframe display no invented closed timestamp', () => {
  for (const tf of ['3m', 'invalid']) {
    const f = fixture();
    f.state.tf = tf;
    if (tf === '3m') f.state.data = [];
    assert.equal(f.render(), '—');
  }
});

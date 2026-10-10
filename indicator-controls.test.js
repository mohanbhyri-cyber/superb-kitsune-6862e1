import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { regularNseHours } from './options-context.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function controls() {
  const colors = { Momentum: '#fff', 'EMA 9': '#fff', Volume: '#fff' };
  const state = { overlays: new Set(Object.keys(colors)) };
  const makeNode = dataset => ({ dataset, attrs: {}, textContent: '', on: false,
    setAttribute(name, value) { this.attrs[name] = value; },
    classList: {}
  });
  const nodes = Object.keys(colors).map(name => {
    const node = makeNode({ indicator: name });
    node.classList.toggle = (_name, on) => { node.on = on; };
    return node;
  });
  const all = makeNode({});
  const context = vm.createContext({ state, colors,
    $: selector => { assert.equal(selector, '#indicators-all-toggle'); return all; },
    $$: selector => { assert.equal(selector, '[data-indicator]'); return nodes; }
  });
  const start = app.indexOf('    function activateAllIndicators()');
  const end = app.indexOf('       INDICATOR BUTTONS', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, app.lastIndexOf('    /*', end)), context);
  return { state, nodes, all, run: source => vm.runInContext(source, context) };
}

test('initial all-indicator state agrees with the enabled individual controls', () => {
  const f = controls();
  f.run('syncIndicatorControls();');
  assert.equal(f.all.textContent, 'All indicators: ON');
  assert.equal(f.all.attrs['aria-pressed'], 'true');
  assert.ok(f.nodes.every(node => node.on && node.attrs['aria-pressed'] === 'true'));
  assert.match(app, /\.join\(''\);\s*}\s*syncIndicatorControls\(\);/);
});

test('all-indicator OFF and ON update every overlay and accessible control', () => {
  const f = controls();
  f.run('setAllIndicators(false);');
  assert.equal(f.state.overlays.size, 0);
  assert.equal(f.all.textContent, 'All indicators: OFF');
  assert.equal(f.all.attrs['aria-pressed'], 'false');
  assert.ok(f.nodes.every(node => !node.on && node.attrs['aria-pressed'] === 'false'));
  f.run('setAllIndicators(true);');
  assert.equal(f.state.overlays.size, 3);
  assert.equal(f.all.textContent, 'All indicators: ON');
  assert.ok(f.nodes.every(node => node.on));
});

test('individual choices produce MIXED and refresh synchronization preserves them', () => {
  const f = controls();
  f.state.overlays.delete('Volume');
  f.run('syncIndicatorControls();');
  assert.equal(f.all.textContent, 'All indicators: MIXED');
  assert.equal(f.all.attrs['aria-pressed'], 'mixed');
  f.run('syncIndicatorControls();');
  assert.deepEqual([...f.state.overlays], ['Momentum', 'EMA 9']);
  assert.equal(f.nodes[2].on, false);
  f.run('setAllIndicators(false); syncIndicatorControls();');
  assert.equal(f.state.overlays.size, 0);
  const load = app.slice(app.indexOf('    async function loadData()'),
    app.indexOf('    function activateAllIndicators()'));
  assert.ok(!load.includes('activateAllIndicators();'), 'History/timeframe loading cannot reset choices');
  assert.equal((load.match(/syncIndicatorControls\(\);/g) || []).length, 2);
  const events = app.slice(app.indexOf('       INDICATOR CONTROLS'), app.indexOf("    if ($('#indicators-all-toggle'))"));
  assert.ok(events.includes('syncIndicatorControls();'), 'Individual clicks update the all-indicator label');
});

test('startup diagnostics require existing panels but no longer fail on removed chat UI', () => {
  const start = app.indexOf('    function runSmrtDiagnostics()');
  const end = app.indexOf('    let checkAlerts', start);
  const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  let errors = 0;
  const context = vm.createContext({ document: { getElementById: id => present.has(id) ? {} : null },
    window: { SMRTTradingViewDatafeed: {} }, Date,
    console: { error() { errors++; }, info() {} },
    ...Object.fromEntries(['indicators', 'trendIndicators', 'proScalper', 'analyseNiftyEdge',
      'analyseMarketMap', 'scanCandles', 'finalizeTrade', 'analyseGainzSSL',
      'analyseSmrtAiNifty', 'analyseGlobalWatch', 'analyseAllIndicators',
      'analyseChartConsensus'].map(name => [name, () => {}]))
  });
  vm.runInContext(app.slice(start, end), context);
  const ok = vm.runInContext('runSmrtDiagnostics()', context);
  assert.equal(ok.ok, true);
  assert.equal(errors, 0);
  present.delete('ai-indicator-panel');
  const missing = vm.runInContext('runSmrtDiagnostics()', context);
  assert.equal(missing.ok, false);
  assert.deepEqual(Array.from(missing.missingElements), ['ai-indicator-panel']);
  assert.equal(errors, 1, 'A genuinely missing indicator still fails diagnostics');
});

function sessionGate({ now, replay = false, session = { ready: true, quality: 'GOOD', state: 'NORMAL SESSION' } }) {
  const start = app.indexOf('      const session = legacy.sessionQuality;');
  const end = app.indexOf('      const trigger = legacy.triggerSignal;', start);
  const rows = [];
  vm.runInNewContext(app.slice(start, end), {
    now: Date.parse(now) / 1000, replay, regularNseHours,
    legacy: { sessionQuality: session },
    check: (name, ok, reason, required = true) => rows.push({ name, ok, reason, required })
  });
  return rows;
}

test('Prime live session gate rejects historical open-session context when NSE is closed now', () => {
  for (const now of ['2026-10-10T12:00:00+05:30', '2026-10-09T15:30:00+05:30',
    '2026-10-09T09:14:59+05:30']) {
    const rows = sessionGate({ now });
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, 'NSE session is closed');
    assert.equal(rows[1].ok, false);
  }
});

test('Prime session gate preserves open-session checks and fails closed on unavailable context', () => {
  const now = '2026-10-09T12:00:00+05:30';
  assert.equal(sessionGate({ now })[0].ok, true);
  assert.equal(sessionGate({ now, session: null })[0].ok, false);
  assert.equal(sessionGate({ now, session: { ready: true, quality: 'CLOSED' } })[0].ok, false);
});

test('Replay retains historical session context without claiming a live session', () => {
  const rows = sessionGate({ now: '2026-10-10T12:00:00+05:30', replay: true });
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].required, true);
});

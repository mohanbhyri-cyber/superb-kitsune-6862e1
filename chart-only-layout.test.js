import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function productionFunction(name) {
  const start = app.indexOf('    function ' + name + '(');
  assert.ok(start >= 0, name + ' exists in production');
  let end = app.indexOf('\n    }\n', start);
  while (end > start) {
    const source = app.slice(start, end + 7);
    try {
      new vm.Script('(' + source + ')');
      return source;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      end = app.indexOf('\n    }\n', end + 1);
    }
  }
  assert.fail(name + ' has a complete function body');
}

test('chart-only defaults retain the requested chart and close the settings drawer', () => {
  assert.match(html, /<body class="chart-only">/);
  assert.match(html, /id="chart-options"[^>]*hidden/);
  assert.match(html, /id="tv-indicators-btn"[^>]*aria-controls="chart-options"[^>]*aria-expanded="false"/);
  for (const id of ['chart', 'chart-indicator-status', 'chart-status-rows',
    'chart-view-tv', 'chart-view-classic', 'tv-reset-btn', 'tv-theme-btn',
    'indicators', 'indicators-all-toggle', 'replay-toggle', 'historical-date', 'updated']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' is retained');
  }
  assert.ok(css.includes('body.chart-only > header'));
  assert.ok(css.includes('body.chart-only #terminal > :not(.workspace)'));
  assert.ok(css.includes('body.chart-only #terminal .workspace > aside'));
  assert.ok(css.includes('body.chart-only #terminal .chart-indicator-status'));
  const settings = html.slice(html.indexOf('id="chart-options"'), html.indexOf('<!-- CHART -->'));
  assert.ok(settings.includes('id="signal-alert-switch"'), 'Notification preferences stay reachable in settings');
  assert.ok(settings.includes('id="new-alert"'), 'Existing price-alert controls are not orphaned');
});

function settings() {
  const panel = { hidden: true };
  const button = { attrs: {}, focus() { this.focused = true; },
    setAttribute(name, value) { this.attrs[name] = value; } };
  const close = {};
  const listeners = {};
  const nodes = { '#chart-options': panel, '#tv-indicators-btn': button, '#chart-options-close': close };
  const context = vm.createContext({ $: selector => nodes[selector] || null,
    document: { addEventListener: (event, handler) => { listeners[event] = handler; } } });
  vm.runInContext(productionFunction('setChartOptions'), context);
  const start = app.indexOf("    if (\n      $('#tv-indicators-btn')");
  const end = app.indexOf("    if (\n      $('#tv-reset-btn')", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  return { panel, button, close, listeners };
}

test('Indicators opens and closes the retained controls without changing chart or trading state', () => {
  const f = settings();
  f.button.onclick();
  assert.equal(f.panel.hidden, false);
  assert.equal(f.button.attrs['aria-expanded'], 'true');
  f.button.onclick();
  assert.equal(f.panel.hidden, true);
  assert.equal(f.button.attrs['aria-expanded'], 'false');
  f.button.onclick(); f.close.onclick();
  assert.equal(f.panel.hidden, true);
  assert.equal(f.button.focused, true);
});

test('Escape closes only an open settings drawer and restores button focus', () => {
  const f = settings();
  let prevented = 0;
  const event = key => ({ key, preventDefault() { prevented++; } });
  f.listeners.keydown(event('Escape'));
  assert.equal(prevented, 0);
  f.button.onclick(); f.listeners.keydown(event('Enter'));
  assert.equal(f.panel.hidden, false);
  f.listeners.keydown(event('Escape'));
  assert.equal(f.panel.hidden, true);
  assert.equal(prevented, 1);
  assert.equal(f.button.focused, true);
});

const dashboardRenderers = ['renderWatch', 'renderProSuiteSummary', 'renderTradeFinalizer',
  'renderAiNifty', 'renderAllIndicatorsConsensus', 'renderGlobalWatch', 'renderAiIndicator',
  'renderGainzSSLPanel', 'renderCandleScanner', 'renderPrimeMarket', 'renderSmartMoneyTools',
  'renderBestBuySetup', 'updateMarketMapPanel'];

for (const name of dashboardRenderers) {
  test(name + ' skips dashboard-only DOM work while preserving chart status updates', () => {
    const calls = [];
    const context = vm.createContext({
      document: { body: { classList: { contains: value => value === 'chart-only' } } },
      state: { allIndicatorsConsensus: { signal: 'NO TRADE' } },
      $: () => { throw new Error('Hidden dashboard DOM must not be updated'); },
      renderChartIndicatorStatus: value => { calls.push(['status', value.signal]); },
      renderChartGlobalMarkets: () => { calls.push(['global']); }
    });
    vm.runInContext(productionFunction(name) + '\nthis.run = ' + name + ';', context);
    context.run();
    assert.deepEqual(calls, name === 'renderAllIndicatorsConsensus' ? [['status', 'NO TRADE']]
      : name === 'renderGlobalWatch' ? [['global']] : []);
  });
}

test('chart-only mode does not add a bypass to signal, confirmation or freshness calculations', () => {
  for (const name of ['draw', 'refreshPrimeConfirmation', 'refreshLiveTradeFinalizer',
    'recomputeAiIndicator', 'recomputeAllIndicatorsConsensus']) {
    assert.equal(productionFunction(name).includes("contains('chart-only')"), false, name);
  }
});

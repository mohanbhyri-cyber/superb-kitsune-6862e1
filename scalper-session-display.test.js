import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('    function renderScalper(');
const end = app.indexOf('      if (!enabled)', start);
assert.ok(start >= 0 && end > start);
const display = app.slice(start, end) + '}';

function render({ open = false, replay = false, enabled = true, tf = '5m' } = {}) {
  const nodes = new Map();
  const state = { tf, replay: { active: replay }, scalps: [{
    direction: 1, signal: 'Buy', time: 1792144200,
    ema: 1, rsi: 60, entry: 100, stop: 95, target: 110
  }] };
  const context = vm.createContext({ state, scalpEnabled: enabled, scalpAlerts: false,
    isNseCashMarketOpen: () => open, fmt: value => String(value),
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); }
  });
  vm.runInContext(display + '\nrenderScalper({}, {});', context);
  return { nodes, state, render: () => vm.runInContext('renderScalper({}, {});', context) };
}

test('closed session never shows an old scalper plan as live levels', () => {
  const f = render();
  assert.match(f.nodes.get('#scalp-state').textContent, /MARKET CLOSED/);
  assert.match(f.nodes.get('#scalp-setup').textContent, /no live setup/);
  assert.equal(f.nodes.get('#scalp-state').className, 'muted');
  for (const key of ['entry', 'stop', 'target']) assert.equal(f.nodes.get('#scalp-' + key).textContent, '—');
});

test('Replay levels remain explicitly historical and are cleared when Replay ends after hours', () => {
  const f = render({ replay: true });
  assert.match(f.nodes.get('#scalp-setup').textContent, /REPLAY · historical levels/);
  assert.equal(f.nodes.get('#scalp-entry').textContent, '100');
  f.state.replay.active = false; f.render();
  assert.equal(f.nodes.get('#scalp-entry').textContent, '—');
});

test('open-session scalper display retains existing levels; disabled and unsupported modes hide them', () => {
  const f = render({ open: true });
  assert.match(f.nodes.get('#scalp-setup').textContent, /live-session levels/);
  assert.equal(f.nodes.get('#scalp-state').textContent, 'BUY conditions aligned');
  assert.equal(f.nodes.get('#scalp-target').textContent, '110');
  for (const options of [{ enabled: false }, { tf: '15m' }]) {
    assert.equal(render({ open: true, ...options }).nodes.get('#scalp-entry').textContent, '—');
  }
});

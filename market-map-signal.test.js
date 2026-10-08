import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const panelStart = app.indexOf('function updateMarketMapPanel()');
const start = app.indexOf('    const finalizer =', panelStart);
const end = app.indexOf('    // FINAL CONFLUENCE SCORE', start);
assert.ok(panelStart >= 0 && start > panelStart && end > start);
const signalBlock = app.slice(start, end);

function render({ side = 0, primeConfirmed = true, primeSide = side,
  consensusSide = side, open = true, replay = false, reasons = [] } = {}) {
  const rows = {};
  const direction = side === 1 ? 'BUY' : side === -1 ? 'SELL' : 'NO TRADE';
  vm.runInNewContext(signalBlock, {
    state: {
      tradeFinalizer: { state: direction, primeConfirmed, reasons },
      primeMarket: { side: primeSide },
      allIndicatorsConsensus: { signal: consensusSide === 1 ? 'BUY' : consensusSide === -1 ? 'SELL' : 'NO TRADE' },
      replay: { active: replay }
    },
    primeSide: value => /BUY/.test(value) ? 1 : /SELL/.test(value) ? -1 : 0,
    isNseCashMarketOpen: () => open,
    set: (selector, value, className) => { rows[selector] = { value, className }; }
  });
  return rows;
}

test('Market Map signal card appears exactly once in the Market Map panel', () => {
  assert.equal((html.match(/id="market-map-signal"/g) || []).length, 1);
  const panel = html.slice(html.indexOf('id="market-map-panel"'), html.indexOf('id="candle-scanner-panel"'));
  assert.match(panel, /WAIT \/ BUY \/ SELL/);
  assert.match(panel, /id="market-map-signal" class="muted">WAIT</);
  assert.ok(panel.indexOf('id="market-map-signal"') < panel.indexOf('id="market-map-support"'));
});

test('confirmed BUY and SELL use their existing aligned direction and colors', () => {
  for (const [side, value, color] of [[1, 'BUY', 'up'], [-1, 'SELL', 'down']]) {
    const rows = render({ side });
    assert.deepEqual(rows['#market-map-signal'], { value, className: color });
    assert.equal(rows['#market-map-action'].value, value);
  }
});

test('neutral, blocked, opposing or missing confirmation remains WAIT', () => {
  for (const options of [{}, { side: 1, primeConfirmed: false },
    { side: -1, primeSide: 1 }, { side: 1, consensusSide: -1 },
    { side: 1, primeSide: 0 }, { side: -1, consensusSide: 0 }]) {
    assert.deepEqual(render(options)['#market-map-signal'], { value: 'WAIT', className: 'muted' });
  }
  assert.equal(render({ reasons: ['Volume unavailable'] })['#market-map-signal-reason'].value, 'Volume unavailable');
});

test('market close suppresses even a previously confirmed direction', () => {
  const rows = render({ side: -1, open: false });
  assert.equal(rows['#market-map-signal'].value, 'WAIT');
  assert.equal(rows['#market-map-signal-context'].value, 'Market closed · no live signal');
});

test('Replay can display a confirmed historical direction but is explicitly labeled', () => {
  const rows = render({ side: -1, open: false, replay: true });
  assert.equal(rows['#market-map-signal'].value, 'SELL');
  assert.equal(rows['#market-map-signal-context'].value, 'Replay · completed candles · not a live signal');
});

test('warm-up branch clears an old signal rather than leaving BUY or SELL stale', () => {
  const start = app.indexOf('      if (!map) {', panelStart);
  const end = app.indexOf('        return;', start);
  const rows = {};
  vm.runInNewContext(app.slice(start + '      if (!map) {'.length, end), {
    set: (selector, value, className) => { rows[selector] = { value, className }; }
  });
  assert.deepEqual(rows['#market-map-signal'], { value: 'WAIT', className: 'muted' });
  assert.equal(rows['#market-map-signal-context'].value, 'Waiting for closed-candle data');
});

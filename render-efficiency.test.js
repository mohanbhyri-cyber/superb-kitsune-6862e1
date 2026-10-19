import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

function scheduler() {
  const start = app.indexOf('    let liveRenderTimer =');
  const end = app.indexOf('    function draw() {', start);
  assert.ok(start >= 0 && end > start);
  const timers = new Map(), frames = new Map(), events = [];
  let id = 0;
  const context = vm.createContext({
    performance: { now: () => 1000 },
    setTimeout: fn => { const key = id++; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { const key = id++; frames.set(key, fn); return key; },
    cancelAnimationFrame: key => frames.delete(key),
    draw: () => events.push('draw'), summary: () => events.push('summary')
  });
  vm.runInContext(app.slice(start, end) +
    '\nthis.schedule = scheduleLiveRender; this.cancel = cancelScheduledRender;', context);
  const flush = queue => {
    const batch = [...queue.values()]; queue.clear();
    for (const callback of batch) callback();
  };
  return { timers, frames, events, schedule: context.schedule, cancel: context.cancel,
    flushTimers: () => flush(timers), flushFrames: () => flush(frames) };
}

test('a queued animation frame absorbs repeated normal display requests', () => {
  const f = scheduler();
  f.schedule(); f.flushTimers();
  for (let i = 0; i < 100; i++) f.schedule();
  f.flushTimers(); f.flushFrames();
  assert.deepEqual(f.events, ['draw', 'summary']);
  assert.equal(f.timers.size, 0);
});

test('a forced display update replaces an already queued animation frame', () => {
  const f = scheduler();
  f.schedule(); f.flushTimers();
  f.schedule(true); f.flushTimers(); f.flushFrames();
  assert.deepEqual(f.events, ['draw', 'summary']);
});

test('cancellation removes a queued chart frame as well as its timer', () => {
  const f = scheduler();
  f.schedule(); f.flushTimers(); f.cancel(); f.flushFrames();
  assert.deepEqual(f.events, []);
  const timer = scheduler();
  timer.schedule(); timer.cancel(); timer.flushTimers(); timer.flushFrames();
  assert.deepEqual(timer.events, [], 'Timer handle zero is valid too');
});

test('a stale cancelled frame cannot draw or release a newer pending frame', () => {
  const f = scheduler();
  f.schedule(); f.flushTimers();
  const stale = [...f.frames.values()][0];
  f.schedule(true); f.flushTimers(); stale();
  assert.deepEqual(f.events, []);
  f.schedule(); f.flushTimers(); f.flushFrames();
  assert.deepEqual(f.events, ['draw', 'summary']);
});

function watchFixture() {
  let price = 22000;
  const writes = { watch: 0, ticker: 0 };
  const element = key => {
    let html = '';
    return { get innerHTML() { return html; },
      set innerHTML(value) { html = value; writes[key]++; } };
  };
  const nodes = { '#watch-rows': element('watch'), '#ticker': element('ticker') };
  const helper = app.indexOf('    function setMarkupIfChanged(');
  const helperEnd = app.indexOf('    function toast(', helper);
  const start = app.indexOf('    function renderWatch() {');
  const end = app.indexOf('    function refreshProSuite()', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    $: selector => nodes[selector],
    state: { filter: 'all', symbol: 'NIFTY', quotes: {} },
    instruments: [{ id: 'NIFTY', name: 'NIFTY 50', description: 'Nifty Index', kind: 'INDEX' }],
    quote: () => price, change: () => 1.25, fmt: value => value.toFixed(2),
    formatChange: value => value + '%'
  });
  vm.runInContext((helper >= 0 ? app.slice(helper, helperEnd) : '') +
    app.slice(start, end) + '\nthis.render = renderWatch;', context);
  return { writes, nodes, state: context.state, render: context.render,
    price: value => { price = value; } };
}

test('100 unchanged watch/ticker renders perform two subtree writes, not 200', () => {
  const f = watchFixture();
  for (let i = 0; i < 100; i++) f.render();
  assert.deepEqual(f.writes, { watch: 1, ticker: 1 });
});

test('genuine price and filter changes still update their display immediately', () => {
  const f = watchFixture();
  f.render(); f.price(22012.5); f.render();
  assert.deepEqual(f.writes, { watch: 2, ticker: 2 });
  assert.match(f.nodes['#watch-rows'].innerHTML, /22012\.50/);
  f.state.filter = 'fo'; f.render();
  assert.equal(f.nodes['#watch-rows'].innerHTML, '');
  assert.deepEqual(f.writes, { watch: 3, ticker: 2 });
  f.state.filter = 'all'; f.render();
  assert.deepEqual(f.writes, { watch: 4, ticker: 2 });
});

test('display deduplication restores externally changed content instead of serving a stale cache', () => {
  const f = watchFixture();
  f.render(); f.nodes['#watch-rows'].innerHTML = 'Changed elsewhere'; f.render();
  assert.match(f.nodes['#watch-rows'].innerHTML, /NIFTY 50/);
  assert.deepEqual(f.writes, { watch: 3, ticker: 1 });
});

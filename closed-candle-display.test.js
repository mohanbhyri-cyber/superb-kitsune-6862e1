import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const epoch = clock => Date.parse('2026-10-12T' + clock + '+05:30') / 1000;
const now = epoch('09:43:00');
const helpers = app.slice(app.indexOf('    function primeFinite('),
  app.indexOf('    function primeEpochSeconds('));
const renderStart = app.indexOf('    function renderPrimeMarket()');
const renderPrefix = app.slice(renderStart, app.indexOf("      add('h2', 'Prime Market Confirmation');", renderStart));

function fixture(time) {
  const panel = { children: [], replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); } };
  const context = vm.createContext({
    state: { tf: '3m', primeMarket: time === undefined ? null : { time } },
    intervals: { '3m': 180 }, Intl,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now * 1000])); }
      static now() { return now * 1000; }
    },
    document: { getElementById: () => panel, createElement: () => ({ style: {} }) }
  });
  vm.runInContext(helpers + renderPrefix + '\n}\nrenderPrimeMarket();', context);
  return { status: panel.children[0].textContent, context };
}

test('missing and invalid candle timestamps show unavailable, not epoch age or current data', () => {
  for (const time of [undefined, null, '', NaN, 0, -1, epoch('09:42:00')]) {
    assert.equal(fixture(time).status,
      'CLOSED-CANDLE DATA UNAVAILABLE · WAIT · NO LIVE TRADE');
  }
});

test('freshness is measured from the completed candle end, not its start', () => {
  const f = fixture(epoch('09:39:00'));
  assert.equal(f.status, 'MARKET OPEN · CLOSED-CANDLE DATA CURRENT');
  const timing = vm.runInContext("closedCandleTiming(state.primeMarket.time, 180)", f.context);
  assert.equal(timing.start, epoch('09:39:00'));
  assert.equal(timing.end, epoch('09:42:00'));
  assert.equal(timing.ageSeconds, 60);
  assert.match(fixture(epoch('09:15:00')).status, /Last closed candle 25 min old/);
});

test('a forming candle has no invented completed timestamp', () => {
  const f = fixture(epoch('09:39:00'));
  assert.equal(vm.runInContext(`closedCandleTiming(${epoch('09:42:00')}, 180)`, f.context), null);
  assert.equal(vm.runInContext(`closedCandleTiming(${epoch('09:39:00')}, 0)`, f.context), null);
});

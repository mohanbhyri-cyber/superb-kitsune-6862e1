import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { liveCandleBucket, liveCandleRejectionReason } from './nse-candle-time.js';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const epoch = clock => Date.parse('2026-10-09T' + clock + '+05:30') / 1000;

function controls() {
  const state = { tf: '5m', symbol: 'NIFTY', data: [{ time: epoch('12:00:00') }],
    replay: { active: false } };
  const buttons = ['main', 'chart'].flatMap(toolbar =>
    ['1m', '3m', '5m', '15m'].map(tf => ({ toolbar, dataset: { tf }, active: false,
      classList: { toggle(_name, active) { buttons.find(b => b.classList === this).active = active; } }
    })));
  const calls = { loads: 0, exits: 0, toasts: 0 };
  const context = vm.createContext({ state, loadedHistoryKey: 'NIFTY:5m', startPoint: 10,
    $$: selector => { assert.equal(selector, '[data-tf]'); return buttons; },
    loadData: () => { calls.loads++; },
    exitReplay: value => { assert.equal(value, false); state.replay.active = false; calls.exits++; },
    toast: () => { calls.toasts++; } });
  const start = app.indexOf('    function syncTimeframeButtons()');
  const end = app.indexOf('       REPLAY CONTROLS', start);
  const source = app.slice(start, app.lastIndexOf('    /*', end));
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source, context);
  return { state, buttons, calls, context,
    selected: () => buttons.filter(b => b.active).map(b => b.toolbar + ':' + b.dataset.tf) };
}

function status(includeFooter = true) {
  let clock = 100000;
  const state = {};
  const el = { textContent: '' };
  const header = { textContent: '', title: '', dataset: {} };
  const context = { state, Date: { now: () => clock }, document: { hidden: false }, $: selector => {
    if (selector === '#header-feed-status') return header;
    assert.equal(selector, '#updated'); return includeFooter ? el : null;
  },
    formatISTTime: () => '12:00:00' };
  const start = app.indexOf('    function setFeedStatus(');
  const end = app.indexOf('    function renderWatch()', start);
  vm.runInNewContext(app.slice(start, end) + '\nthis.set = setFeedStatus; this.tick = refreshFeedRetryCountdown;', context);
  return { state, el, header, set: context.set, tick: context.tick, document: context.document,
    advance: ms => { clock += ms; } };
}

function watchDisplay(price) {
  const watch = { innerHTML: '' }, ticker = { innerHTML: '' };
  const context = vm.createContext({
    state: { symbol: 'NIFTY', filter: 'all', quotes: {} },
    instruments: [{ id: 'NIFTY', name: 'NIFTY 50', kind: 'INDEX' }],
    $: selector => selector === '#watch-rows' ? watch : ticker,
    quote: () => price, change: () => null, formatChange: () => '—'
  });
  const start = app.indexOf('    const fmt = n => {');
  const end = app.indexOf('    const read =', start);
  vm.runInContext(app.slice(start, end), context);
  const markupStart = app.indexOf('    function setMarkupIfChanged(');
  const markupEnd = app.indexOf('    function toast(', markupStart);
  assert.ok(markupStart >= 0 && markupEnd > markupStart);
  vm.runInContext(app.slice(markupStart, markupEnd), context);
  const renderStart = app.indexOf('    function renderWatch()');
  const renderEnd = app.indexOf('    function refreshProSuite()', renderStart);
  vm.runInContext(app.slice(renderStart, renderEnd) + '\nrenderWatch();', context);
  return [watch.innerHTML, ticker.innerHTML];
}

test('header follows the actual feed state and exposes retry details, not a permanent LIVE claim', () => {
  const f = status();
  for (const feed of ['LOADING', 'RECONNECTING', 'DATA UNAVAILABLE', 'STALE', 'FALLBACK', 'LIVE', 'REPLAY', 'CLOSED']) {
    f.set(feed, 'Current feed details');
    assert.equal(f.header.textContent, '● ' + (feed === 'CLOSED' ? 'MARKET CLOSED' : feed) + ' · UPSTOX');
    assert.equal(f.header.dataset.feedStatus, feed);
    assert.equal(f.header.title, 'Current feed details');
  }
  f.set('LIVE');
  assert.equal(f.header.title, '', 'Clear old cooldown details on recovery');
});

test('header updates even if the footer is absent and starts with an honest loading label', () => {
  const f = status(false);
  f.set('RECONNECTING', 'Upstox cooling down');
  assert.equal(f.header.textContent, '● RECONNECTING · UPSTOX');
  const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(index, /id="header-feed-status"[^>]*>● LOADING · UPSTOX/);
  assert.ok(!index.includes('UPSTOX LIVE MARKET'));
});

test('missing prices stay unavailable in the ticker and watchlist instead of becoming zero', () => {
  for (const price of [null, undefined, NaN, Infinity, '']) {
    for (const html of watchDisplay(price)) {
      assert.ok(!html.includes('0.00'));
      assert.match(html, /—/);
    }
  }
});

test('real numeric prices retain Indian decimal formatting, including numeric zero', () => {
  for (const [price, display] of [[25432.5, '25,432.50'], [0, '0.00']]) {
    for (const html of watchDisplay(price)) assert.ok(html.includes(display));
  }
});

test('both timeframe toolbars show the initial selected timeframe', () => {
  assert.deepEqual(controls().selected(), ['main:5m', 'chart:5m']);
});

test('new page loads default to the requested 1m chart without changing MTF confirmation frames', () => {
  assert.match(app, /\btf:\s*'1m'/);
  assert.doesNotMatch(app, /\btf:\s*'5m'/);
  const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.equal((index.match(/data-tf="1m"\s+class="active"/g) || []).length, 2);
  assert.doesNotMatch(index, /data-tf="5m"\s+class="active"/);
  assert.ok(app.includes("refreshMTF(requestedFrames = ['5m', '15m', '1h'])"));
});

test('clicking either toolbar synchronizes both and loads the new timeframe once', () => {
  for (const toolbar of ['main', 'chart']) {
    const f = controls();
    f.buttons.find(b => b.toolbar === toolbar && b.dataset.tf === '3m').onclick();
    assert.equal(f.state.tf, '3m');
    assert.deepEqual(f.selected(), ['main:3m', 'chart:3m']);
    assert.equal(f.calls.loads, 1);
    assert.equal(f.context.startPoint, null);
  }
});

test('selecting an already loaded timeframe does not interrupt live quotes or reload history', () => {
  const f = controls();
  for (const b of f.buttons.filter(b => b.dataset.tf === '5m')) b.onclick();
  assert.equal(f.calls.loads, 0);
  assert.deepEqual(f.selected(), ['main:5m', 'chart:5m']);
  // Missing history must still be recoverable by an explicit user click.
  f.state.data = [];
  f.buttons.find(b => b.dataset.tf === '5m').onclick();
  assert.equal(f.calls.loads, 1);
});

test('Replay exit and unsupported timeframe checks are preserved', () => {
  const f = controls();
  f.state.replay.active = true;
  f.buttons.find(b => b.dataset.tf === '5m').onclick();
  assert.equal(f.calls.exits, 1);
  assert.equal(f.calls.loads, 1);
  f.buttons[0].dataset.tf = 'invalid';
  f.buttons[0].onclick();
  assert.equal(f.calls.loads, 1);
  assert.equal(f.calls.toasts, 1);
});

test('STALE explains missing, late, future, ineligible and out-of-session timestamps', () => {
  const now = epoch('12:00:00');
  for (const time of [null, undefined, '', NaN, 0, -1]) {
    assert.match(liveCandleRejectionReason({ time }, 180, now), /no valid provider timestamp/);
  }
  assert.match(liveCandleRejectionReason({ time: now - 31 }, 180, now), /31s old.*maximum 30s/);
  assert.match(liveCandleRejectionReason({ time: now + 6 }, 180, now), /6s ahead.*maximum 5s/);
  assert.match(liveCandleRejectionReason({ time: now, candleEligible: false }, 180, now), /not eligible/);
  assert.match(liveCandleRejectionReason({ time: epoch('16:00:00') }, 180, now), /outside NSE regular hours/);
  assert.match(liveCandleRejectionReason({ time: now - 86400 }, 180, now), /different NSE session/);
  assert.match(liveCandleRejectionReason({ time: epoch('16:00:00') }, 180, epoch('16:00:00')), /session is closed/);
  assert.match(liveCandleRejectionReason({ time: now }, 0, now), /interval is invalid/);
});

test('diagnostic text agrees with unchanged live-candle eligibility at every safety boundary', () => {
  for (const now of [epoch('09:14:59'), epoch('09:15:00'), epoch('12:00:00'),
    epoch('15:29:59'), epoch('15:30:00'),
    Date.parse('2026-10-10T12:00:00+05:30') / 1000]) {
    for (const seconds of [60, 180, 300, 900, 3600, 0, NaN, 86400]) {
      for (const tick of [{}, { time: null }, { time: now - 86400 },
        { time: now - 31 }, { time: now - 30 }, { time: now }, { time: now + 5 },
        { time: now + 6 }, { time: now, candleEligible: false }]) {
        assert.equal(Boolean(liveCandleRejectionReason(tick, seconds, now)),
          liveCandleBucket(tick, seconds, now) === null);
      }
    }
  }
});

test('feed labels retain separate candle-history cooldown or retry details while quotes update', () => {
  const f = status();
  const detail = 'Quotes updating · candle history cooldown 72s';
  f.set('LIVE', detail);
  assert.equal(f.state.feedStatus, 'LIVE');
  assert.match(f.el.textContent, /LIVE.*12:00:00 IST/);
  assert.ok(f.el.textContent.endsWith(detail));
  f.set('FALLBACK', 'Quotes updating · Candle history retry pending');
  assert.equal(f.state.feedStatus, 'FALLBACK');
  assert.match(f.el.textContent, /FALLBACK.*Candle history retry pending/);
  f.set('LIVE');
  assert.equal(f.el.textContent, '● LIVE · UPSTOX · 12:00:00 IST');
});

test('feed labels show the exact stale reason and keep market-closed status distinct', () => {
  const f = status();
  const reason = liveCandleRejectionReason({ time: null }, 180, epoch('12:00:00'));
  f.set('STALE', reason);
  assert.equal(f.state.feedStatus, 'STALE');
  assert.equal(f.el.textContent, '● STALE · ' + reason);
  f.set('CLOSED', reason);
  assert.equal(f.el.textContent, '● MARKET CLOSED · LAST SESSION DATA');
});

test('app imports the diagnostic helper with a fresh cache key and uses the same quote clock', () => {
  assert.match(app, /liveCandleRejectionReason.*nse-candle-time.js\?v=2/);
  assert.ok(app.includes('liveCandleBucket(tick, seconds, quoteNow)'));
  assert.ok(app.includes('liveCandleRejectionReason(tick, seconds, quoteNow)'));
  const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('app.js?v=126'));
  assert.ok(index.includes('style.css?v=82'));
  assert.ok(app.includes("'./candle-refresh-schedule.js?v=2'"));
  assert.ok(app.includes("'./market.js?v=12'"));
});

test('retry countdown decreases locally without renewing the original deadline', () => {
  const f = status();
  const retry = { until: 105000, reason: 'One-time feed migration safety pause.', suffix: ' · chart preserved' };
  f.set('RECONNECTING', '', retry);
  assert.match(f.el.textContent, /migration safety pause.*retrying in 5s.*chart preserved/);
  f.advance(2200); f.tick();
  assert.match(f.el.textContent, /retrying in 3s/);
  assert.equal(f.state.feedRetry.until, 105000);
  assert.match(f.header.title, /migration safety pause.*3s/);
  f.advance(2800); f.tick();
  assert.match(f.el.textContent, /retry pending/);
  assert.doesNotMatch(f.el.textContent, /0s|LIVE|cooling down/);
});

test('hidden countdown catches up on visibility without replay mutations', () => {
  const f = status();
  f.set('RECONNECTING', '', { until: 110000, reason: 'Provider rate limit' });
  f.document.hidden = true;
  f.advance(6000); f.tick();
  assert.match(f.el.textContent, /10s/);
  f.document.hidden = false; f.tick();
  assert.match(f.el.textContent, /4s/);
  f.state.replay = { active: true };
  f.advance(3000); f.tick();
  assert.match(f.el.textContent, /4s/);
});

test('recovered, closed and replay states clear old retry details', () => {
  for (const next of ['LIVE', 'FALLBACK', 'CLOSED', 'REPLAY', 'LOADING']) {
    const f = status();
    f.set('RECONNECTING', '', { until: 110000, reason: 'Provider rate limit' });
    f.set(next);
    const text = f.el.textContent;
    f.advance(10000); f.tick();
    assert.equal(f.el.textContent, text);
    assert.equal(f.state.feedRetry, null);
    assert.equal(f.header.title, '');
  }
});

test('countdown cannot advance the LIVE or FALLBACK last-update clock', () => {
  for (const next of ['LIVE', 'FALLBACK']) {
    const f = status();
    f.set(next, 'Quotes updating · history retry pending');
    const text = f.el.textContent;
    f.advance(20000); f.tick();
    assert.equal(f.el.textContent, text);
  }
});

test('header countdown still updates without the footer', () => {
  const f = status(false);
  f.set('RECONNECTING', '', { until: 110000, reason: 'Provider rate limit' });
  f.advance(4000); f.tick();
  assert.match(f.header.title, /6s/);
});

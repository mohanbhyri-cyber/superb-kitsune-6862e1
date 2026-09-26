import { momentumSignals } from './momentum.js';
import { trendIndicators } from './trend-indicators.js';
import { proScalper } from './pro-scalper.js';
import { SignalAlertTracker } from './signal-alerts.js';
import { priceAction } from './price-action.js';
import {
  analyseNiftyEdge
} from './smrt-nifty-edge.js';
import { analyseMarketMap } from './smrt-market-map.js';
import {
  scanCandles,
  candleConfluence
} from './smrt-candle-scanner.js';
import { finalizeTrade } from './smrt-trade-finalizer.js';
import { analyseGainzSSL } from './smrt-gainz-ssl-combo.js';
import {
  analyseProSuite
} from './pro-suite.js';
import {
  analyseSmrtAiNifty
} from './smrt-ai-nifty.js';
import {
  analyseGlobalWatch
} from './smrt-global-watch.js';
import {
  analyseAllIndicators
} from './smrt-all-indicators.js';
import {
  analyseChartConsensus
} from './smrt-chart-consensus.js';
import {
  createTradingViewDatafeed
} from './tradingview-datafeed.js';

import {
  API_BASE,
  instruments,
  intervals,
  indicators,
  market,
  strideSignals
} from './market.js';


window.SMRTTradingViewDatafeed =
  createTradingViewDatafeed(
    API_BASE
  );

window.SMRTTradingViewDatafeedStatus =
  'READY · UPSTOX';

setTimeout(
  () => {
    if (
      !window.TradingView?.widget
    ) {
      const statusEl =
        document.querySelector(
          '#tradingview-datafeed-status'
        );

      if (statusEl) {
        statusEl.textContent =
          'TradingView Lightweight · Upstox';
      }
    }
  },
  0
);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// PRIME MARKET ENGINE — original, deterministic price-action rules.
// No proprietary ChartPrime code. OHLCV pressure is a proxy, not order flow.
// Pivots become usable only after three right-hand candles have closed.
function primeFinite(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

function primeSide(value) {
  const s = String(value || '').toUpperCase().trim();
  if (/NO TRADE|WAIT|MIXED|UNAVAILABLE|NOT READY/.test(s)) return 0;
  const up = /\b(BUY|LONG|BULLISH)\b/.test(s);
  const down = /\b(SELL|SHORT|BEARISH)\b/.test(s);
  return up === down ? 0 : up ? 1 : -1;
}

function primeClosed(data, seconds, now) {
  if (!Array.isArray(data) || data.length < 2 || !(seconds > 0) || !primeFinite(now)) {
    return { candles: [], error: 'Missing candle data or timeframe' };
  }
  // Keep the app's penultimate-candle convention. Never duplicate a live bar.
  const candles = data.slice(0, -1).map(c => ({ ...c }));
  let previous = -Infinity;
  for (const c of candles) {
    if (!['time', 'open', 'high', 'low', 'close'].every(k => primeFinite(c[k]))) {
      return { candles: [], error: 'Invalid OHLC or timestamp' };
    }
    for (const k of ['time', 'open', 'high', 'low', 'close']) c[k] = Number(c[k]);
    if (c.time <= previous || c.time + seconds > now || c.low <= 0 ||
        c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) {
      return { candles: [], error: 'Unclosed, unordered or inconsistent candles' };
    }
    previous = c.time;
  }
  return { candles, error: null };
}

function primeStructure(candles) {
  const swings = [], events = [], blocks = [], gaps = [], sweeps = [];
  let high = null, low = null, direction = 0, atr = null;
  const atrs = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], previous = candles[i - 1];
    const tr = previous ? Math.max(c.high - c.low, Math.abs(c.high - previous.close),
      Math.abs(c.low - previous.close)) : c.high - c.low;
    atr = atr === null ? tr : (atr * 13 + tr) / 14;
    atrs.push(atr);
    // Existing zones must survive the current candle before they can confirm it.
    for (const z of [...blocks, ...gaps]) {
      if (!z.active) continue;
      const invalid = z.kind === 'FVG'
        ? (z.side === 1 ? c.low <= z.low : c.high >= z.high)
        : (z.side === 1 ? c.close < z.low : c.close > z.high);
      if (invalid || i - z.created > 100) {
        z.active = false;
        z.status = invalid ? (z.kind === 'FVG' ? 'FILLED' : 'INVALIDATED') : 'EXPIRED';
      } else if (c.low <= z.high && c.high >= z.low) {
        z.touched = i;
        z.status = 'MITIGATED';
      }
    }
    const p = i - 3;
    if (p >= 3) {
      const pivot = candles[p];
      const neighbors = candles.slice(p - 3, i + 1).filter((_, j) => j !== 3);
      if (neighbors.every(b => pivot.high > b.high)) {
        const label = !high ? 'H' : pivot.high > high.price ? 'HH' : pivot.high < high.price ? 'LH' : 'EH';
        high = { price: pivot.high, index: p, time: pivot.time, confirmedAt: c.time, label, broken: false, swept: false };
        swings.push({ ...high, type: 'HIGH' });
      }
      if (neighbors.every(b => pivot.low < b.low)) {
        const label = !low ? 'L' : pivot.low > low.price ? 'HL' : pivot.low < low.price ? 'LL' : 'EL';
        low = { price: pivot.low, index: p, time: pivot.time, confirmedAt: c.time, label, broken: false, swept: false };
        swings.push({ ...low, type: 'LOW' });
      }
    }
    for (const [level, side] of [[high, 1], [low, -1]]) {
      if (!level || level.broken) continue;
      const swept = side === 1 ? c.high > level.price && c.close < level.price
        : c.low < level.price && c.close > level.price;
      if (swept && !level.swept) {
        sweeps.push({ side: -side, index: i, time: c.time, price: level.price });
        level.swept = true;
      }
      const broken = side === 1 ? c.close > level.price : c.close < level.price;
      if (!broken) continue;
      level.broken = true;
      const reversal = direction !== 0 && direction !== side;
      const displacement = atr > 0 && Math.abs(c.close - c.open) >= 0.8 * atr &&
        Math.sign(c.close - c.open) === side;
      events.push({ type: reversal ? 'CHoCH' : 'BOS', side, index: i, time: c.time,
        level: level.price, displacement });
      // MSS is a CHoCH with a same-candle displacement close through the swing.
      if (reversal && displacement) events.push({ type: 'MSS', side, index: i, time: c.time, level: level.price, displacement });
      direction = side;
      if (displacement) {
        for (let j = i - 1; j >= Math.max(level.index, i - 12); j--) {
          const b = candles[j];
          if (Math.sign(b.close - b.open) === -side) {
            blocks.push({ kind: side === 1 ? 'DEMAND / OB' : 'SUPPLY / OB', side,
              low: b.low, high: b.high, origin: b.time, created: i, time: c.time,
              active: true, status: 'FRESH', touched: null });
            break;
          }
        }
      }
    }
    if (i >= 2) {
      const a = candles[i - 2], middle = candles[i - 1];
      // Require displacement and contiguous bars: overnight/session gaps are not FVGs.
      const contiguous = c.time - middle.time === middle.time - a.time;
      const strong = Math.abs(middle.close - middle.open) >= 0.8 * atrs[i - 1];
      const side = c.low > a.high && middle.close > middle.open ? 1
        : c.high < a.low && middle.close < middle.open ? -1 : 0;
      if (contiguous && strong && side && (side === 1 ? c.low - a.high : a.low - c.high) >= 0.1 * atr) {
        gaps.push({ kind: 'FVG', side, low: side === 1 ? a.high : c.high,
          high: side === 1 ? c.low : a.low, created: i, time: c.time,
          active: true, status: 'FRESH', touched: null });
      }
    }
  }
  const last = candles.at(-1), span = high && low ? high.price - low.price : 0;
  const position = span > 0 ? (last.close - low.price) / span : null;
  const zone = position === null ? 'UNAVAILABLE' : position > 1 || position < 0 ? 'OUTSIDE RANGE'
    : position < 0.45 ? 'DISCOUNT' : position > 0.55 ? 'PREMIUM' : 'EQUILIBRIUM';
  return { direction, high, low, swings, events, blocks, gaps, sweeps, atr,
    zone, position, equilibrium: span > 0 ? (high.price + low.price) / 2 : null };
}

function primeTechnical(candles) {
  if (candles.length < 220) return { side: 0, error: 'Need 220 closed candles for EMA 200 and momentum warm-up' };
  const calc = indicators(candles), trend = trendIndicators(candles), i = candles.length - 1;
  const values = Object.fromEntries(['e9', 'e21', 'e50', 'e200', 'rsi', 'hist', 'vwap'].map(k => [k, calc[k]?.[i]]));
  for (const k of ['direction', 'adx', 'plusDI', 'minusDI']) values[k] = trend[k]?.[i];
  // MTF trend can be inspected without volume, but base execution requires VWAP below.
  const needed = ['e9', 'e21', 'e50', 'e200', 'rsi', 'hist', 'direction', 'adx', 'plusDI', 'minusDI'];
  if (!needed.every(k => primeFinite(values[k]))) return { side: 0, values, error: 'Indicator values unavailable' };
  const v = values, close = candles[i].close;
  const bull = close > v.e9 && v.e9 > v.e21 && v.e21 > v.e50 && v.e50 > v.e200 &&
    v.direction === 1 && v.adx >= 22 && v.plusDI > v.minusDI && v.rsi >= 52 && v.rsi <= 68 && v.hist > 0;
  const bear = close < v.e9 && v.e9 < v.e21 && v.e21 < v.e50 && v.e50 < v.e200 &&
    v.direction === -1 && v.adx >= 22 && v.minusDI > v.plusDI && v.rsi <= 48 && v.rsi >= 32 && v.hist < 0;
  return { side: bull ? 1 : bear ? -1 : 0, values, error: null };
}

function analysePrimeMarket({ data, seconds, now, mtfData = {}, legacy = {}, replay = false }) {
  const result = { signal: 'NO TRADE', side: 0, reasons: [], checks: [], structure: null,
    volume: null, mtf: {}, time: null };
  const check = (name, ok, reason) => {
    result.checks.push({ name, ok: !!ok });
    if (!ok) result.reasons.push(reason || name + ' incomplete or conflicting');
  };
  const closed = primeClosed(data, seconds, now);
  if (closed.error || closed.candles.length < 220) {
    result.reasons.push(closed.error || 'Need 220 closed candles; no signal during warm-up');
    return result;
  }
  const c = closed.candles, last = c.at(-1), index = c.length - 1;
  result.time = last.time;
  const s = result.structure = primeStructure(c), technical = result.technical = primeTechnical(c);
  const side = technical.side;
  check('Closed-candle freshness', now - (last.time + seconds) <= seconds * 2, 'Closed candle is stale');
  check('EMA 9/21/50/200 + Supertrend + RSI + MACD + ADX/DMI', side !== 0, technical.error);
  check('Structure', side !== 0 && s.direction === side && s.events.some(e => e.side === side && index - e.index <= 8),
    'No recent aligned BOS / CHoCH / MSS');
  check('Premium / discount', side === 1 ? s.zone === 'DISCOUNT' : side === -1 && s.zone === 'PREMIUM',
    'Long requires discount; short requires premium in confirmed swing range');
  const active = [...s.blocks, ...s.gaps].filter(z => z.active);
  const touches = active.filter(z => z.touched !== null && index - z.touched <= 3);
  const recentSweeps = s.sweeps.filter(e => index - e.index <= 3);
  check('Order block / FVG / liquidity', side !== 0 &&
    (touches.some(z => z.side === side) || recentSweeps.some(e => e.side === side)) &&
    !touches.some(z => z.side === -side) && !recentSweeps.some(e => e.side === -side),
    'Smart-money context absent or conflicting');
  const sample = c.slice(-21), volumesValid = sample.every(b => primeFinite(b.volume) && Number(b.volume) > 0);
  let pressure = null, relative = null;
  if (volumesValid) {
    const total = sample.slice(-5).reduce((a, b) => a + Number(b.volume), 0);
    pressure = sample.slice(-5).reduce((a, b) => a + Number(b.volume) *
      (b.high > b.low ? (2 * b.close - b.high - b.low) / (b.high - b.low) : 0), 0) / total;
    relative = Number(last.volume) / (sample.slice(0, -1).reduce((a, b) => a + Number(b.volume), 0) / 20);
  }
  result.volume = { available: volumesValid, pressure, relative, source: 'Candle OHLCV proxy; not bid/ask delta' };
  check('Volume pressure', volumesValid && relative >= 1.1 && side !== 0 && pressure * side >= 0.15,
    volumesValid ? 'Volume pressure does not confirm' : 'Volume unavailable; NIFTY index volume is not fabricated');
  const vwap = technical.values?.vwap;
  check('Closed-candle VWAP', primeFinite(vwap) && side !== 0 && (last.close - Number(vwap)) * side > 0,
    'Closed-candle VWAP unavailable or conflicting; live futures VWAP is not substituted');
  for (const [tf, duration] of [['5m', 300], ['15m', 900], ['1h', 3600]]) {
    const m = primeClosed(mtfData[tf], duration, now);
    const t = m.error ? { side: 0 } : primeTechnical(m.candles);
    const st = m.candles.length ? primeStructure(m.candles) : null;
    const fresh = m.candles.length && now - (m.candles.at(-1).time + duration) <= 2 * duration;
    result.mtf[tf] = { side: t.side, structure: st?.direction || 0, fresh: !!fresh, time: m.candles.at(-1)?.time ?? null };
    check('MTF ' + tf, !replay && fresh && side !== 0 && t.side === side && st?.direction === side,
      replay ? 'Replay has no independently timestamped MTF history' : tf + ' closed-candle MTF incomplete or conflicting');
  }
  const edge = legacy.edge?.latest, gainz = legacy.gainz?.latest;
  check('Nifty Edge', edge?.time === last.time && primeSide(edge?.signal) === side && side !== 0);
  check('Market Map', primeSide(legacy.marketMap?.trend) === side && side !== 0 &&
    !(side === 1 && legacy.marketMap?.breakout === 'BREAKDOWN') &&
    !(side === -1 && legacy.marketMap?.breakout === 'BREAKOUT UP') &&
    (!primeSide(legacy.marketMap?.action) || primeSide(legacy.marketMap?.action) === side) &&
    (!primeSide(legacy.marketMap?.reversal) || primeSide(legacy.marketMap?.reversal) === side));
  const pattern = legacy.scanner?.latest;
  check('Candle Scanner', primeSide(legacy.candleSetup?.action) === side && side !== 0 &&
    primeFinite(pattern?.time) && pattern.time <= last.time && last.time - pattern.time <= seconds * 3);
  check('SSL / QQE', gainz?.time === last.time && side !== 0 && gainz.sslSide === side && gainz.qqeSide === side);
  check('Trade Finalizer', legacy.finalizer?.time === last.time && side !== 0 && primeSide(legacy.finalizer?.state) === side);
  const plan = legacy.finalizer?.plan;
  check('Closed-candle trade plan', plan && ['entry', 'stop', 'target1', 'target2', 'target3'].every(k => primeFinite(plan[k]) && Number(plan[k]) > 0) &&
    side !== 0 && (Number(plan.entry) - Number(plan.stop)) * side > 0 &&
    (Number(plan.target1) - Number(plan.entry)) * side > 0 &&
    (Number(plan.target2) - Number(plan.target1)) * side > 0 &&
    (Number(plan.target3) - Number(plan.target2)) * side > 0);
  check('All Indicators Consensus', side !== 0 && primeSide(legacy.consensus?.signal) === side &&
    legacy.consensus?.opposingCount === 0 && legacy.consensus?.votes?.length > 0 &&
    legacy.consensus.votes.every(v => v.side === side), 'All Indicators Consensus incomplete or conflicting');
  for (const [name, value] of [['AI Nifty', legacy.aiNifty?.signal], ['Global Watch', legacy.globalWatch?.bias]]) {
    const vote = primeSide(value);
    check(name + ' conflict veto', !vote || vote === side, name + ' conflicts with closed-candle evidence');
  }
  if (side && result.checks.every(x => x.ok)) {
    result.side = side;
    result.signal = side === 1 ? 'BUY' : 'SELL';
    result.reasons.push('All required closed-candle confirmation layers agree');
  }
  return result;
}

function primeGate(candidate, prime, field = 'state') {
  const side = primeSide(candidate?.[field]);
  const conflict = field === 'signal' && (candidate?.opposingCount > 0 ||
    candidate?.votes?.some(v => v.side && v.side !== side));
  if (side && prime?.side === side && !conflict) return { ...candidate, primeConfirmed: true };
  const reasons = conflict ? ['All Indicators Consensus contains opposing evidence']
    : prime?.reasons?.length ? prime.reasons : ['Required confirmation is incomplete'];
  return { ...(candidate || {}), [field]: 'NO TRADE', side: 0, plan: null, score: 0,
    bullScore: candidate?.bullScore ?? 0, bearScore: candidate?.bearScore ?? 0,
    confidence: 0, primeConfirmed: false, reasons, reason: reasons.join(' · '), invalidation: reasons[0] };
}

function refreshPrimeConfirmation() {
  const now = state.replay.active ? Number(state.data.at(-1)?.time) : Date.now() / 1000;
  try {
    const consensus = analyseAllIndicators({ finalizer: state.rawTradeFinalizer, edge: state.niftyEdge,
      marketMap: state.marketMap, mtf: state.mtf, gainz: state.gainzSSL,
      aiNifty: state.aiNifty, globalWatch: state.globalWatch });
    state.primeMarket = analysePrimeMarket({ data: state.data, seconds: Number(intervals[state.tf]), now,
      replay: state.replay.active, mtfData: state.primeMtfSymbol === state.symbol ? state.primeMtfData : {},
      legacy: { edge: state.niftyEdge, marketMap: state.marketMap, scanner: state.candleScanner,
        candleSetup: state.candleSetup, gainz: state.gainzSSL, finalizer: state.rawTradeFinalizer,
        aiNifty: state.aiNifty, globalWatch: state.globalWatch, consensus } });
    state.allIndicatorsConsensus = primeGate(consensus, state.primeMarket, 'signal');
  } catch (error) {
    console.warn('Prime confirmation failed closed:', error);
    state.primeMarket = { signal: 'NO TRADE', side: 0, checks: [], reasons: ['Indicator calculation unavailable'] };
    state.allIndicatorsConsensus = primeGate(state.allIndicatorsConsensus, state.primeMarket, 'signal');
  }
  state.tradeFinalizer = primeGate(state.rawTradeFinalizer, state.primeMarket);
  state.liveTradeFinalizer = state.tradeFinalizer;
  renderPrimeMarket();
  renderSmartMoneyTools();
}

function renderSmartMoneyTools() {
  const structure = state.primeMarket?.structure;
  const set = (id, text, side = 0) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('smrt-bullish', 'smrt-bearish', 'smrt-neutral');
    el.classList.add(side === 1 ? 'smrt-bullish' : side === -1 ? 'smrt-bearish' : 'smrt-neutral');
  };
  const price = value => primeFinite(value) ? Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }) : '—';
  const range = zone => zone ? `${price(zone.low)} – ${price(zone.high)}` : '—';
  const validZone = zone => zone && (zone.side === 1 || zone.side === -1) &&
    primeFinite(zone.low) && primeFinite(zone.high) && Number(zone.high) >= Number(zone.low);
  // Prefer surviving zones, then the newest creation. Never mutate the engine's arrays.
  const zones = values => (Array.isArray(values) ? values : []).filter(validZone).slice().sort((a, b) =>
    Number(b.active === true) - Number(a.active === true) || b.created - a.created);
  const zoneText = (zone, label) => zone
    ? `${zone.side === 1 ? 'BULLISH' : 'BEARISH'} ${label} · ${range(zone)} · ${zone.status || (zone.active ? 'ACTIVE' : 'INACTIVE')}`
    : 'NONE';
  if (!structure) {
    for (const id of ['smt-status', 'smt-order-block', 'smt-fvg', 'smt-liquidity',
      'smt-supply-demand', 'pd-status', 'pd-current-zone']) set(id, 'WAIT');
    for (const id of ['smt-demand-value', 'smt-supply-value', 'pd-range-high',
      'pd-range-low', 'pd-equilibrium-value', 'pd-position']) set(id, '—');
    return;
  }
  const blocks = zones(structure.blocks), gaps = zones(structure.gaps);
  const block = blocks[0], gap = gaps[0];
  set('smt-order-block', zoneText(block, 'OB'), block?.active ? block.side : 0);
  set('smt-fvg', zoneText(gap, 'FVG'), gap?.active ? gap.side : 0);
  // Match Prime's closed-candle convention and three-bar sweep confirmation window.
  const lastClosedIndex = state.data.length - 2;
  const sweep = (Array.isArray(structure.sweeps) ? structure.sweeps : [])
    .filter(s => (s.side === 1 || s.side === -1) && primeFinite(s.price) &&
      Number.isInteger(s.index) && s.index <= lastClosedIndex)
    .slice().sort((a, b) => b.index - a.index)[0];
  const recentSweep = sweep && lastClosedIndex - sweep.index <= 3;
  set('smt-liquidity', sweep
    ? `${sweep.side === 1 ? 'SELL-SIDE' : 'BUY-SIDE'} SWEPT · ${price(sweep.price)} · ${recentSweep ? 'RECENT' : 'HISTORICAL'}`
    : 'NONE', recentSweep ? sweep.side : 0);
  const demand = blocks.find(z => z.active && z.side === 1);
  const supply = blocks.find(z => z.active && z.side === -1);
  set('smt-demand-value', range(demand), demand ? 1 : 0);
  set('smt-supply-value', range(supply), supply ? -1 : 0);
  set('smt-supply-demand', demand && supply ? 'SUPPLY + DEMAND ACTIVE'
    : demand ? 'DEMAND ACTIVE' : supply ? 'SUPPLY ACTIVE' : 'NO ACTIVE ZONES',
    demand && !supply ? 1 : supply && !demand ? -1 : 0);
  set('pd-range-high', price(structure.high?.price));
  set('pd-range-low', price(structure.low?.price));
  set('pd-equilibrium-value', price(structure.equilibrium));
  const zone = structure.zone || 'UNAVAILABLE';
  const zoneSide = zone === 'DISCOUNT' ? 1 : zone === 'PREMIUM' ? -1 : 0;
  set('pd-current-zone', zone, zoneSide);
  set('pd-status', zone, zoneSide);
  set('pd-position', typeof structure.position === 'number' && Number.isFinite(structure.position)
    ? `${(structure.position * 100).toFixed(1)}%` : '—');
  // Describe evidence without inventing a trading score or overriding Prime's gate.
  const sides = [block?.active ? block.side : 0, gap?.active ? gap.side : 0,
    recentSweep ? sweep.side : 0].filter(Boolean);
  const bull = sides.includes(1), bear = sides.includes(-1);
  set('smt-status', bull && bear ? 'MIXED' : bull ? 'BULLISH CONTEXT'
    : bear ? 'BEARISH CONTEXT' : 'NO ACTIVE CONTEXT', bull && !bear ? 1 : bear && !bull ? -1 : 0);
}


function renderPrimeMarket() {
  let panel = document.getElementById('prime-market-panel');
  if (!panel) {
    const anchor = document.getElementById('trade-finalizer-panel');
    if (!anchor) return;
    panel = document.createElement('section');
    panel.id = 'prime-market-panel';
    panel.className = anchor.className;
    panel.style.cssText = 'padding:16px;margin:12px 0;border:1px solid var(--line,#445);border-radius:10px';
    anchor.before(panel);
  }
  const p = state.primeMarket, s = p?.structure;
  panel.replaceChildren();
  const row = (tag, text) => { const el = document.createElement(tag); el.textContent = text; panel.append(el); };
  row('h3', 'Prime Market Engine · ' + (p?.signal || 'NO TRADE'));
  row('p', 'Original price-action rules · closed candles only · ' + (p?.time ? formatISTTime(p.time * 1000) : 'Waiting for history'));
  if (s) {
    row('p', 'Structure: ' + (s.direction === 1 ? 'BULLISH' : s.direction === -1 ? 'BEARISH' : 'UNCONFIRMED') +
      ' · ' + [s.high?.label, s.low?.label].filter(Boolean).join(' / ') + ' · ' + s.zone +
      ' · Equilibrium ' + (primeFinite(s.equilibrium) ? fmt(s.equilibrium) : '—'));
    row('p', 'Recent events: ' + (s.events.slice(-4).map(e => e.type + ' ' + (e.side === 1 ? '↑' : '↓') + ' ' + fmt(e.level)).join(' · ') || 'None'));
    row('p', 'Liquidity sweeps: ' + (s.sweeps.slice(-3).map(e => (e.side === 1 ? 'Low' : 'High') + ' sweep ' + fmt(e.price)).join(' · ') || 'None'));
    for (const z of [...s.blocks, ...s.gaps].filter(z => z.active).slice(-6)) {
      row('p', z.kind + ' ' + (z.side === 1 ? '↑' : '↓') + ' ' + fmt(z.low) + '–' + fmt(z.high) + ' · ' + z.status);
    }
    row('p', p.volume?.available ? 'OHLCV pressure proxy: ' + (p.volume.pressure * 100).toFixed(1) + '% · Relative volume ' + p.volume.relative.toFixed(2) + '×'
      : 'Volume unavailable — confirmation blocked');
    row('p', Object.entries(p.mtf).map(([tf, m]) => tf + ': ' + (!m.fresh ? 'STALE / MISSING' : m.side === 1 ? 'BULLISH' : m.side === -1 ? 'BEARISH' : 'MIXED')).join(' · '));
  }
  row('p', (p?.checks || []).filter(c => c.ok).length + ' / ' + (p?.checks?.length || 0) + ' checks passed (not a probability)');
  row('p', (p?.reasons || ['Waiting for history']).join(' · '));
}

function setText(selector, value) {
  const el = document.querySelector(selector.startsWith('#') ? selector : '#' + selector);
  if (el) el.textContent = value ?? '—';
}



const fmt = n => {
  const value = Number(n);

  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};


const read = (key, fallback) => {
  try {
    return JSON.parse(
      localStorage.getItem(key)
    ) ?? fallback;
  } catch {
    return fallback;
  }
};


const save = (key, value) => {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  } catch {}
};


const paNames = [
  'Structure',
  'Swings',
  'Order blocks',
  'Fair-value gaps'
];


const savedPA = read(
  'stride-pa',
  [
    'Structure',
    'Order blocks',
    'Fair-value gaps'
  ]
);


const state = {

  paOverlays: new Set(
    Array.isArray(savedPA)
      ? savedPA.filter(
          x => paNames.includes(x)
        )
      : paNames
  ),

  quotes: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  sessionOpen: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  officialChange: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  previousClose: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  symbol: 'NIFTY',

  tf: '5m',

  tvChartMode: 'tradingview',

  data: [],

  calc: null,

  trend: null,

  niftyEdge: null,

  niftyEdgeBacktest: null,

  marketMap: null,

  candleScanner: null,

  candleSetup: null,

  tradeFinalizer: null,

  liveTradeFinalizer: null,

  aiNifty: null,

  externalNifty: null,

  externalNiftyUpdated: 0,

  globalWatch: null,

  globalWatchUpdated: 0,


  allIndicatorsConsensus: null,

  chartConsensus: null,

  gainzSSL: null,

  proSuite: null,

  proBacktest: null,

  smartSignal: null,

  smartPlan: null,

  smartStructure: null,

  smartMarketState: 'WAIT',

  futuresVWAP: null,

  futuresVWAPUpdated: 0,

  feedStatus: 'LOADING',

  lastUpdate: null,

  signalSensitivity:
    ['fast', 'balanced', 'slow'].includes(
      read(
        'stride-sensitivity',
        'balanced'
      )
    )
      ? read(
          'stride-sensitivity',
          'balanced'
        )
      : 'balanced',

  filter: 'all',

  count: 180,

  offset: 0,

  tool: 'cursor',

  drawings:
    read(
      'stride-drawings',
      {}
    ),

  alerts:
    read(
      'stride-alerts',
      []
    ),

  overlays: new Set([
    'Momentum',
    'Stride Signals',
    'Supertrend (10, 3)',
    'ADX/DMI (14)',
    'EMA 9',
    'EMA 21',
    'EMA 50',
    'EMA 200',
    'SMA 50',
    'SMA 200',
    'Bollinger',
    'VWAP',
    'Volume',
    'S/R'
  ]),

  hover: null,

  replay: {
    active: false,
    playing: false,
    source: [],
    index: 0,
    timer: null,
    speed: 700
  },

  mtf: {
    loading: false,
    updated: 0,
    '5m': null,
    '15m': null,
    '1h': null,
    overall: 'NO TRADE'
  }
};


const colors = {
  'Momentum': '#58c8dc',
  'Stride Signals': '#72e4bd',
  'Supertrend (10, 3)': '#56d6a0',
  'ADX/DMI (14)': '#c5a0ed',
  'EMA 9': '#e6ba6f',
  'EMA 21': '#7fa8f5',
  'EMA 50': '#c098e8',
  'EMA 200': '#f2946e',
  'SMA 50': '#58c8dc',
  'SMA 200': '#d7cc77',
  'Bollinger': '#879fac',
  'VWAP': '#ed90b2',
  'Volume': '#72e4bd',
  'S/R': '#9aa8ad'
};


const momentumTracker =
  new SignalAlertTracker();

const signalTracker =
  new SignalAlertTracker();

const scalpTracker =
  new SignalAlertTracker();


let momentumAlerts =
  read(
    'stride-momentum-alerts',
    false
  ) === true;


let scalpEnabled =
  read(
    'stride-scalper',
    true
  ) === true;


let scalpAlerts =
  read(
    'stride-scalper-alerts',
    false
  ) === true;


let signalAlertsEnabled =
  read(
    'stride-signal-alerts-enabled',
    false
  ) === true;


const signalHistory =
  read(
    'stride-signal-history',
    []
  );


let unsubscribe;

let request = 0;

let reconnectTimer = null;
let reconnectAttempts = 0;

let geometry;

let drag;

let startPoint;

let installPrompt;


if (
  read(
    'stride-theme',
    'dark'
  ) === 'light'
) {
  document.body.classList.add(
    'light'
  );
}


/* ======================================================
   BASIC HELPERS
====================================================== */


function toast(message) {

  const el = $('#toast');

  if (!el) return;

  el.textContent = message;

  el.style.display = 'block';

  clearTimeout(
    toast.timer
  );

  toast.timer =
    setTimeout(
      () => {
        el.style.display =
          'none';
      },
      4000
    );
}


function current() {

  return instruments.find(
    i => i.id === state.symbol
  );
}


function quote() {

  const live =
    state.quotes[
      state.symbol
    ];

  if (
    Number.isFinite(live)
  ) {
    return live;
  }

  const last =
    state.data.at(-1)?.close;

  return Number.isFinite(last)
    ? last
    : null;
}


function change(i) {

  const official =
    state.officialChange[
      i.id
    ];

  if (
    Number.isFinite(
      official
    )
  ) {
    return official;
  }

  const price =
    i.id === state.symbol
      ? quote()
      : state.quotes[i.id];

  const open =
    state.sessionOpen[i.id];

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(open) ||
    open <= 0
  ) {
    return null;
  }

  return (
    (
      price / open
    ) - 1
  ) * 100;
}


function formatChange(value) {

  if (
    !Number.isFinite(value)
  ) {
    return '—';
  }

  return (
    value >= 0
      ? '+'
      : ''
  ) +
  value.toFixed(2) +
  '%';
}


function formatISTTime(
  timestamp = Date.now()
) {

  return new Date(
    timestamp
  ).toLocaleTimeString(
    'en-IN',
    {
      timeZone:
        'Asia/Kolkata',

      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',

      hour12:
        false
    }
  );
}


function isNseCashMarketOpen(
  timestamp = Date.now()
) {

  const parts =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'Asia/Kolkata',
        weekday:
          'short',
        hour:
          '2-digit',
        minute:
          '2-digit',
        hour12:
          false
      }
    ).formatToParts(
      new Date(timestamp)
    );

  const values =
    Object.fromEntries(
      parts
        .filter(
          part =>
            part.type !==
            'literal'
        )
        .map(
          part => [
            part.type,
            part.value
          ]
        )
    );

  if (
    ['Sat', 'Sun']
      .includes(
        values.weekday
      )
  ) {
    return false;
  }

  const minutes =
    Number(values.hour) *
      60 +
    Number(values.minute);

  return (
    minutes >=
      9 * 60 + 15 &&
    minutes <=
      15 * 60 + 30
  );
}


function formatTradingDate(
  unixSeconds
) {

  if (
    !Number.isFinite(
      Number(unixSeconds)
    )
  ) {
    return '—';
  }

  return new Date(
    Number(unixSeconds) *
    1000
  ).toLocaleDateString(
    'en-IN',
    {
      timeZone:
        'Asia/Kolkata',

      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric'
    }
  );
}


function updateTradingDate() {

  const el =
    $('#trading-date');

  if (!el) return;

  /*
    History includes the previous trading session plus
    the current session. Display the date of the latest
    actual Upstox candle.
  */

  const latestCandle =
    state.data.at(-1);

  el.textContent =
    latestCandle?.time
      ? formatTradingDate(
          latestCandle.time
        )
      : '—';
}


async function refreshFuturesVWAP() {

  if (
    state.symbol !== 'NIFTY'
  ) {
    state.futuresVWAP = null;
    state.futuresVWAPUpdated = 0;
    return;
  }

  const minutes = {
    '1m': 1,
    '3m': 3,
    '5m': 5,
    '15m': 15
  }[state.tf] || 1;

  try {

    const response =
      await fetch(
        API_BASE + '/api/nifty-futures-vwap?interval=' +
        encodeURIComponent(minutes),
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'Futures VWAP request failed'
      );
    }

    const data =
      await response.json();

    const value =
      Number(data?.vwap);

    state.futuresVWAP =
      data?.live === true &&
      Number.isFinite(value)
        ? value
        : null;

    state.futuresVWAPUpdated =
      state.futuresVWAP === null
        ? 0
        : Date.now();

  } catch (error) {

    console.warn(
      'NIFTY futures VWAP unavailable:',
      error
    );

    state.futuresVWAP = null;
    state.futuresVWAPUpdated = 0;
  }
}


function setFeedStatus(
  status,
  message = ''
) {

  state.feedStatus =
    status;

  const el =
    $('#updated');

  if (!el) return;


  if (
    status === 'LIVE'
  ) {

    el.textContent =
      '● LIVE · UPSTOX · ' +
      formatISTTime() +
      ' IST';

    return;
  }


  if (
    status === 'CLOSED'
  ) {

    el.textContent =
      '● MARKET CLOSED · LAST SESSION DATA';

    return;
  }


  if (
    status === 'FALLBACK'
  ) {

    el.textContent =
      '● FALLBACK · UPSTOX 1m · ' +
      formatISTTime() +
      ' IST';

    return;
  }


  if (
    status === 'STALE'
  ) {

    el.textContent =
      '● STALE · ' +
      (
        message ||
        'Waiting for update'
      );

    return;
  }


  if (
    status === 'RECONNECTING'
  ) {

    el.textContent =
      '● RECONNECTING · UPSTOX';

    return;
  }


  if (
    status ===
    'DATA UNAVAILABLE'
  ) {

    el.textContent =
      '● DATA UNAVAILABLE' +
      (
        message
          ? ' · ' + message
          : ''
      );

    return;
  }


  el.textContent =
    message || status;
}


/* ======================================================
   WATCHLIST
====================================================== */


function renderWatch() {

  const list =
    instruments.filter(
      i => {

        if (
          state.filter === 'all'
        ) {
          return true;
        }

        return [
          'FUTURE',
          'CALL',
          'PUT'
        ].includes(
          i.kind
        );
      }
    );


  const watchRows =
    $('#watch-rows');


  if (watchRows) {

    watchRows.innerHTML =
      list.map(
        i => {

          const price =
            i.id === state.symbol
              ? quote()
              : state.quotes[i.id];


          const ch =
            change(i);


          return `
            <button
              class="watch-row ${
                i.id === state.symbol
                  ? 'selected'
                  : ''
              }"
              data-symbol="${i.id}"
            >

              <span>

                <strong>
                  ${i.name}
                </strong>

                <small>
                  ${
                    i.description ||
                    'Upstox live market data'
                  }
                </small>

              </span>


              <span class="watch-price">

                <strong>
                  ${fmt(price)}
                </strong>

                <span class="${
                  Number.isFinite(ch)
                    ? ch >= 0
                      ? 'up'
                      : 'down'
                    : 'muted'
                }">
                  ${formatChange(ch)}
                </span>

              </span>

            </button>
          `;
        }
      ).join('');
  }


  const ticker =
    $('#ticker');


  if (ticker) {

    ticker.innerHTML =
      instruments.map(
        i => {

          const price =
            i.id === state.symbol
              ? quote()
              : state.quotes[i.id];


          const ch =
            change(i);


          return `
            <div class="ticker-item">

              <span>
                ${i.name}
              </span>

              <b>
                ${fmt(price)}
              </b>

              <span class="${
                Number.isFinite(ch)
                  ? ch >= 0
                    ? 'up'
                    : 'down'
                  : 'muted'
              }">
                ${formatChange(ch)}
              </span>

            </div>
          `;
        }
      ).join('');
  }
}


/* ======================================================
   STRIDE PRO TRADING SUITE
====================================================== */

function refreshProSuite() {

  if (
    !Array.isArray(
      state.data
    ) ||
    !state.data.length
  ) {

    state.proSuite =
      null;

    state.proBacktest =
      null;

    state.smartSignal =
      null;

    state.smartPlan =
      null;

    state.smartStructure =
      null;

    state.smartMarketState =
      'WAIT';

    return;
  }


  const result =
    analyseProSuite(
      state.data,
      {
        strideSignals:
          Array.isArray(
            state.signals
          )
            ? state.signals
            : []
      }
    );


  state.proSuite =
    result;


  const latest =
    result?.latest;


  state.smartSignal =
    latest?.smart ??
    null;


  state.smartPlan =
    latest?.plan ??
    null;


  state.smartStructure =
    latest?.structure ??
    null;


  state.smartMarketState =
    latest?.smart
      ?.marketState ??
    'WAIT';


  state.proBacktest =
    null;
}

function renderProSuiteSummary() {
  const edgeLatest = state.niftyEdge?.latest || null;
  const consensus = state.allIndicatorsConsensus || null;
  const finalizer = state.tradeFinalizer || null;

  // =========================================================
  // FINAL DISPLAY SIGNAL
  // All Indicators Consensus is the display decision layer.
  // Missing / WAIT / invalid values NEVER become BUY or SELL.
  // =========================================================
  const consensusSignal = String(
    consensus?.signal || "NO TRADE"
  ).toUpperCase();

  const actionableSignals = [
    "STRONG BUY",
    "BUY",
    "SELL",
    "STRONG SELL"
  ];

  const actionable =
    actionableSignals.includes(consensusSignal) &&
    state.primeMarket?.side === primeSide(consensusSignal);

  const displaySignal =
    actionable ? consensusSignal : "NO TRADE";

  // =========================================================
  // CONFIDENCE
  // Use corrected All Indicators confidence.
  // =========================================================
  const confidenceRaw = Number(consensus?.confidence);

  const confidence =
    Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : 0;

  // =========================================================
  // SIGNAL DIRECTION
  // =========================================================
  const finalSide =
    displaySignal.includes("BUY")
      ? 1
      : displaySignal.includes("SELL")
      ? -1
      : 0;

  // =========================================================
  // TRADE PLAN SAFETY
  // Show Entry / SL / Targets ONLY when:
  // 1. Consensus is actionable
  // 2. Finalizer has a valid plan
  // 3. Finalizer agrees with consensus direction
  // =========================================================
  const finalizerSide = Number(finalizer?.side);

  const plan =
    actionable &&
    finalizer?.plan &&
    finalizerSide === finalSide
      ? finalizer.plan
      : null;

  // =========================================================
  // MARKET / STRUCTURE
  // =========================================================
  const marketState =
    state.marketMap?.trend ||
    edgeLatest?.structure ||
    state.smartMarketState ||
    "WAIT";

  const structure =
    edgeLatest?.structure ||
    state.smartStructure ||
    "WAIT";

  // =========================================================
  // STRENGTH
  // =========================================================
  let strength = "WAIT";

  if (
    displaySignal === "STRONG BUY" ||
    displaySignal === "STRONG SELL"
  ) {
    strength = "STRONG";
  } else if (
    displaySignal === "BUY" ||
    displaySignal === "SELL"
  ) {
    strength = "CONFIRMED";
  }

  // =========================================================
  // TOP PANEL
  // =========================================================
  setText("#smart-signal", displaySignal);
  const smartSignalEl = document.getElementById("smart-signal");
  if (smartSignalEl) smartSignalEl.dataset.side = finalSide === 1 ? "BUY" : finalSide === -1 ? "SELL" : "WAIT";
  setText("#smart-strength", strength);
  setText("#smart-confluence", confidence);
  setText("#smart-market-state", marketState);
  setText("#smart-structure", structure);

  // =========================================================
  // TRADE PLAN
  // Never display fake zero values.
  // =========================================================
  setText(
    "smart-entry",
    primeFinite(plan?.entry)
      ? fmt(plan.entry)
      : "--"
  );

  setText(
    "smart-stop",
    primeFinite(plan?.stop)
      ? fmt(plan.stop)
      : "--"
  );

  setText(
    "smart-target1",
    primeFinite(plan?.target1)
      ? fmt(plan.target1)
      : "--"
  );

  setText(
    "smart-target2",
    primeFinite(plan?.target2)
      ? fmt(plan.target2)
      : "--"
  );

  // =========================================================
  // RISK : REWARD
  // =========================================================
  let rrText = "--";

  if (
    plan &&
    Number.isFinite(Number(plan.entry)) &&
    Number.isFinite(Number(plan.stop)) &&
    Number.isFinite(Number(plan.target1))
  ) {
    const entry = Number(plan.entry);
    const stop = Number(plan.stop);
    const target = Number(plan.target1);

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);

    if (risk > 0 && reward > 0) {
      rrText = `1:${(reward / risk).toFixed(2)}`;
    }
  }

  setText("smart-rr", rrText);

  // =========================================================
  // BACKTEST INFORMATION
  // Keep existing values when available.
  // =========================================================
  const bt =
    state.proSuite?.backtest ||
    state.backtest ||
    null;

  setText(
    "smart-backtest-trades",
    Number.isFinite(Number(bt?.trades))
      ? bt.trades
      : "--"
  );

  setText(
    "smart-backtest-winrate",
    Number.isFinite(Number(bt?.winRate))
      ? `${Number(bt.winRate).toFixed(1)}%`
      : "--"
  );

  setText(
    "smart-backtest-pf",
    Number.isFinite(Number(bt?.profitFactor))
      ? Number(bt.profitFactor).toFixed(2)
      : "--"
  );
}

/* ======================================================
   CANVAS
====================================================== */


function canvas(id) {

  const el =
    $(id);

  const rect =
    el.getBoundingClientRect();

  const dpr =
    devicePixelRatio || 1;

  el.width =
    rect.width * dpr;

  el.height =
    rect.height * dpr;


  const ctx =
    el.getContext('2d');

  ctx.scale(
    dpr,
    dpr
  );


  return {
    ctx,
    w: rect.width,
    h: rect.height
  };
}


/* ======================================================
   MAIN CHART
====================================================== */


let tvAdvancedWidget = null;
let tvAdvancedAttempted = false;
let tvAdvancedReady = false;


function setTradingViewDatafeedStatus(
  text,
  className = 'muted'
) {

  const el =
    $('#tradingview-datafeed-status');

  if (!el) {
    return;
  }

  el.textContent =
    text;

  el.className =
    'tv-datafeed-status ' +
    className;
}


function loadScriptOnce(
  src
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const existing =
        document.querySelector(
          'script[data-smrt-tv-advanced="1"]'
        );

      if (
        existing &&
        window.TradingView?.widget
      ) {
        resolve();

        return;
      }

      if (existing) {
        existing.addEventListener(
          'load',
          () => resolve(),
          {
            once: true
          }
        );

        existing.addEventListener(
          'error',
          () =>
            reject(
              new Error(
                'TradingView Advanced Charts runtime unavailable'
              )
            ),
          {
            once: true
          }
        );

        return;
      }

      const script =
        document.createElement(
          'script'
        );

      script.src =
        src;

      script.async =
        true;

      script.dataset
        .smrtTvAdvanced =
          '1';

      script.onload =
        () =>
          resolve();

      script.onerror =
        () =>
          reject(
            new Error(
              'TradingView Advanced Charts runtime not installed'
            )
          );

      document.head
        .appendChild(
          script
        );
    }
  );
}


async function initTradingViewAdvancedChart() {

  if (
    tvAdvancedReady &&
    tvAdvancedWidget
  ) {
    return true;
  }

  if (
    tvAdvancedAttempted
  ) {
    return false;
  }

  tvAdvancedAttempted =
    true;

  const container =
    $('#tv-advanced-chart');

  if (!container) {
    return false;
  }

  try {
    if (
      !window.TradingView?.widget
    ) {
      await loadScriptOnce(
        '/charting_library/charting_library.standalone.js'
      );
    }

    if (
      !window.TradingView?.widget
    ) {
      throw new Error(
        'TradingView Advanced Charts library is not available'
      );
    }

    container.innerHTML =
      '';

    tvAdvancedWidget =
      new window.TradingView.widget({
        container:
          'tv-advanced-chart',
        library_path:
          '/charting_library/',
        datafeed:
          window.SMRTTradingViewDatafeed,
        symbol:
          'NSE:NIFTY',
        interval:
          state.tf === '1m'
            ? '1'
            : state.tf === '3m'
              ? '3'
              : state.tf === '15m'
                ? '15'
                : '5',
        locale:
          'en',
        timezone:
          'Asia/Kolkata',
        autosize:
          true,
        theme:
          'dark',
        currency_code:
          'INR',
        enabled_features: [
          'display_market_status',
          'popup_hints'
        ],
        disabled_features: [
          'use_localstorage_for_settings'
        ]
      });

    tvAdvancedReady =
      true;

    setTradingViewDatafeedStatus(
      'TradingView Advanced Charts · Upstox LIVE',
      'up'
    );

    return true;

  } catch (error) {
    console.info(
      'Advanced Charts runtime not installed; using Lightweight Charts.',
      error
    );

    setTradingViewDatafeedStatus(
      'TradingView Lightweight · Upstox LIVE',
      'up'
    );

    return false;
  }
}


let tvLiteChart = null;
let tvLiteSeries = null;
let tvLiteVolumeSeries = null;
let tvLiteMarkers = null;
const tvLiteIndicatorSeries = new Map();
let tvLitePriceLines = [];
let tvLiteLastLength = 0;
let tvLiteLastFirstTime = null;
let tvLiteLastMarkerKey = '';


function initTradingViewLiteChart() {

  const container =
    $('#tv-lightweight-chart');

  const L =
    window.LightweightCharts;

  if (
    !container ||
    !L ||
    tvLiteChart
  ) {
    return;
  }


  try {
    tvLiteChart =
      L.createChart(
        container,
        {
          autoSize: true,
          layout: {
            background: {
              type:
                L.ColorType?.Solid ||
                'solid',
              color:
                '#10181b'
            },
            textColor:
              '#9fb0b7',
            attributionLogo:
              true
          },
          grid: {
            vertLines: {
              color:
                'rgba(255,255,255,0.05)'
            },
            horzLines: {
              color:
                'rgba(255,255,255,0.05)'
            }
          },
          rightPriceScale: {
            borderColor:
              '#26363c',
            scaleMargins: {
              top: 0.08,
              bottom: 0.08
            }
          },
          timeScale: {
            borderColor:
              '#26363c',
            timeVisible:
              true,
            secondsVisible:
              false,
            rightOffset:
              4,
            barSpacing:
              9,
            tickMarkFormatter:
              time => {
                const value =
                  typeof time ===
                  'number'
                    ? time
                    : null;

                if (
                  !Number.isFinite(
                    value
                  )
                ) {
                  return '';
                }

                return new Date(
                  value * 1000
                ).toLocaleTimeString(
                  'en-IN',
                  {
                    timeZone:
                      'Asia/Kolkata',
                    hour:
                      '2-digit',
                    minute:
                      '2-digit',
                    hour12:
                      false
                  }
                );
              }
          },
          localization: {
            priceFormatter:
              price =>
                Number(price)
                  .toLocaleString(
                    'en-IN',
                    {
                      minimumFractionDigits:
                        2,
                      maximumFractionDigits:
                        2
                    }
                  )
          }
        }
      );


    if (
      L.CandlestickSeries &&
      tvLiteChart.addSeries
    ) {
      tvLiteSeries =
        tvLiteChart.addSeries(
          L.CandlestickSeries,
          {
            upColor:
              '#72e4bd',
            downColor:
              '#f17c86',
            borderUpColor:
              '#72e4bd',
            borderDownColor:
              '#f17c86',
            wickUpColor:
              '#72e4bd',
            wickDownColor:
              '#f17c86'
          }
        );
    } else if (
      tvLiteChart
        .addCandlestickSeries
    ) {
      tvLiteSeries =
        tvLiteChart
          .addCandlestickSeries({
            upColor:
              '#72e4bd',
            downColor:
              '#f17c86',
            borderUpColor:
              '#72e4bd',
            borderDownColor:
              '#f17c86',
            wickUpColor:
              '#72e4bd',
            wickDownColor:
              '#f17c86'
          });
    }


    if (
      tvLiteSeries &&
      L.createSeriesMarkers
    ) {
      tvLiteMarkers =
        L.createSeriesMarkers(
          tvLiteSeries,
          [],
          {
            autoScale:
              true
          }
        );
    }

  } catch (error) {
    console.warn(
      'TradingView Lightweight Charts unavailable:',
      error
    );

    tvLiteChart =
      null;

    tvLiteSeries =
      null;

    tvLiteMarkers =
      null;
  }
}


function getTvLiteLineSeries(
  key,
  color,
  lineWidth = 1.4,
  lineStyle = 0
) {

  if (
    tvLiteIndicatorSeries.has(
      key
    )
  ) {
    return tvLiteIndicatorSeries.get(
      key
    );
  }

  const L =
    window.LightweightCharts;

  if (
    !tvLiteChart ||
    !L
  ) {
    return null;
  }

  let series = null;

  try {
    if (
      L.LineSeries &&
      tvLiteChart.addSeries
    ) {
      series =
        tvLiteChart.addSeries(
          L.LineSeries,
          {
            color,
            lineWidth,
            lineStyle,
            priceLineVisible:
              false,
            lastValueVisible:
              false,
            crosshairMarkerVisible:
              false
          }
        );
    } else if (
      tvLiteChart.addLineSeries
    ) {
      series =
        tvLiteChart.addLineSeries({
          color,
          lineWidth,
          lineStyle,
          priceLineVisible:
            false,
          lastValueVisible:
            false,
          crosshairMarkerVisible:
            false
        });
    }
  } catch (
    error
  ) {
    console.warn(
      'Unable to create TradingView indicator series:',
      key,
      error
    );
  }

  if (series) {
    tvLiteIndicatorSeries.set(
      key,
      series
    );
  }

  return series;
}


function setTvLiteLine(
  key,
  values,
  color,
  enabled,
  lineWidth = 1.4,
  lineStyle = 0
) {

  const existing =
    tvLiteIndicatorSeries.get(
      key
    );

  if (!enabled) {
    existing?.setData?.(
      []
    );

    return;
  }

  if (
    !Array.isArray(
      values
    )
  ) {
    return;
  }

  const series =
    getTvLiteLineSeries(
      key,
      color,
      lineWidth,
      lineStyle
    );

  if (!series) {
    return;
  }

  const data =
    values
      .map(
        (
          value,
          index
        ) => {
          const candle =
            state.data[
              index
            ];

          const time =
            candle?.time === null ||
            candle?.time === undefined ||
            candle?.time === ''
              ? null
              : Number(candle.time);

          const plotValue =
            value === null ||
            value === undefined ||
            value === ''
              ? null
              : Number(value);

          /*
            Price-overlay safety:
            never send missing/invalid/zero values to Lightweight Charts.
            A zero from an upstream warm-up/missing indicator would otherwise
            collapse the NIFTY price scale and draw a vertical line to 0.
          */
          if (
            !Number.isFinite(time) ||
            !Number.isFinite(plotValue) ||
            plotValue <= 0
          ) {
            return null;
          }

          return {
            time,
            value: plotValue
          };
        }
      )
      .filter(Boolean);

  series.setData(
    data
  );
}


function ensureTvLiteVolumeSeries() {

  if (
    tvLiteVolumeSeries ||
    !tvLiteChart
  ) {
    return;
  }

  const L =
    window.LightweightCharts;

  try {
    if (
      L?.HistogramSeries &&
      tvLiteChart.addSeries
    ) {
      tvLiteVolumeSeries =
        tvLiteChart.addSeries(
          L.HistogramSeries,
          {
            priceFormat: {
              type: 'volume'
            },
            priceScaleId:
              'volume',
            lastValueVisible:
              false,
            priceLineVisible:
              false
          }
        );
    } else if (
      tvLiteChart.addHistogramSeries
    ) {
      tvLiteVolumeSeries =
        tvLiteChart.addHistogramSeries({
          priceFormat: {
            type: 'volume'
          },
          priceScaleId:
            'volume',
          lastValueVisible:
            false,
          priceLineVisible:
            false
        });
    }

    tvLiteChart
      .priceScale?.(
        'volume'
      )
      ?.applyOptions?.({
        scaleMargins: {
          top: 0.78,
          bottom: 0
        }
      });

  } catch (
    error
  ) {
    console.warn(
      'Unable to create TradingView volume series:',
      error
    );
  }
}


function syncTradingViewIndicators() {

  if (
    !tvLiteChart ||
    !state.calc
  ) {
    return;
  }

  const isOn =
    name =>
      state.overlays.has(
        name
      );


  const lines = [
    [
      'EMA 9',
      'e9'
    ],
    [
      'EMA 21',
      'e21'
    ],
    [
      'EMA 50',
      'e50'
    ],
    [
      'EMA 200',
      'e200'
    ],
    [
      'SMA 50',
      's50'
    ],
    [
      'SMA 200',
      's200'
    ]
  ];

  for (
    const [
      name,
      key
    ] of lines
  ) {
    setTvLiteLine(
      name,
      state.calc?.[
        key
      ],
      colors[
        name
      ],
      isOn(
        name
      )
    );
  }


  const vwapValues =
    Array.isArray(
      state.calc?.vwap
    ) &&
    state.calc.vwap.some(
      value =>
        Number.isFinite(
          Number(value)
        )
    )
      ? state.calc.vwap
      : (
          Number.isFinite(
            state.futuresVWAP
          )
            ? Array(
                state.data.length
              ).fill(
                state.futuresVWAP
              )
            : []
        );

  setTvLiteLine(
    'VWAP',
    vwapValues,
    colors.VWAP,
    isOn(
      'VWAP'
    ),
    1.4,
    2
  );


  const supertrend =
    state.trend?.supertrend;

  const direction =
    state.trend?.direction;

  const superUp =
    Array.isArray(
      supertrend
    )
      ? supertrend.map(
          (
            value,
            index
          ) =>
            direction?.[
              index
            ] === 1
              ? value
              : null
        )
      : [];

  const superDown =
    Array.isArray(
      supertrend
    )
      ? supertrend.map(
          (
            value,
            index
          ) =>
            direction?.[
              index
            ] === -1
              ? value
              : null
        )
      : [];

  setTvLiteLine(
    'Supertrend Up',
    superUp,
    '#56d6a0',
    isOn(
      'Supertrend (10, 3)'
    ),
    1.6
  );

  setTvLiteLine(
    'Supertrend Down',
    superDown,
    '#f17c86',
    isOn(
      'Supertrend (10, 3)'
    ),
    1.6
  );


  const strideUp =
    state.signals?.map(
      row =>
        row?.direction === 1
          ? row.stop
          : null
    ) || [];

  const strideDown =
    state.signals?.map(
      row =>
        row?.direction === -1
          ? row.stop
          : null
    ) || [];

  setTvLiteLine(
    'Stride Up',
    strideUp,
    '#72e4bd',
    isOn(
      'Stride Signals'
    ),
    1.2,
    2
  );

  setTvLiteLine(
    'Stride Down',
    strideDown,
    '#f17c86',
    isOn(
      'Stride Signals'
    ),
    1.2,
    2
  );


  const bb =
    state.calc?.bb;

  setTvLiteLine(
    'BB Upper',
    Array.isArray(bb)
      ? bb.map(
          row =>
            row?.upper
        )
      : [],
    colors.Bollinger,
    isOn(
      'Bollinger'
    ),
    1.1
  );

  setTvLiteLine(
    'BB Mid',
    Array.isArray(bb)
      ? bb.map(
          row =>
            row?.mid
        )
      : [],
    colors.Bollinger,
    isOn(
      'Bollinger'
    ),
    1,
    2
  );

  setTvLiteLine(
    'BB Lower',
    Array.isArray(bb)
      ? bb.map(
          row =>
            row?.lower
        )
      : [],
    colors.Bollinger,
    isOn(
      'Bollinger'
    ),
    1.1
  );


  ensureTvLiteVolumeSeries();

  if (
    tvLiteVolumeSeries
  ) {
    const volumeData =
      isOn(
        'Volume'
      )
        ? state.data.map(
            candle => ({
              time:
                Number(
                  candle.time
                ),
              value:
                Number(
                  candle.volume
                ) || 0,
              color:
                Number(
                  candle.close
                ) >=
                Number(
                  candle.open
                )
                  ? 'rgba(114,228,189,0.35)'
                  : 'rgba(241,124,134,0.35)'
            })
          )
        : [];

    tvLiteVolumeSeries.setData(
      volumeData
    );
  }


  for (
    const priceLine of
    tvLitePriceLines
  ) {
    try {
      tvLiteSeries
        ?.removePriceLine?.(
          priceLine
        );
    } catch {}
  }

  tvLitePriceLines =
    [];

  if (
    isOn(
      'S/R'
    ) &&
    tvLiteSeries
  ) {
    const levels = [
      {
        title: 'S',
        price:
          state.marketMap
            ?.nearestSupport
            ?.price,
        color:
          '#72e4bd'
      },
      {
        title: 'R',
        price:
          state.marketMap
            ?.nearestResistance
            ?.price,
        color:
          '#f17c86'
      }
    ];

    for (
      const level of
      levels
    ) {
      if (
        level.price === null ||
        level.price === undefined ||
        level.price === '' ||
        !Number.isFinite(
          Number(
            level.price
          )
        )
      ) {
        continue;
      }

      try {
        const line =
          tvLiteSeries
            .createPriceLine({
              price:
                Number(
                  level.price
                ),
              color:
                level.color,
              lineWidth:
                1,
              lineStyle:
                2,
              axisLabelVisible:
                true,
              title:
                level.title
            });

        tvLitePriceLines.push(
          line
        );
      } catch {}
    }
  }
}


function buildTradingViewMarkers() {

  // The chart shows one authoritative signal stream only: chart consensus.
  // Momentum and Stride remain available as indicators/panels, but their
  // independent arrows are not mixed with the final BUY/SELL decision.
  // This prevents contradictory/overlapping M BUY, S BUY, BUY and SELL
  // markers on the same candle.
  const markers = [];
  const rows = state.chartConsensus?.rows || [];

  let previousSide = 0;

  rows.forEach((row, index) => {
    if (!row || !row.signal) return;

    // The newest candle may still be forming. Never publish a trade marker
    // from it; wait until that candle has closed.
    if (index >= state.data.length - 1) return;

    const signal = String(row.signal).toUpperCase();
    const isBuy = signal === 'BUY' || signal === 'STRONG BUY';
    const isSell = signal === 'SELL' || signal === 'STRONG SELL';

    // WAIT/NO TRADE/NOT READY breaks the previous signal run so a later
    // confirmed re-entry can create one fresh marker.
    if (!isBuy && !isSell) {
      previousSide = 0;
      return;
    }

    const side = isBuy ? 1 : -1;

    // Only draw one marker for a continuous same-side signal run.
    if (side === previousSide) return;

    const candle = state.data[index];
    if (!candle || candle.time === null || candle.time === undefined) return;

    const time = Number(candle.time);
    if (!Number.isFinite(time)) return;

    const strong = signal.startsWith('STRONG');

    markers.push({
      time,
      position: isBuy ? 'belowBar' : 'aboveBar',
      color: isBuy ? '#72e4bd' : '#f17c86',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      text: isBuy ? (strong ? 'BUY+' : 'BUY') : (strong ? 'SELL+' : 'SELL'),
      size: strong ? 2 : 1
    });

    previousSide = side;
  });

  return markers.sort((a, b) => a.time - b.time);
}

function syncTradingViewLiteChart(
  force = false
) {

  if (
    state.tvChartMode !==
      'tradingview'
  ) {
    return;
  }

  initTradingViewLiteChart();

  if (
    !tvLiteSeries ||
    !state.data.length
  ) {
    return;
  }


  const data =
    state.data
      .map(
        candle => {
          const time =
            candle?.time === null ||
            candle?.time === undefined ||
            candle?.time === ''
              ? null
              : Number(candle.time);

          const open =
            candle?.open === null ||
            candle?.open === undefined ||
            candle?.open === ''
              ? null
              : Number(candle.open);

          const high =
            candle?.high === null ||
            candle?.high === undefined ||
            candle?.high === ''
              ? null
              : Number(candle.high);

          const low =
            candle?.low === null ||
            candle?.low === undefined ||
            candle?.low === ''
              ? null
              : Number(candle.low);

          const close =
            candle?.close === null ||
            candle?.close === undefined ||
            candle?.close === ''
              ? null
              : Number(candle.close);

          if (
            !Number.isFinite(time) ||
            !Number.isFinite(open) ||
            !Number.isFinite(high) ||
            !Number.isFinite(low) ||
            !Number.isFinite(close) ||
            open <= 0 ||
            high <= 0 ||
            low <= 0 ||
            close <= 0
          ) {
            return null;
          }

          return {
            time,
            open,
            high,
            low,
            close
          };
        }
      )
      .filter(Boolean);


  const volumeData =
    state.data.map(
      candle => ({
        time:
          Number(
            candle.time
          ),
        value:
          Number(
            candle.volume
          ) || 0,
        color:
          Number(candle.close) >=
          Number(candle.open)
            ? 'rgba(38,166,154,0.45)'
            : 'rgba(239,83,80,0.45)'
      })
    );


  const firstTime =
    data[0]?.time;

  const structuralChange =
    force ||
    data.length !==
      tvLiteLastLength ||
    firstTime !==
      tvLiteLastFirstTime;


  try {
    if (
      structuralChange
    ) {
      tvLiteSeries.setData(
        data
      );

      tvLiteVolumeSeries
        ?.setData(
          volumeData
        );

      tvLiteLastLength =
        data.length;

      tvLiteLastFirstTime =
        firstTime;

      tvLiteChart
        ?.timeScale()
        ?.fitContent();
    } else {
      const last =
        data.at(-1);

      if (last) {
        tvLiteSeries.update(
          last
        );

        const lastVolume =
          volumeData.at(-1);

        if (
          lastVolume
        ) {
          tvLiteVolumeSeries
            ?.update(
              lastVolume
            );
        }
      }
    }


    syncTradingViewIndicators();

    const markers =
      buildTradingViewMarkers();

    const markerKey =
      markers
        .map(
          marker =>
            marker.time +
            ':' +
            marker.text
        )
        .join('|');


    if (
      markerKey !==
      tvLiteLastMarkerKey
    ) {
      tvLiteLastMarkerKey =
        markerKey;

      if (
        tvLiteMarkers?.setMarkers
      ) {
        tvLiteMarkers.setMarkers(
          markers
        );
      } else if (
        tvLiteSeries.setMarkers
      ) {
        tvLiteSeries.setMarkers(
          markers
        );
      }
    }

  } catch (error) {
    console.warn(
      'TradingView chart sync failed:',
      error
    );
  }
}


function setChartView(
  mode
) {

  state.tvChartMode =
    mode === 'classic'
      ? 'classic'
      : 'tradingview';

  document.body.classList.toggle(
    'tv-shell-mode',
    state.tvChartMode ===
      'tradingview'
  );


  const advanced =
    $('#tv-advanced-chart');

  const lite =
    $('#tv-lightweight-chart');

  const classic =
    $('#chart');


  if (
    state.tvChartMode ===
      'classic'
  ) {

    advanced?.classList.add(
      'hidden'
    );

    lite?.classList.add(
      'hidden'
    );

    classic?.classList.remove(
      'hidden'
    );

  } else {

    classic?.classList.add(
      'hidden'
    );

    initTradingViewAdvancedChart()
      .then(
        ready => {

          if (
            ready &&
            state.tvChartMode ===
              'tradingview'
          ) {
            advanced
              ?.classList
              .remove(
                'hidden'
              );

            lite
              ?.classList
              .add(
                'hidden'
              );
          } else if (
            state.tvChartMode ===
              'tradingview'
          ) {
            advanced
              ?.classList
              .add(
                'hidden'
              );

            initTradingViewLiteChart();

            if (
              tvLiteSeries
            ) {
              lite
                ?.classList
                .remove(
                  'hidden'
                );

              classic
                ?.classList
                .add(
                  'hidden'
                );

              syncTradingViewLiteChart(
                true
              );

              setTradingViewDatafeedStatus(
                'TradingView Lightweight · Upstox LIVE',
                'up'
              );
            } else {
              // CDN/library unavailable: never leave a blank chart.
              state.tvChartMode =
                'classic';

              document.body
                .classList
                .remove(
                  'tv-shell-mode'
                );

              lite
                ?.classList
                .add(
                  'hidden'
                );

              classic
                ?.classList
                .remove(
                  'hidden'
                );

              $('#chart-view-tv')
                ?.classList
                .remove(
                  'active'
                );

              $('#chart-view-classic')
                ?.classList
                .add(
                  'active'
                );

              setTradingViewDatafeedStatus(
                'Classic chart · Upstox LIVE · TradingView library unavailable',
                'muted'
              );

              draw();
            }
          }
        }
      );
  }


  const tvProStatus =
    $('#tv-pro-status');

  if (
    tvProStatus
  ) {
    tvProStatus.textContent =
      state.tvChartMode ===
        'tradingview'
        ? 'TRADINGVIEW STYLE · UPSTOX LIVE'
        : 'CLASSIC CHART · UPSTOX LIVE';
  }


  $('#chart-view-tv')
    ?.classList.toggle(
      'active',
      state.tvChartMode ===
        'tradingview'
    );

  $('#chart-view-classic')
    ?.classList.toggle(
      'active',
      state.tvChartMode ===
        'classic'
    );


  if (
    state.tvChartMode ===
      'classic'
  ) {
    draw();
  }
}


let lastAnalysisKey = null;

let liveRenderTimer =
  null;

let liveRenderQueued =
  false;

let lastLiveRender =
  0;


function scheduleLiveRender(
  force = false
) {

  if (
    liveRenderQueued &&
    !force
  ) {
    return;
  }


  const now =
    performance.now();

  const elapsed =
    now -
    lastLiveRender;

  const delay =
    force
      ? 0
      : Math.max(
          0,
          120 - elapsed
        );


  liveRenderQueued =
    true;


  if (
    liveRenderTimer
  ) {

    clearTimeout(
      liveRenderTimer
    );
  }


  liveRenderTimer =
    setTimeout(
      () => {

        liveRenderQueued =
          false;

        liveRenderTimer =
          null;

        lastLiveRender =
          performance.now();


        requestAnimationFrame(
          () => {

            draw();

            summary();
          }
        );

      },
      delay
    );
}


function cancelScheduledRender() {

  if (
    liveRenderTimer
  ) {

    clearTimeout(
      liveRenderTimer
    );

    liveRenderTimer =
      null;
  }


  liveRenderQueued =
    false;
}

function draw() {

  if (
    !state.data.length
  ) {
    return;
  }


  const closedIndex =
    Math.max(
      0,
      state.data.length - 2
    );

  const closedCandle =
    state.data[
      closedIndex
    ] ||
    state.data.at(-1);

  const analysisKey = [
    state.data.length,
    state.data[0]?.time,
    closedCandle?.time,
    closedCandle?.open,
    closedCandle?.high,
    closedCandle?.low,
    closedCandle?.close,
    closedCandle?.volume,
    state.signalSensitivity,
    Number.isFinite(
      state.futuresVWAP
    )
      ? state.futuresVWAP
      : 'NA'
  ].join(':');

  if (analysisKey !== lastAnalysisKey) {
    lastAnalysisKey = analysisKey;
  state.pa =
    priceAction(
      state.data
    );


  state.momentum =
    momentumSignals(
      state.data
    );


  state.calc =
    indicators(
      state.data
    );

  state.trend = trendIndicators(state.data);


  state.scalps =
    proScalper(
      state.data
    );


  state.signals =
    strideSignals(
      state.data,
      {
        multiplier: {
          fast: 1.5,
          balanced: 2.5,
          slow: 3.5
        }[
          state.signalSensitivity
        ]
      }
    );


  state.niftyEdge =
    analyseNiftyEdge(
      state.data,
      {
        futuresVWAP:
          state.futuresVWAP
      }
    );


  state.niftyEdgeBacktest =
    null;


  state.marketMap =
    analyseMarketMap(
      state.data,
      {
        futuresVWAP:
          state.futuresVWAP
      }
    );


  state.candleScanner =
    scanCandles(
      state.data
    );


  state.candleSetup =
    candleConfluence(
      state.candleScanner,
      state.marketMap,
      state.niftyEdge,
      state.mtf
    );


  state.rawTradeFinalizer =
    finalizeTrade({
      edge:
        state.niftyEdge,
      marketMap:
        state.marketMap,
      candleSetup:
        state.candleSetup,
      mtf:
        state.mtf,
      calc:
        state.calc,
      trend:
        state.trend,
      data:
        state.data,
      futuresVWAP:
        state.futuresVWAP
    });


  state.tradeFinalizer = state.rawTradeFinalizer;

  state.gainzSSL =
    analyseGainzSSL(
      state.data,
      {
        finalizer:
          state.tradeFinalizer,
        mtf:
          state.mtf,
        signalExpiry:
          3
      }
    );


  state.chartConsensus =
    analyseChartConsensus({
      candles:
        state.data,
      calc:
        state.calc,
      trend:
        state.trend,
      edge:
        state.niftyEdge,
      gainz:
        state.gainzSSL
    });


  refreshProSuite();
  }
  refreshPrimeConfirmation();


  syncTradingViewLiteChart();


  const {
    ctx,
    w,
    h
  } = canvas('#chart');


  const style =
    getComputedStyle(
      document.body
    );


  const muted =
    style.getPropertyValue(
      '--muted'
    );


  const grid =
    style.getPropertyValue(
      '--line'
    );


  const up =
    style.getPropertyValue(
      '--green'
    );


  const down =
    style.getPropertyValue(
      '--red'
    );


  const end =
    state.data.length -
    state.offset;


  const start =
    Math.max(
      0,
      end - state.count
    );


  const rows =
    state.data.slice(
      start,
      end
    );


  if (
    !rows.length
  ) {
    return;
  }


  const plot =
    w - 68;


  const top =
    30;


  const bottom =
    h - 72;


  const lo =
    Math.min(
      ...rows.map(
        c => c.low
      )
    );


  const hi =
    Math.max(
      ...rows.map(
        c => c.high
      )
    );


  const pad =
    (
      hi - lo
    ) * 0.15 || 1;


  const min =
    lo - pad;


  const max =
    hi + pad;


  const x =
    i =>
      (
        i + 0.5
      ) *
      plot /
      rows.length;


  const y =
    value =>
      top +
      (
        max - value
      ) /
      (
        max - min
      ) *
      (
        bottom - top
      );


  geometry = {
    start,
    end,
    rows,
    plot,
    min,
    max,
    top,
    bottom,
    x,
    y,
    w,
    h
  };


  ctx.font =
    '10px ui-monospace, monospace';


  ctx.lineWidth =
    0.7;


  /*
    PRICE GRID
  */

  for (
    let i = 0;
    i < 5;
    i++
  ) {

    const value =
      min +
      (
        max - min
      ) *
      i /
      4;


    const py =
      y(value);


    ctx.strokeStyle =
      grid;


    ctx.beginPath();

    ctx.moveTo(
      0,
      py
    );

    ctx.lineTo(
      plot,
      py
    );

    ctx.stroke();


    ctx.fillStyle =
      muted;


    ctx.fillText(
      fmt(value),
      plot + 7,
      py + 3
    );
  }


  /*
    TIME GRID
  */

  for (
    let i = 0;
    i < rows.length;
    i += Math.max(
      1,
      Math.floor(
        rows.length / 5
      )
    )
  ) {

    ctx.strokeStyle =
      grid;


    ctx.beginPath();

    ctx.moveTo(
      x(i),
      top
    );

    ctx.lineTo(
      x(i),
      h - 20
    );

    ctx.stroke();


    ctx.fillStyle =
      muted;


    const date =
      new Date(
        rows[i].time *
        1000
      );


    const label =
      date.toLocaleTimeString(
        'en-IN',
        {
          timeZone:
            'Asia/Kolkata',

          hour:
            '2-digit',

          minute:
            '2-digit',

          hour12:
            false
        }
      );


    ctx.fillText(
      label,
      Math.max(
        0,
        x(i) - 17
      ),
      h - 7
    );
  }


  /*
    INDICATOR LINE
  */

  const line =
    (
      arr,
      color,
      dash = []
    ) => {

      if (
        !Array.isArray(arr)
      ) {
        return;
      }


      ctx.save();


      ctx.beginPath();

      ctx.rect(
        0,
        top,
        plot,
        h - top - 20
      );

      ctx.clip();


      ctx.strokeStyle =
        color;


      ctx.lineWidth =
        1.2;


      ctx.setLineDash(
        dash
      );


      ctx.beginPath();


      let begun =
        false;


      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                value
              )
            ) {

              begun =
                false;

              return;
            }


            if (begun) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              begun =
                true;
            }
          }
        );


      ctx.stroke();

      ctx.restore();
    };


  /*
    BOLLINGER
  */

  if (
    state.overlays.has(
      'Bollinger'
    ) &&
    state.calc?.bb
  ) {

    line(
      state.calc.bb.map(
        b => b?.upper
      ),
      colors.Bollinger
    );


    line(
      state.calc.bb.map(
        b => b?.lower
      ),
      colors.Bollinger
    );


    line(
      state.calc.bb.map(
        b => b?.mid
      ),
      colors.Bollinger,
      [3, 4]
    );
  }


  /*
    SUPPORT / RESISTANCE
  */

  if (
    state.overlays.has(
      'S/R'
    )
  ) {

    for (
      const value of [
        lo,
        hi
      ]
    ) {

      ctx.strokeStyle =
        muted;


      ctx.setLineDash(
        [4, 5]
      );


      ctx.beginPath();

      ctx.moveTo(
        0,
        y(value)
      );

      ctx.lineTo(
        plot,
        y(value)
      );

      ctx.stroke();


      ctx.setLineDash(
        []
      );
    }
  }


  drawPriceAction(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down,
      muted
    }
  );


  /*
    CANDLES
  */

  const maxVol =
    Math.max(
      0,
      ...rows.map(
        c =>
          Number(
            c.volume
          ) || 0
      )
    );


  rows.forEach(
    (
      c,
      i
    ) => {

      ctx.strokeStyle =
        ctx.fillStyle =
          c.close >= c.open
            ? up
            : down;


      const bw =
        Math.max(
          2,
          plot /
          rows.length *
          0.6
        );


      ctx.beginPath();


      ctx.moveTo(
        x(i),
        y(c.high)
      );


      ctx.lineTo(
        x(i),
        y(c.low)
      );


      ctx.stroke();


      ctx.fillRect(
        x(i) -
        bw / 2,

        y(
          Math.max(
            c.open,
            c.close
          )
        ),

        bw,

        Math.max(
          1,
          Math.abs(
            y(c.open) -
            y(c.close)
          )
        )
      );


      /*
        Never fabricate NIFTY
        index volume.
      */

      if (
        state.overlays.has(
          'Volume'
        ) &&
        maxVol > 0 &&
        c.volume > 0
      ) {

        const vh =
          c.volume /
          maxVol *
          35;


        ctx.globalAlpha =
          0.25;


        ctx.fillRect(
          x(i) -
          bw / 2,

          h -
          23 -
          vh,

          bw,

          vh
        );


        ctx.globalAlpha =
          1;
      }
    }
  );


  /*
    MOVING AVERAGES
  */

  const indicatorLines = [
    ['EMA 9', 'e9'],
    ['EMA 21', 'e21'],
    ['EMA 50', 'e50'],
    ['EMA 200', 'e200'],
    ['SMA 50', 's50'],
    ['SMA 200', 's200'],
    ['VWAP', 'vwap']
  ];


  for (
    const [
      name,
      key
    ] of indicatorLines
  ) {

    if (
      state.overlays.has(
        name
      ) &&
      Array.isArray(
        state.calc?.[key]
      )
    ) {

      line(
        state.calc[key],
        colors[name]
      );
    }
  }


  if (state.overlays.has('Supertrend (10, 3)') && state.trend) {
    const upLine = state.trend.supertrend.map((v, i) =>
      state.trend.direction[i] === 1 ? v : null);
    const downLine = state.trend.supertrend.map((v, i) =>
      state.trend.direction[i] === -1 ? v : null);
    line(upLine, up);
    line(downLine, down);
  }

  /*
    NIFTY index candles often do not carry tradable volume.
    When index VWAP is unavailable, draw the live NIFTY
    futures VWAP as a separate fallback line.
  */

  if (
    state.overlays.has(
      'VWAP'
    ) &&
    state.symbol === 'NIFTY' &&
    !state.data.some(
      c =>
        Number(c.volume) > 0
    ) &&
    Number.isFinite(
      state.futuresVWAP
    )
  ) {

    line(
      Array(
        state.data.length
      ).fill(
        state.futuresVWAP
      ),
      colors.VWAP,
      [6, 4]
    );
  }


  /*
    STRIDE SIGNALS
  */

  if (
    state.overlays.has(
      'Stride Signals'
    )
  ) {

    for (
      const direction of [
        1,
        -1
      ]
    ) {

      line(
        state.signals.map(
          s =>
            s?.direction ===
            direction
              ? s.stop
              : null
        ),

        direction === 1
          ? up
          : down,

        [5, 3]
      );
    }


    ctx.save();


    ctx.beginPath();

    ctx.rect(
      0,
      top,
      plot,
      bottom - top
    );

    ctx.clip();


    ctx.font =
      'bold 10px system-ui';


    state.signals
      .slice(
        start,
        end
      )
      .forEach(
        (
          s,
          i
        ) => {

          if (
            !s?.signal
          ) {
            return;
          }


          const buy =
            s.signal === 'Buy';


          const label =
            buy
              ? 'BUY'
              : 'SELL';


          const bw =
            36;


          const px =
            Math.max(
              0,
              Math.min(
                plot - bw,
                x(i) -
                bw / 2
              )
            );


          const py =
            Math.max(
              top + 3,
              Math.min(
                bottom - 21,

                y(
                  buy
                    ? rows[i].low
                    : rows[i].high
                ) +
                (
                  buy
                    ? 10
                    : -27
                )
              )
            );


          ctx.fillStyle =
            buy
              ? up
              : down;


          ctx.fillRect(
            px,
            py,
            bw,
            18
          );


          ctx.fillStyle =
            style.getPropertyValue(
              '--bg'
            );


          ctx.fillText(
            label,
            px + 6,
            py + 13
          );
        }
      );


    ctx.restore();
  }


  renderMomentum(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderScalper(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderNiftyEdge(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderMarketMap(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderGainzSSL(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderChartConsensus(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderSignalStatus();


  /*
    LAST PRICE
  */

  const last =
    rows.at(-1);


  ctx.fillStyle =
    last.close >= last.open
      ? up
      : down;


  ctx.fillRect(
    plot,
    y(last.close) - 10,
    68,
    20
  );


  ctx.fillStyle =
    style.getPropertyValue(
      '--bg'
    );


  ctx.fillText(
    fmt(last.close),
    plot + 5,
    y(last.close) + 4
  );


  /*
    DRAWINGS
  */

  const list =
    state.drawings[
      state.symbol +
      state.tf
    ] || [];


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  for (
    const d of list
  ) {

    const idx =
      state.data.findIndex(
        c =>
          c.time ===
          d.a.time
      ) -
      start;


    const px =
      x(idx);


    const py =
      y(
        d.a.price
      );


    ctx.strokeStyle =
      ctx.fillStyle =
        d.type === 'exit'
          ? down
          : up;


    ctx.lineWidth =
      1.5;


    if (
      d.type === 'trend'
    ) {

      const ix =
        state.data.findIndex(
          c =>
            c.time ===
            d.b.time
        ) -
        start;


      ctx.beginPath();

      ctx.moveTo(
        px,
        py
      );

      ctx.lineTo(
        x(ix),
        y(
          d.b.price
        )
      );

      ctx.stroke();

    } else if (
      d.type === 'level'
    ) {

      ctx.beginPath();

      ctx.moveTo(
        0,
        py
      );

      ctx.lineTo(
        plot,
        py
      );

      ctx.stroke();

    } else {

      ctx.font =
        'bold 12px system-ui';


      ctx.fillText(
        d.type === 'entry'
          ? '▲ ENTRY'
          : '▼ EXIT',

        px,
        py
      );
    }
  }


  ctx.restore();


  /*
    OHLC
  */

  const hover =
    state.hover == null
      ? rows.length - 1
      : Math.max(
          0,
          Math.min(
            rows.length - 1,
            state.hover
          )
        );


  const c =
    rows[hover];


  if (
    $('#ohlc')
  ) {

    $('#ohlc').textContent =
      'O ' +
      fmt(c.open) +
      '  H ' +
      fmt(c.high) +
      '  L ' +
      fmt(c.low) +
      '  C ' +
      fmt(c.close) +
      '  V ' +
      (
        c.volume > 0
          ? (
              c.volume /
              1000
            ).toFixed(1) +
            'K'
          : 'N/A'
      );
  }


  if (
    state.hover != null
  ) {

    ctx.strokeStyle =
      muted;


    ctx.setLineDash(
      [3, 3]
    );


    ctx.beginPath();

    ctx.moveTo(
      x(hover),
      top
    );

    ctx.lineTo(
      x(hover),
      h - 20
    );

    ctx.stroke();


    ctx.setLineDash(
      []
    );
  }


  /*
    RSI
  */

  drawPane(
    '#rsi',
    [
      state.calc.rsi
    ],
    [
      '#a996ec'
    ],
    start,
    end,
    0,
    100,
    [
      30,
      70
    ]
  );


  /*
    MACD
  */

  const macdValues = [
    ...state.calc.macd.slice(
      start,
      end
    ),

    ...state.calc.signal.slice(
      start,
      end
    ),

    ...state.calc.hist.slice(
      start,
      end
    )
  ].filter(
    Number.isFinite
  );


  const ml =
    Math.min(
      0,
      ...macdValues
    );


  const mh =
    Math.max(
      0,
      ...macdValues
    );


  drawPane(
    '#macd',

    [
      state.calc.macd,
      state.calc.signal
    ],

    [
      '#7fa8f5',
      '#e6ba6f'
    ],

    start,
    end,

    ml -
    (
      mh - ml
    ) *
    0.1,

    mh +
    (
      mh - ml
    ) *
    0.1,

    [0],

    state.calc.hist
  );


  const lastRSI =
    state.calc.rsi.at(-1);


  const lastMACD =
    state.calc.macd.at(-1);


  if (
    $('#rsi-value')
  ) {

    $('#rsi-value').textContent =
      Number.isFinite(
        lastRSI
      )
        ? lastRSI.toFixed(2)
        : '—';
  }


  if (
    $('#macd-value')
  ) {

    $('#macd-value').textContent =
      Number.isFinite(
        lastMACD
      )
        ? lastMACD.toFixed(2)
        : '—';
  }


  /*
    LEVELS
  */

  if (
    $('#levels')
  ) {

    const vwap =
      state.calc.vwap?.at(-1);


    const hasVolume =
      state.data.some(
        c =>
          Number(
            c.volume
          ) > 0
      );


    const sessionVWAP =
      hasVolume &&
      Number.isFinite(vwap)
        ? vwap
        : null;


    const fallbackVWAP =
      state.symbol === 'NIFTY' &&
      Number.isFinite(
        state.futuresVWAP
      )
        ? state.futuresVWAP
        : null;


    const displayedVWAP =
      sessionVWAP ??
      fallbackVWAP;


    const vwapLabel =
      sessionVWAP !== null
        ? 'VWAP · session'
        : fallbackVWAP !== null
          ? 'VWAP · NIFTY FUT'
          : 'VWAP · unavailable';


    $('#levels').innerHTML = `
      <div>

        <small>
          Resistance
        </small>

        <strong class="down">
          ${fmt(hi)}
        </strong>

      </div>


      <div>

        <small>
          ${vwapLabel}
        </small>

        <strong>
          ${
            Number.isFinite(
              displayedVWAP
            )
              ? fmt(
                  displayedVWAP
                )
              : 'N/A'
          }
        </strong>

      </div>


      <div>

        <small>
          Support
        </small>

        <strong class="up">
          ${fmt(lo)}
        </strong>

      </div>
    `;
  }
}


/* ======================================================
   RSI / MACD PANES
====================================================== */


function drawPane(
  id,
  series,
  paneColors,
  start,
  end,
  min,
  max,
  thresholds,
  hist
) {

  const {
    ctx,
    w,
    h
  } = canvas(id);


  const plot =
    w - 62;


  const n =
    Math.max(
      1,
      end - start
    );


  const x =
    i =>
      (
        i + 0.5
      ) *
      plot /
      n;


  const y =
    value =>
      5 +
      (
        max - value
      ) /
      (
        max - min || 1
      ) *
      (
        h - 15
      );


  const style =
    getComputedStyle(
      document.body
    );


  ctx.font =
    '9px monospace';


  ctx.fillStyle =
    style.getPropertyValue(
      '--muted'
    );


  for (
    const t of thresholds
  ) {

    ctx.strokeStyle =
      style.getPropertyValue(
        '--line'
      );


    ctx.setLineDash(
      [3, 4]
    );


    ctx.beginPath();

    ctx.moveTo(
      0,
      y(t)
    );

    ctx.lineTo(
      plot,
      y(t)
    );

    ctx.stroke();


    ctx.fillText(
      t.toFixed(0),
      plot + 10,
      y(t) + 3
    );
  }


  ctx.setLineDash(
    []
  );


  if (hist) {

    hist
      .slice(
        start,
        end
      )
      .forEach(
        (
          value,
          i
        ) => {

          if (
            !Number.isFinite(
              value
            )
          ) {
            return;
          }


          ctx.fillStyle =
            value >= 0
              ? '#72e4bd66'
              : '#f17c8666';


          ctx.fillRect(
            x(i) -
            plot /
            n *
            0.3,

            Math.min(
              y(0),
              y(value)
            ),

            plot /
            n *
            0.6,

            Math.max(
              1,
              Math.abs(
                y(value) -
                y(0)
              )
            )
          );
        }
      );
  }


  series.forEach(
    (
      arr,
      k
    ) => {

      ctx.strokeStyle =
        paneColors[k];


      ctx.lineWidth =
        1.2;


      ctx.beginPath();


      let began =
        false;


      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                value
              )
            ) {

              began =
                false;

              return;
            }


            if (began) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              began =
                true;
            }
          }
        );


      ctx.stroke();
    }
  );
}


/* ======================================================
   SUMMARY + DATE
====================================================== */


function summary() {

  /*
    DISPLAY ACTUAL UPSTOX
    SESSION DATE
  */

  updateTradingDate();

  if (
    $('#tv-range-clock')
  ) {
    $('#tv-range-clock').textContent =
      new Date()
        .toLocaleTimeString(
          'en-IN',
          {
            timeZone:
              'Asia/Kolkata',
            hour:
              '2-digit',
            minute:
              '2-digit',
            hour12:
              false
          }
        ) +
      ' IST · ' +
      (
        isNseCashMarketOpen()
          ? 'LIVE'
          : 'CLOSED'
      );
  }


  if (
    !state.data.length
  ) {
    return;
  }


  const instrument =
    current();


  const ch =
    change(
      instrument
    );


  const currentPrice =
    quote();


  if (
    $('#symbol-name')
  ) {

    $('#symbol-name').textContent =
      instrument.name;
  }


  if (
    $('#instrument-kind')
  ) {

    $('#instrument-kind').textContent =
      instrument.kind;
  }


  if (
    $('#price')
  ) {

    $('#price').textContent =
      fmt(
        currentPrice
      );
  }


  if (
    $('#change')
  ) {

    $('#change').className =
      Number.isFinite(ch)
        ? ch >= 0
          ? 'up'
          : 'down'
        : 'muted';


    $('#change').textContent =
      Number.isFinite(ch)
        ? formatChange(ch)
        : '—';
  }


  if (
    $('#signal-tf')
  ) {

    $('#signal-tf').textContent =
      state.tf;
  }


  const calc =
    state.calc;


  if (!calc) {
    return;
  }


  // Technical Outlook must use one consistent CLOSED candle.
  // Mixing the live candle with closed-candle trend filters caused
  // Neutral / directional counts to disagree.
  const closed =
    Math.max(
      0,
      state.data.length - 2
    );

  const r =
    calc.rsi?.[closed];

  const e9 =
    calc.e9?.[closed];

  const e21 =
    calc.e21?.[closed];

  const hist =
    calc.hist?.[closed];

  if (
    !Number.isFinite(r) ||
    !Number.isFinite(e9) ||
    !Number.isFinite(e21) ||
    !Number.isFinite(hist)
  ) {
    return;
  }


  const e =
    e9 > e21
      ? 1
      : e9 < e21
        ? -1
        : 0;


  const m =
    hist > 0
      ? 1
      : hist < 0
        ? -1
        : 0;


  const rs =
    r >= 55
      ? 1
      : r <= 45
        ? -1
        : 0;


  const directions =
    [e, rs, m];

  const bullishCount =
    directions.filter(
      value =>
        value === 1
    ).length;

  const bearishCount =
    directions.filter(
      value =>
        value === -1
    ).length;

  const neutralCount =
    directions.filter(
      value =>
        value === 0
    ).length;


  const candidate =
    bullishCount >= 2
      ? 'Buy'
      : bearishCount >= 2
        ? 'Sell'
        : 'Neutral';


  const trend =
    state.trend;

  const stOn =
    state.overlays.has(
      'Supertrend (10, 3)'
    );

  const dmiOn =
    state.overlays.has(
      'ADX/DMI (14)'
    );

  const stDirection =
    trend?.direction?.[closed] ||
    0;

  const adxValue =
    trend?.adx?.[closed];

  const plusValue =
    trend?.plusDI?.[closed];

  const minusValue =
    trend?.minusDI?.[closed];

  const side =
    candidate === 'Buy'
      ? 1
      : candidate === 'Sell'
        ? -1
        : 0;

  const stPass =
    !stOn ||
    (
      side !== 0 &&
      stDirection === side
    );

  const dmiPass =
    !dmiOn ||
    (
      Number.isFinite(
        adxValue
      ) &&
      adxValue >= 20 &&
      (
        side === 1
          ? plusValue > minusValue
          : side === -1
            ? minusValue > plusValue
            : false
      )
    );

  const mtfDirection =
  state.mtf.overall.includes('BUY')
    ? 1
    : state.mtf.overall.includes('SELL')
      ? -1
      : 0;

const mtfPass =
  side !== 0 &&
  mtfDirection === side;

const label =
  side !== 0 &&
  stPass &&
  dmiPass &&
  mtfPass
    ? candidate
    : 'Neutral';

  const score =
    bullishCount -
    bearishCount;

  const closedClose = Number(state.data[closed]?.close);
  const closedEMA9 = calc.e9?.[closed];
  const closedEMA21 = calc.e21?.[closed];
  const closedRSI = calc.rsi?.[closed];
  const ready = [closedClose, trend?.supertrend[closed], adxValue,
    plusValue, minusValue, closedEMA9, closedEMA21, closedRSI]
    .every(Number.isFinite);
  const dmiDirection = plusValue > minusValue ? 1 :
    minusValue > plusValue ? -1 : 0;
  const momentumDirection = closedEMA9 > closedEMA21 && closedRSI >= 50
    ? 1 : closedEMA9 < closedEMA21 && closedRSI < 50 ? -1 : 0;
  const toolkitSide = ready && adxValue >= 20 &&
    stDirection !== 0 && stDirection === dmiDirection &&
    stDirection === momentumDirection ? stDirection : 0;
  const toolkitState = !ready ? 'WARMING UP' :
    toolkitSide === 1 ? 'BUY aligned' :
    toolkitSide === -1 ? 'SELL aligned' : 'WAIT';
  const toolkitStatus = $('#tradeiq-state');
  if (toolkitStatus) {
    toolkitStatus.textContent = toolkitState;
    toolkitStatus.className = toolkitSide === 1 ? 'up' :
      toolkitSide === -1 ? 'down' : 'muted';
  }
  const toolkitTrend = $('#tradeiq-trend');
  if (toolkitTrend) toolkitTrend.textContent = !ready ? 'Warming up' :
    stDirection === 1 ? 'Bullish' : stDirection === -1 ? 'Bearish' : 'Mixed';
  const toolkitStrength = $('#tradeiq-strength');
  if (toolkitStrength) toolkitStrength.textContent = !ready ? 'Warming up' :
    'ADX ' + adxValue.toFixed(1) + ' · ' +
    (adxValue < 20 ? 'Weak trend' : dmiDirection === 1 ? '+DI leads' :
      dmiDirection === -1 ? '-DI leads' : 'DI tied');
  const toolkitMomentum = $('#tradeiq-momentum');
  if (toolkitMomentum) toolkitMomentum.textContent = !ready ? 'Warming up' :
    momentumDirection === 1 ? 'Bullish' :
    momentumDirection === -1 ? 'Bearish' : 'Mixed';



  if (
    $('#signal-label')
  ) {

    $('#signal-label').textContent =
      label;


    $('#signal-label').style.color =
      label === 'Sell'
        ? 'var(--red)'
        : label === 'Neutral'
          ? 'var(--gold)'
          : 'var(--green)';
  }


  if (
    $('#signal-icon')
  ) {

    $('#signal-icon').textContent =
      label === 'Buy'
        ? '↗'
        : label === 'Sell'
          ? '↘'
          : '→';
  }


  if (
    $('#signal-summary')
  ) {

    $('#signal-summary').textContent =
      bullishCount +
      ' bullish · ' +
      bearishCount +
      ' bearish' +
      (
        neutralCount
          ? ' · ' +
            neutralCount +
            ' neutral'
          : ''
      ) +
      (
        candidate === 'Neutral'
          ? ' · no 2-of-3 direction'
          : label === 'Neutral'
            ? ' · blocked by Supertrend / ADX-DMI confirmation'
            : ' · confirmed'
      );
  }


  if (
    $('#signal-reasons')
  ) {

    $('#signal-reasons').innerHTML = `

      <div class="reason">

        <span>
          EMA 9 / 21 crossover
        </span>

        <b>
          ${
            e > 0
              ? 'Bullish'
              : e < 0
                ? 'Bearish'
                : 'Neutral'
          }
        </b>

      </div>


      <div class="reason">

        <span>
          RSI (14)
        </span>

        <b>
          ${r.toFixed(1)} ·
          ${
            rs > 0
              ? 'Bullish'
              : rs < 0
                ? 'Bearish'
                : 'Neutral'
          }
        </b>

      </div>


      <div class="reason">

        <span>
          MACD momentum
        </span>

        <b>
          ${
            m > 0
              ? 'Bullish'
              : m < 0
                ? 'Bearish'
                : 'Neutral'
          }
        </b>

      </div>
      <div class="reason">
        <span>Supertrend (10, 3) ${stOn ? '· filter on' : '· filter off'}</span>
        <b>${stDirection === 1 ? 'Bullish' : stDirection === -1 ? 'Bearish' : 'Warming up'}</b>
      </div>
      <div class="reason">
        <span>ADX/DMI (14) ${dmiOn ? '· filter on' : '· filter off'}</span>
        <b>${Number.isFinite(adxValue)
          ? 'ADX ' + adxValue.toFixed(1) + ' · +DI ' + plusValue.toFixed(1) +
            ' / -DI ' + minusValue.toFixed(1)
          : 'Warming up'}</b>
      </div>
    `;
  }


  $$('.signal-meter i')
    .forEach(
      (
        el,
        j
      ) => {

        const active =
          j <
          Math.abs(score) +
          1;


        el.classList.toggle(
          'lit',
          active
        );


        el.style.background =
          active
            ? score < 0
              ? 'var(--red)'
              : score === 0
                ? 'var(--gold)'
                : 'var(--green)'
            : '';
      }
    );


  renderAiNifty();

  renderProSuiteSummary();

  updateMarketMapPanel();

  renderCandleScanner();

  renderTradeFinalizer();

  renderGainzSSLPanel();

  recomputeAllIndicatorsConsensus();

  renderWatch();
}


/* ======================================================
   REPLAY + MULTI-TIMEFRAME CONFIRMATION
====================================================== */


function updateReplayControls() {

  const r =
    state.replay;


  if (
    $('#replay-toggle')
  ) {

    $('#replay-toggle').textContent =
      r.active
        ? '● Replay'
        : '↶ Replay';


    $('#replay-toggle').classList.toggle(
      'active',
      r.active
    );
  }


  if (
    $('#replay-play')
  ) {

    $('#replay-play').textContent =
      r.playing
        ? '❚❚ Pause'
        : '▶ Play';


    $('#replay-play').disabled =
      !r.active;
  }


  if (
    $('#replay-step')
  ) {

    $('#replay-step').disabled =
      !r.active;
  }


  if (
    $('#replay-live')
  ) {

    $('#replay-live').disabled =
      !r.active;
  }


  if (
    $('#replay-status')
  ) {

    if (!r.active) {

      $('#replay-status').textContent =
        'LIVE';

      $('#replay-status').className =
        'replay-status live';

    } else {

      const total =
        r.source.length;

      const shown =
        Math.min(
          total,
          r.index + 1
        );

      $('#replay-status').textContent =
        'REPLAY ' +
        shown +
        ' / ' +
        total;

      $('#replay-status').className =
        'replay-status replay';
    }
  }
}


function clearReplayTimer() {

  if (
    state.replay.timer
  ) {

    clearInterval(
      state.replay.timer
    );

    state.replay.timer =
      null;
  }


  state.replay.playing =
    false;
}


function renderReplayFrame() {

  const r =
    state.replay;


  if (
    !r.active ||
    !r.source.length
  ) {
    return;
  }


  const end =
    Math.max(
      1,
      Math.min(
        r.source.length,
        r.index + 1
      )
    );


  state.data =
    r.source.slice(
      0,
      end
    );


  state.quotes[
    state.symbol
  ] =
    state.data.at(-1)
      ?.close ??
    null;


  state.offset =
    0;

  state.hover =
    null;

  lastAnalysisKey =
    null;


  draw();

  summary();

  updateReplayControls();


  if (
    r.index >=
    r.source.length - 1
  ) {

    clearReplayTimer();

    updateReplayControls();

    toast(
      'Replay complete'
    );
  }
}


function startReplay() {

  if (
    state.replay.active
  ) {
    return;
  }


  if (
    !Array.isArray(
      state.data
    ) ||
    state.data.length < 221
  ) {

    toast(
      'Not enough candles to start replay.'
    );

    return;
  }


  unsubscribe?.();

  unsubscribe =
    null;


  const source =
    state.data.map(
      candle => ({
        ...candle
      })
    );


  const warmup =
  Math.min(
    source.length - 2,
    220
  );

  state.replay.active =
    true;

  state.replay.playing =
    false;

  state.replay.source =
    source;

  state.replay.index =
    warmup;


  setFeedStatus(
    'REPLAY',
    '● REPLAY MODE · historical candles'
  );


  renderReplayFrame();

  toast(
    'Replay mode started'
  );
}


function stepReplay() {

  const r =
    state.replay;


  if (
    !r.active
  ) {

    startReplay();

    return;
  }


  clearReplayTimer();


  if (
    r.index <
    r.source.length - 1
  ) {

    r.index +=
      1;

    renderReplayFrame();
  }
}


function toggleReplayPlay() {

  const r =
    state.replay;


  if (
    !r.active
  ) {

    startReplay();
  }


  if (
    state.replay.playing
  ) {

    clearReplayTimer();

    updateReplayControls();

    return;
  }


  state.replay.playing =
    true;


  state.replay.timer =
    setInterval(
      () => {

        if (
          !state.replay.active
        ) {

          clearReplayTimer();

          return;
        }


        if (
          state.replay.index >=
          state.replay.source.length - 1
        ) {

          clearReplayTimer();

          updateReplayControls();

          return;
        }


        state.replay.index +=
          1;


        renderReplayFrame();

      },
      state.replay.speed
    );


  updateReplayControls();
}


function exitReplay(
  reloadLive = true
) {

  clearReplayTimer();


  state.replay.active =
    false;

  state.replay.source =
    [];

  state.replay.index =
    0;


  updateReplayControls();


  if (
    reloadLive
  ) {

    loadData();

  } else {

    setFeedStatus(
      'LOADING',
      'Returning to live data…'
    );
  }
}


function timeframeTrend(
  candles
) {

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length < 30
  ) {

    return {
      state:
        !Array.isArray(candles) ||
        !candles.length
          ? 'DATA UNAVAILABLE'
          : 'WARMING UP',
      side: 0
    };
  }


  const calc =
    indicators(
      candles
    );

  const tr =
    trendIndicators(
      candles
    );


  const closed =
    Math.max(
      0,
      candles.length - 2
    );


  const e9 =
    calc.e9?.[
      closed
    ];

  const e21 =
    calc.e21?.[
      closed
    ];

  const e50 =
    calc.e50?.[
      closed
    ];

  const rsi =
    calc.rsi?.[
      closed
    ];

  const st =
    tr.direction?.[
      closed
    ] ||
    0;

  const adx =
    tr.adx?.[
      closed
    ];

  const plus =
    tr.plusDI?.[
      closed
    ];

  const minus =
    tr.minusDI?.[
      closed
    ];


  if (
    ![
      e9,
      e21,
      e50,
      rsi,
      adx,
      plus,
      minus
    ].every(
      Number.isFinite
    )
  ) {

    return {
      state: 'WARMING UP',
      side: 0
    };
  }


  let bull =
    0;

  let bear =
    0;


  if (
    e9 >
    e21
  ) {
    bull += 1;
  } else if (
    e9 <
    e21
  ) {
    bear += 1;
  }


  if (
    e21 >
    e50
  ) {
    bull += 1;
  } else if (
    e21 <
    e50
  ) {
    bear += 1;
  }


  if (
    st === 1
  ) {
    bull += 1;
  } else if (
    st === -1
  ) {
    bear += 1;
  }


  if (
    adx >= 20 &&
    plus >
    minus
  ) {
    bull += 1;
  } else if (
    adx >= 20 &&
    minus >
    plus
  ) {
    bear += 1;
  }


  if (
    rsi >= 52
  ) {
    bull += 1;
  } else if (
    rsi <= 48
  ) {
    bear += 1;
  }


  if (
    bull >= 4
  ) {

    return {
      state:
        adx >= 25
          ? 'STRONG BULLISH'
          : 'BULLISH',
      side: 1
    };
  }


  if (
    bear >= 4
  ) {

    return {
      state:
        adx >= 25
          ? 'STRONG BEARISH'
          : 'BEARISH',
      side: -1
    };
  }


  return {
    state: 'RANGE / MIXED',
    side: 0
  };
}


function renderMTF() {

  const map = [
    [
      '5m',
      '#mtf-5m'
    ],
    [
      '15m',
      '#mtf-15m'
    ],
    [
      '1h',
      '#mtf-1h'
    ]
  ];


  for (
    const [
      key,
      selector
    ] of map
  ) {

    const el =
      $(selector);

    const row =
      state.mtf[
        key
      ];


    if (!el) {
      continue;
    }


    el.textContent =
      row?.state ??
      (
        state.mtf.loading
          ? 'LOADING…'
          : '—'
      );


    el.className =
      row?.side === 1
        ? 'up'
        : row?.side === -1
          ? 'down'
          : 'muted';
  }


  const overall =
    $('#mtf-overall');


  if (
    overall
  ) {

    overall.textContent =
      state.mtf.overall;


    overall.className =
      state.mtf.overall.includes(
        'BUY'
      )
        ? 'up'
        : state.mtf.overall.includes(
            'SELL'
          )
          ? 'down'
          : 'muted';
  }
}


async function refreshMTF() {
  const requestedSymbol = state.symbol;

  if (
    state.replay.active ||
    state.mtf.loading
  ) {
    return;
  }


  state.mtf.loading =
    true;

  renderMTF();


  try {

    const settled =
      await Promise.allSettled([
        market.mtfHistory(
          requestedSymbol,
          '5m'
        ),
        market.mtfHistory(
          requestedSymbol,
          '15m'
        ),
        market.mtfHistory(
          requestedSymbol,
          '1h'
        )
      ]);


    const resultCandles =
      settled.map(
        result =>
          result.status ===
            'fulfilled'
            ? result.value
            : []
      );


    if (state.symbol !== requestedSymbol || state.replay.active) return;
    state.primeMtfSymbol = requestedSymbol;
    state.primeMtfData = { '5m': resultCandles[0], '15m': resultCandles[1], '1h': resultCandles[2] };

    state.mtf['5m'] =
      timeframeTrend(
        resultCandles[0]
      );

    state.mtf['15m'] =
      timeframeTrend(
        resultCandles[1]
      );

    state.mtf['1h'] =
      timeframeTrend(
        resultCandles[2]
      );


    const edge =
      state.niftyEdge
        ?.latest;

    const signalSide =
      [
        'BUY+',
        'SELL+',
        'BUY',
        'SELL'
      ].includes(
        edge?.signal
      )
        ? edge.side
        : 0;

    const s5 =
      state.mtf['5m']
        ?.side ??
      0;

    const s15 =
      state.mtf['15m']
        ?.side ??
      0;

    const s1h =
      state.mtf['1h']
        ?.side ??
      0;


    if (
      signalSide === 1 &&
      s5 === 1 &&
      s15 === 1 &&
      s1h === 1
    ) {

      state.mtf.overall =
        'HIGH-CONFIDENCE BUY+';

    } else if (
      signalSide === -1 &&
      s5 === -1 &&
      s15 === -1 &&
      s1h === -1
    ) {

      state.mtf.overall =
        'HIGH-CONFIDENCE SELL+';

    } else if (
      [
        state.mtf['5m']?.state,
        state.mtf['15m']?.state,
        state.mtf['1h']?.state
      ].every(
        value =>
          value ===
          'DATA UNAVAILABLE'
      )
    ) {

      state.mtf.overall =
        'DATA UNAVAILABLE';

    } else {

      state.mtf.overall =
        'NO TRADE';
    }


    state.mtf.updated =
      Date.now();

  } catch (
    error
  ) {

    state.primeMtfData = {};
    console.warn(
      'Multi-timeframe confirmation unavailable:',
      error
    );

    state.mtf['5m'] =
      state.mtf['5m'] ||
      {
        state:
          'DATA UNAVAILABLE',
        side: 0
      };

    state.mtf['15m'] =
      state.mtf['15m'] ||
      {
        state:
          'DATA UNAVAILABLE',
        side: 0
      };

    state.mtf['1h'] =
      state.mtf['1h'] ||
      {
        state:
          'DATA UNAVAILABLE',
        side: 0
      };

    state.mtf.overall =
      'DATA UNAVAILABLE';

  } finally {

    state.mtf.loading =
      false;

    renderMTF();

    recomputeAllIndicatorsConsensus?.();
  }
}


function scheduleReconnect() {

  if (
    state.replay.active
  ) {
    return;
  }


  clearTimeout(
    reconnectTimer
  );


  reconnectAttempts +=
    1;


  const delay =
    Math.min(
      15000,
      1500 *
      reconnectAttempts
    );


  setFeedStatus(
    'RECONNECTING',
    'Retrying in ' +
    Math.ceil(
      delay /
      1000
    ) +
    's'
  );


  reconnectTimer =
    setTimeout(
      () => {

        loadData().catch(
          () => {}
        );
      },
      delay
    );
}


/* ======================================================
   LIVE UPSTOX DATA
====================================================== */


async function loadData() {
  state.rawTradeFinalizer = null;
  state.tradeFinalizer = null;
  state.liveTradeFinalizer = null;
  state.allIndicatorsConsensus = null;
  state.primeMtfData = {};
  lastAnalysisKey = null;
  refreshPrimeConfirmation();
  renderTradeFinalizer();
  renderAllIndicatorsConsensus();
  renderProSuiteSummary();

  activateAllIndicators();


  clearTimeout(
    reconnectTimer
  );

  reconnectTimer =
    null;


  const id =
    ++request;
  lastAnalysisKey = null;


  unsubscribe?.();

  unsubscribe =
    null;


  state.data =
    [];


  state.calc =
    null;


  state.gainzSSL =
    null;


  state.tradeFinalizer =
    null;

  state.liveTradeFinalizer =
    null;


  state.candleScanner =
    null;


  state.candleSetup =
    null;


  state.marketMap =
    null;


  state.niftyEdge =
    null;


  state.niftyEdgeBacktest =
    null;


  state.proSuite =
    null;


  state.proBacktest =
    null;


  state.smartSignal =
    null;


  state.smartPlan =
    null;


  state.smartStructure =
    null;


  state.smartMarketState =
    'WAIT';


  state.hover =
    null;


  state.offset =
    0;


  updateTradingDate();


  setFeedStatus(
    'LOADING',
    'Loading current + previous trading session…'
  );


  try {

    const data =
      await market.history(
        state.symbol,
        state.tf
      );


    if (
      id !== request
    ) {
      return;
    }


    if (
      !Array.isArray(data) ||
      !data.length
    ) {

      throw new Error(
        'No Upstox candles available.'
      );
    }


    state.data =
      data
        .filter(
          c =>
            c &&
            Number.isFinite(
              c.time
            ) &&
            Number.isFinite(
              c.open
            ) &&
            Number.isFinite(
              c.high
            ) &&
            Number.isFinite(
              c.low
            ) &&
            Number.isFinite(
              c.close
            )
        )
        .sort(
          (
            a,
            b
          ) =>
            a.time -
            b.time
        );


    if (
      !state.data.length
    ) {

      throw new Error(
        'No valid Upstox candles available.'
      );
    }


    /*
      SESSION OPEN REFERENCE:
      history now contains yesterday/previous trading
      session as well, so use the first candle from the
      latest trading date.
    */

    const latestSessionDate =
      formatTradingDate(
        state.data.at(-1).time
      );

    const latestSessionFirst =
      state.data.find(
        candle =>
          formatTradingDate(
            candle.time
          ) ===
          latestSessionDate
      ) ||
      state.data[0];

    state.sessionOpen[
      state.symbol
    ] =
      latestSessionFirst.open;


    state.quotes[
      state.symbol
    ] =
      state.data.at(-1).close;


    state.offset =
      0;


    state.hover =
      null;


    /*
      DATE NOW COMES FROM
      THE ACTUAL FIRST
      UPSTOX CANDLE
    */

    updateTradingDate();


    activateAllIndicators();


    refreshLiveTradeFinalizer();


    draw();

    summary();

    refreshMTF().catch(
      () => {}
    );

    // Load previous trading session in the background so it never
    // blocks today's live chart or quote.
    market.previousHistory(
      state.symbol,
      state.tf
    ).then(
      previousCandles => {

        if (
          id !== request ||
          !Array.isArray(
            previousCandles
          ) ||
          !previousCandles.length
        ) {
          return;
        }

        const merged =
          [
            ...previousCandles,
            ...state.data
          ]
            .sort(
              (x, y) =>
                x.time - y.time
            );

        const unique = [];

        for (
          const candle of merged
        ) {
          const last =
            unique.at(-1);

          if (
            last &&
            last.time ===
              candle.time
          ) {
            unique[
              unique.length - 1
            ] =
              candle;
          } else {
            unique.push(
              candle
            );
          }
        }

        state.data =
          unique.slice(
            -500
          );

        lastAnalysisKey =
          null;

        updateTradingDate();

        scheduleLiveRender(
          true
        );

        refreshMTF().catch(
          () => {}
        );
      }
    ).catch(
      () => {}
    );

    // The optional futures VWAP request must not hold up the first chart.
    refreshFuturesVWAP().then(() => {
      if (id === request) {
        lastAnalysisKey =
          null;

        scheduleLiveRender(
          true
        );
      }
    });


    signalTracker.baseline(
      state.signals || []
    );


    scalpTracker.baseline(
      state.scalps || []
    );


    momentumTracker.baseline(
      state.momentum || []
    );


    reconnectAttempts =
      0;

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      null;


    setFeedStatus(
      isNseCashMarketOpen()
        ? 'LIVE'
        : 'CLOSED'
    );


    refreshMTF().catch(
      () => {}
    );

    refreshExternalNifty().catch(
      () => {}
    );


    unsubscribe =
      market.subscribe(
        state.symbol,
        state.tf,

        tick => {

          if (
            !tick ||
            !Number.isFinite(
              Number(
                tick.price
              )
            )
          ) {
            return;
          }


          const price =
            Number(
              tick.price
            );


          const tickTime =
            Number.isFinite(
              Number(
                tick.time
              )
            )
              ? Number(
                  tick.time
                )
              : Math.floor(
                  Date.now() /
                  1000
                );


          const seconds =
            intervals[
              state.tf
            ];


          if (
            !Number.isFinite(
              seconds
            ) ||
            seconds <= 0
          ) {
            return;
          }


          const bucket =
            Math.floor(
              tickTime /
              seconds
            ) *
            seconds;


          let last =
            state.data.at(-1);


          if (!last) {
            return;
          }


          const isNewCandle =
            bucket >
            last.time;


          if (
            isNewCandle
          ) {

            const previousClose =
              last.close;


            state.data.push({
              time:
                bucket,

              open:
                previousClose,

              high:
                Math.max(
                  previousClose,
                  price
                ),

              low:
                Math.min(
                  previousClose,
                  price
                ),

              close:
                price,

              volume:
                Number(
                  tick.volume
                ) || 0
            });

          } else if (
            bucket ===
            last.time
          ) {

            last.close =
              price;


            last.high =
              Math.max(
                last.high,
                price
              );


            last.low =
              Math.min(
                last.low,
                price
              );


            if (
              Number.isFinite(
                Number(
                  tick.volume
                )
              ) &&
              Number(
                tick.volume
              ) > 0
            ) {

              last.volume =
                Number(
                  tick.volume
                );
            }
          }


          state.quotes[
            state.symbol
          ] =
            price;


          if (
            Number.isFinite(
              Number(
                tick.changePercent
              )
            )
          ) {
            state.officialChange[
              state.symbol
            ] =
              Number(
                tick.changePercent
              );
          }


          if (
            Number.isFinite(
              Number(
                tick.previousClose
              )
            )
          ) {
            state.previousClose[
              state.symbol
            ] =
              Number(
                tick.previousClose
              );
          }


          state.lastUpdate =
            Date.now();


          refreshLiveTradeFinalizer();

          recomputeAiNifty();


          if (
            state.data.length >
            500
          ) {

            state.data =
              state.data.slice(
                -500
              );
          }


          updateTradingDate();

          scheduleLiveRender();

          if (
            isNewCandle
          ) {

            processSignalAlerts();

            processScalpAlerts();

            processMomentumAlerts();

            refreshMTF().catch(
              () => {}
            );
          }

          checkAlerts();


          setFeedStatus(
            !isNseCashMarketOpen()
              ? 'CLOSED'
              : tick.fallback
                ? 'FALLBACK'
                : 'LIVE'
          );
        },

        error => {

          console.error(
            'Upstox live feed:',
            error
          );


          setFeedStatus(
            isNseCashMarketOpen()
              ? 'RECONNECTING'
              : 'CLOSED',
            isNseCashMarketOpen()
              ? 'Live quote retrying · chart preserved'
              : ''
          );
        }
      );

  } catch (
    error
  ) {

    console.error(
      'Upstox history error:',
      error
    );


    state.data =
      [];


    updateTradingDate();


    setFeedStatus(
      'DATA UNAVAILABLE',
      error?.message ||
      'Upstox connection failed'
    );


    toast(
      error?.message ||
      'Upstox market data unavailable.'
    );


    scheduleReconnect();
  }
}


function activateAllIndicators() {

  state.overlays =
    new Set(
      Object.keys(
        colors
      )
    );

  $$('#indicators [data-indicator]')
    .forEach(
      button => {

        button.classList.add(
          'on'
        );

        button.setAttribute(
          'aria-pressed',
          'true'
        );
      }
    );
}


/* ======================================================
   INDICATOR BUTTONS
====================================================== */


if (
  $('#indicators')
) {

  $('#indicators').innerHTML =
    Object.entries(
      colors
    )
      .map(
        (
          [
            name,
            color
          ]
        ) => `
          <button
            class="${
              state.overlays.has(
                name
              )
                ? 'on'
                : ''
            }"
            data-indicator="${name}"
            style="--color:${color}"
            aria-pressed="${
              state.overlays.has(
                name
              )
            }"
          >
            ${name}
          </button>
        `
      )
      .join('');
}


function runSmrtDiagnostics() {

  const requiredIds = [
    'chart',
    'tv-lightweight-chart',
    'watch-rows',
    'signal-label',
    'mtf-overall',
    'market-map-panel',
    'candle-scanner-panel',
    'all-indicators-panel',
    'all-indicators-chat-panel',
    'global-watch-panel',
    'ai-nifty-panel',
    'trade-finalizer-panel',
    'gainz-ssl-panel',
    'replay-toggle',
    'indicators-toggle'
  ];

  const missing =
    requiredIds.filter(
      id =>
        !document.getElementById(
          id
        )
    );

  const engines = {
    indicators:
      typeof indicators ===
      'function',
    trendIndicators:
      typeof trendIndicators ===
      'function',
    proScalper:
      typeof proScalper ===
      'function',
    niftyEdge:
      typeof analyseNiftyEdge ===
      'function',
    marketMap:
      typeof analyseMarketMap ===
      'function',
    candleScanner:
      typeof scanCandles ===
      'function',
    tradeFinalizer:
      typeof finalizeTrade ===
      'function',
    gainzSSL:
      typeof analyseGainzSSL ===
      'function',
    aiNifty:
      typeof analyseSmrtAiNifty ===
      'function',
    globalWatch:
      typeof analyseGlobalWatch ===
      'function',
    allIndicators:
      typeof analyseAllIndicators ===
      'function',
    chartConsensus:
      typeof analyseChartConsensus ===
      'function',
    tradingViewDatafeed:
      Boolean(
        window.SMRTTradingViewDatafeed
      )
  };

  const failedEngines =
    Object.entries(
      engines
    )
      .filter(
        ([, ok]) =>
          !ok
      )
      .map(
        ([name]) =>
          name
      );

  const result = {
    ok:
      missing.length === 0 &&
      failedEngines.length === 0,
    missingElements:
      missing,
    failedEngines,
    engines,
    checkedAt:
      new Date()
        .toISOString()
  };

  window.SMRTDiagnostics =
    result;

  if (!result.ok) {
    console.error(
      'SMRT diagnostics failed',
      result
    );
  } else {
    console.info(
      'SMRT diagnostics OK',
      result
    );
  }

  return result;
}


let checkAlerts =
  () => {};


loadData();

setupAllIndicatorsChat();


// TradingView-style chart controls.
if (
  $('#chart-view-tv')
) {
  $('#chart-view-tv').onclick =
    () =>
      setChartView(
        'tradingview'
      );
}

if (
  $('#chart-view-classic')
) {
  $('#chart-view-classic').onclick =
    () =>
      setChartView(
        'classic'
      );
}

if (
  $('#tv-indicators-btn')
) {
  $('#tv-indicators-btn').onclick =
    () => {
      $('#indicators')
        ?.classList.toggle(
          'hidden'
        );
    };
}

if (
  $('#tv-reset-btn')
) {
  $('#tv-reset-btn').onclick =
    () => {
      state.count = 90;
      state.offset = 0;
      state.hover = null;

      tvLiteChart
        ?.timeScale()
        ?.fitContent();

      draw();
    };
}

if (
  $('#tv-theme-btn')
) {
  $('#tv-theme-btn').onclick =
    () =>
      $('#theme')?.click();
}

$$('[data-tv-range]').forEach(
    button => {
      button.onclick =
        () => {
          const value =
            button.dataset
              .tvRange;

          if (
            value === 'fit'
          ) {
            tvLiteChart
              ?.timeScale()
              ?.fitContent();

            return;
          }

          const count =
            Number(value);

          if (
            Number.isFinite(
              count
            )
          ) {
            state.count =
              count;

            state.offset =
              0;

            draw();
          }
        };
    }
  );

setChartView(
  'tradingview'
);

runSmrtDiagnostics();


refreshGlobalWatch().catch(
  () => {}
);



const globalWatchTimer =
  setInterval(
    () => {
      if (
        !document.hidden
      ) {
        refreshGlobalWatch()
          .catch(
            () => {}
          );
      }
    },
    60000
  );


const externalNiftyTimer =
  setInterval(
    () => {
      if (
        !document.hidden
      ) {
        refreshExternalNifty()
          .catch(
            () => {}
          );
      }
    },
    30000
  );


if (
  $('.canvas-area')
) {

  new ResizeObserver(
    () => draw()
  ).observe(
    $('.canvas-area')
  );
}


/* ======================================================
   INSTRUMENT SELECTION
====================================================== */


function selectInstrument(
  symbol
) {

  if (
    !instruments.some(
      i =>
        i.id ===
        symbol
    )
  ) {

    throw Error(
      'Unknown instrument'
    );
  }


  state.symbol =
    symbol;


  startPoint =
    null;


  return loadData();
}


if (
  $('#watch-rows')
) {

  $('#watch-rows')
    .addEventListener(
      'click',
      event => {

        const button =
          event.target.closest(
            '[data-symbol]'
          );


        if (button) {

          selectInstrument(
            button.dataset.symbol
          );
        }
      }
    );
}


$$('[data-filter]')
  .forEach(
    button => {

      button.onclick =
        () => {

          state.filter =
            button.dataset.filter;


          $$('[data-filter]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          renderWatch();
        };
    }
  );


/* ======================================================
   TIMEFRAMES
====================================================== */


$$('[data-tf]')
  .forEach(
    button => {

      button.onclick =
        () => {

          const tf =
            button.dataset.tf;


          if (
            ![
              '1m',
              '3m',
              '5m',
              '15m'
            ].includes(tf)
          ) {

            toast(
              'This timeframe is not enabled for the live intraday feed.'
            );

            return;
          }


          if (
            state.replay.active
          ) {

            exitReplay(
              false
            );
          }


          state.tf =
            tf;


          startPoint =
            null;


          $$('[data-tf]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          loadData();
        };
    }
  );


/* ======================================================
   REPLAY CONTROLS
====================================================== */


if (
  $('#replay-toggle')
) {

  $('#replay-toggle').onclick =
    () => {

      if (
        state.replay.active
      ) {

        exitReplay(
          true
        );

      } else {

        startReplay();
      }
    };
}


if (
  $('#replay-play')
) {

  $('#replay-play').onclick =
    () => {

      toggleReplayPlay();
    };
}


if (
  $('#replay-step')
) {

  $('#replay-step').onclick =
    () => {

      stepReplay();
    };
}


if (
  $('#replay-live')
) {

  $('#replay-live').onclick =
    () => {

      exitReplay(
        true
      );
    };
}


if (
  $('#replay-speed')
) {

  $('#replay-speed').onchange =
    event => {

      const value =
        Number(
          event.target.value
        );


      state.replay.speed =
        Number.isFinite(
          value
        )
          ? value
          : 700;


      if (
        state.replay.playing
      ) {

        clearReplayTimer();

        toggleReplayPlay();
      }
    };
}


updateReplayControls();

renderMTF();


/* ======================================================
   INDICATOR CONTROLS
====================================================== */


if (
  $('#indicators')
) {

  $('#indicators').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-indicator]'
        );


      if (!button) {
        return;
      }


      const name =
        button.dataset.indicator;


      if (
        state.overlays.has(
          name
        )
      ) {

        state.overlays.delete(
          name
        );

      } else {

        state.overlays.add(
          name
        );
      }


      button.classList.toggle(
        'on',
        state.overlays.has(
          name
        )
      );


      button.setAttribute(
        'aria-pressed',
        state.overlays.has(
          name
        )
      );


      draw();

      syncTradingViewLiteChart(
        true
      );

      summary();
    };
}


if (
  $('#indicators-toggle')
) {

  $('#indicators-toggle').onclick =
    () => {

      $('#indicators')
        ?.classList.toggle(
          'hidden'
        );
    };
}


if (
  $('#theme')
) {

  $('#theme').onclick =
    () => {

      document.body
        .classList.toggle(
          'light'
        );


      save(
        'stride-theme',

        document.body
          .classList.contains(
            'light'
          )
          ? 'light'
          : 'dark'
      );


      draw();
    };
}


if (
  $('#reset-view')
) {

  $('#reset-view').onclick =
    () => {

      state.count =
        90;


      state.offset =
        0;


      state.hover =
        null;


      draw();
    };
}


/* ======================================================
   DRAWING TOOLS
====================================================== */


$$('[data-tool]')
  .forEach(
    button => {

      button.onclick =
        () => {

          state.tool =
            button.dataset.tool;


          startPoint =
            null;


          $$('[data-tool]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          if (
            $('#chart-tip')
          ) {

            $('#chart-tip').textContent =
              state.tool === 'cursor'
                ? 'Scroll to zoom · drag to pan'
                : state.tool === 'trend'
                  ? 'Select the first point, then the second point'
                  : 'Tap the chart to place ' +
                    state.tool;
          }
        };
    }
  );


function persistDrawings() {

  save(
    'stride-drawings',
    state.drawings
  );
}


if (
  $('#undo')
) {

  $('#undo').onclick =
    () => {

      (
        state.drawings[
          state.symbol +
          state.tf
        ] || []
      ).pop();


      startPoint =
        null;


      persistDrawings();

      draw();
    };
}


const chart =
  $('#chart');


function point(
  event
) {

  if (!geometry) {
    return null;
  }


  const rect =
    chart.getBoundingClientRect();


  const px =
    event.clientX -
    rect.left;


  const py =
    event.clientY -
    rect.top;


  const g =
    geometry;


  if (
    px < 0 ||
    px > g.plot ||
    py < g.top ||
    py > g.bottom
  ) {

    return null;
  }


  const idx =
    Math.max(
      0,
      Math.min(
        g.rows.length - 1,

        Math.floor(
          px /
          g.plot *
          g.rows.length
        )
      )
    );


  return {

    time:
      g.rows[idx].time,

    price:
      g.max -
      (
        py -
        g.top
      ) /
      (
        g.bottom -
        g.top
      ) *
      (
        g.max -
        g.min
      ),

    index:
      idx
  };
}


if (chart) {

  chart.addEventListener(
    'pointerdown',
    event => {

      chart.setPointerCapture(
        event.pointerId
      );


      const p =
        point(event);


      if (!p) {
        return;
      }


      if (
        state.tool === 'cursor'
      ) {

        drag = {
          x:
            event.clientX,

          offset:
            state.offset
        };

        return;
      }


      const key =
        state.symbol +
        state.tf;


      state.drawings[key] ??=
        [];


      if (
        state.tool === 'trend'
      ) {

        if (!startPoint) {

          startPoint =
            p;


          if (
            $('#chart-tip')
          ) {

            $('#chart-tip').textContent =
              'Select the second point';
          }

          return;
        }


        state.drawings[key].push({
          type:
            'trend',

          a:
            startPoint,

          b:
            p
        });


        startPoint =
          null;


        if (
          $('#chart-tip')
        ) {

          $('#chart-tip').textContent =
            'Trend line saved · select two more points';
        }

      } else {

        state.drawings[key].push({
          type:
            state.tool,

          a:
            p
        });
      }


      persistDrawings();

      draw();
    }
  );


  chart.addEventListener(
    'pointermove',
    event => {

      const p =
        point(event);


      state.hover =
        p?.index ??
        null;


      if (
        drag &&
        geometry
      ) {

        state.offset =
          Math.max(
            0,
            Math.min(
              Math.max(
                0,
                state.data.length -
                state.count
              ),

              drag.offset +
              Math.round(
                (
                  event.clientX -
                  drag.x
                ) /
                geometry.plot *
                state.count
              )
            )
          );
      }


      draw();
    }
  );


  chart.addEventListener(
    'pointerup',
    () =>
      drag = null
  );


  chart.addEventListener(
    'pointercancel',
    () =>
      drag = null
  );


  chart.addEventListener(
    'pointerleave',
    () => {

      if (!drag) {

        state.hover =
          null;

        draw();
      }
    }
  );


  chart.addEventListener(
    'wheel',
    event => {

      event.preventDefault();


      state.count =
        Math.max(
          25,
          Math.min(
            state.data.length,

            state.count +
            Math.sign(
              event.deltaY
            ) *
            10
          )
        );


      state.offset =
        Math.min(
          state.offset,

          Math.max(
            0,
            state.data.length -
            state.count
          )
        );


      draw();
    },

    {
      passive: false
    }
  );
}


/* ======================================================
   ZOOM
====================================================== */


if (
  $('.canvas-area')
) {

  const zoom =
    document.createElement(
      'div'
    );


  zoom.className =
    'zoom-controls';


  zoom.innerHTML =
    '<button aria-label="Zoom in">+</button>' +
    '<button aria-label="Zoom out">−</button>';


  $('.canvas-area')
    .append(
      zoom
    );


  zoom.children[0].onclick =
    () => {

      state.count =
        Math.max(
          25,
          state.count - 15
        );


      draw();
    };


  zoom.children[1].onclick =
    () => {

      state.count =
        Math.min(
          state.data.length,
          state.count + 15
        );


      state.offset =
        Math.min(
          state.offset,

          Math.max(
            0,
            state.data.length -
            state.count
          )
        );


      draw();
    };
}


/* ======================================================
   PRICE ALERTS
====================================================== */


function openAlert() {

  if (
    !state.data.length
  ) {
    return;
  }


  if (
    $('#alert-symbol')
  ) {

    $('#alert-symbol').textContent =
      current().name +
      ' · LIVE price ' +
      fmt(
        quote()
      );
  }


  if (
    $('#alert-price')
  ) {

    $('#alert-price').value =
      (
        quote() *
        1.001
      ).toFixed(2);
  }


  $('#alert-dialog')
    ?.showModal();
}


if (
  $('#add-alert')
) {

  $('#add-alert').onclick =
    openAlert;
}


if (
  $('#new-alert')
) {

  $('#new-alert').onclick =
    openAlert;
}


if (
  $('#close-dialog')
) {

  $('#close-dialog').onclick =
    () =>
      $('#alert-dialog')
        ?.close();
}


function renderAlerts() {

  const active =
    state.alerts.filter(
      a =>
        !a.triggered
    ).length;


  if (
    $('#alert-count')
  ) {

    $('#alert-count').textContent =
      active;
  }


  if (
    $('#alert-total')
  ) {

    $('#alert-total').textContent =
      state.alerts.length;
  }


  if (
    $('#alert-list')
  ) {

    $('#alert-list').innerHTML =
      state.alerts.length
        ? state.alerts.map(
            a => `
              <div class="alert-row">

                <span>

                  ${
                    instruments.find(
                      i =>
                        i.id ===
                        a.symbol
                    )?.name ??
                    'Instrument'
                  }

                  ${
                    a.direction ===
                    'above'
                      ? '≥'
                      : '≤'
                  }

                  ₹${fmt(a.price)}

                  <br>

                  <small class="${
                    a.triggered
                      ? 'up'
                      : 'muted'
                  }">

                    ${
                      a.triggered
                        ? 'Triggered · ' +
                          new Date(
                            a.triggered
                          ).toLocaleTimeString(
                            'en-IN'
                          )
                        : 'Active · monitoring LIVE Upstox price'
                    }

                  </small>

                </span>


                <button
                  data-delete-alert="${a.id}"
                  aria-label="Delete alert"
                >
                  ✕
                </button>

              </div>
            `
          ).join('')
        : 'No alerts yet. Set a price to keep an eye on.';
  }


  save(
    'stride-alerts',
    state.alerts
  );
}


function createAlert(
  symbol,
  direction,
  price
) {

  if (
    !instruments.some(
      i =>
        i.id ===
        symbol
    ) ||
    ![
      'above',
      'below'
    ].includes(
      direction
    ) ||
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {

    throw Error(
      'Enter a valid instrument, direction and positive price'
    );
  }


  const alert = {

    id:
      crypto.randomUUID(),

    symbol,

    direction,

    price,

    triggered:
      null
  };


  state.alerts.push(
    alert
  );


  renderAlerts();


  return alert;
}


if (
  $('#alert-form')
) {

  $('#alert-form').onsubmit =
    event => {

      event.preventDefault();


      try {

        createAlert(
          state.symbol,

          $('#alert-direction').value,

          Number(
            $('#alert-price').value
          )
        );


        $('#alert-dialog')
          ?.close();


        toast(
          'LIVE price alert created on this device'
        );


        checkAlerts();

      } catch (
        error
      ) {

        toast(
          error.message
        );
      }
    };
}


if (
  $('#alert-list')
) {

  $('#alert-list').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-delete-alert]'
        );


      if (!button) {
        return;
      }


      state.alerts =
        state.alerts.filter(
          a =>
            a.id !==
            button.dataset.deleteAlert
        );


      renderAlerts();
    };
}


checkAlerts =
  () => {

    let changed =
      false;


    for (
      const alert of
      state.alerts
    ) {

      if (
        alert.triggered
      ) {
        continue;
      }


      const price =
        state.quotes[
          alert.symbol
        ];


      if (
        !Number.isFinite(
          price
        )
      ) {
        continue;
      }


      const triggered =
        alert.direction ===
        'above'
          ? price >=
            alert.price
          : price <=
            alert.price;


      if (triggered) {

        alert.triggered =
          Date.now();


        changed =
          true;


        toast(
          (
            instruments.find(
              i =>
                i.id ===
                alert.symbol
            )?.name ||
            alert.symbol
          ) +
          ' crossed ' +
          fmt(
            alert.price
          )
        );
      }
    }


    if (changed) {

      renderAlerts();
    }
  };


renderAlerts();


/* ======================================================
   INSTALL APP
====================================================== */


window.addEventListener(
  'beforeinstallprompt',
  event => {

    event.preventDefault();

    installPrompt =
      event;
  }
);


if (
  $('#install')
) {

  $('#install').onclick =
    async () => {

      if (
        installPrompt
      ) {

        await installPrompt.prompt();

        installPrompt =
          null;

      } else {

        toast(
          matchMedia(
            '(display-mode: standalone)'
          ).matches
            ? 'Pro Scalper is already running as an app.'
            : 'Open in Chrome on Android: menu → Install app. On iPhone: Share → Add to Home Screen.'
        );
      }
    };
}


/* ======================================================
   SERVICE WORKER
====================================================== */

// Live trading data must always use the newest frontend.
// Remove any older service worker/cache that could hold stale JS.
if (
  'serviceWorker' in navigator
) {
  navigator.serviceWorker
    .getRegistrations()
    .then(
      registrations =>
        registrations.forEach(
          registration =>
            registration.unregister()
        )
    )
    .catch(
      () => {}
    );
}


/* ======================================================
   WATCHLIST LIVE SUBSCRIPTIONS
====================================================== */


const watchSubscriptions =
  instruments.filter(i => i.id !== state.symbol).map(
    i =>
      market.subscribe(
        i.id,
        '1m',

        tick => {

          if (
            !tick ||
            !Number.isFinite(
              Number(
                tick.price
              )
            )
          ) {
            return;
          }


          if (
            i.id ===
            state.symbol
          ) {
            return;
          }


          state.quotes[
            i.id
          ] =
            Number(
              tick.price
            );


          renderWatch();

          checkAlerts();
        },

        () => {}
      )
  );


window.addEventListener(
  'pagehide',
  () => {

    unsubscribe?.();

    clearInterval(
      externalNiftyTimer
    );

    clearInterval(
      globalWatchTimer
    );



    watchSubscriptions
      .forEach(
        stop =>
          stop?.()
      );
  }
);


window.addEventListener(
  'pageshow',
  event => {

    if (
      event.persisted
    ) {

      location.reload();
    }
  }
);


/* ======================================================
   STRIDE SIGNAL STATUS
====================================================== */


function renderSignalStatus() {

  const enabled =
    state.overlays.has(
      'Stride Signals'
    );


  const last =
    state.signals
      ?.filter(Boolean)
      .at(-1);


  const event =
    state.signals
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#stride-status')
  ) {

    $('#stride-status').textContent =
      !enabled
        ? 'Indicator hidden'
        : !last
          ? 'Warming up'
          : last.direction === 1
            ? 'Bullish trend'
            : 'Bearish trend';


    $('#stride-status').className =
      !enabled
        ? 'muted'
        : last?.direction === 1
          ? 'up'
          : 'down';
  }


  if (
    $('#stride-stop')
  ) {

    $('#stride-stop').textContent =
      enabled &&
      last
        ? 'ATR trail ₹' +
          fmt(
            last.stop
          )
        : '—';
  }


  if (
    $('#stride-last')
  ) {

    $('#stride-last').textContent =
      event
        ? 'Last ' +
          event.signal.toLowerCase() +
          ' · ' +
          new Date(
            event.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No reversal in today’s loaded history';
  }


  if (
    $('#stride-settings')
  ) {

    $('#stride-settings')
      .dataset.enabled =
        String(
          enabled
        );
  }


  renderSignalAlerts();
}


if (
  $('#signal-sensitivity')
) {

  $('#signal-sensitivity').value =
    state.signalSensitivity;


  $('#signal-sensitivity').onchange =
    event => {

      state.signalSensitivity =
        event.target.value;


      save(
        'stride-sensitivity',
        state.signalSensitivity
      );


      draw();


      signalTracker.baseline(
        state.signals ||
        []
      );
    };
}


/* ======================================================
   PRICE ACTION
====================================================== */


function drawPriceAction(
  ctx,
  g
) {

  if (
    !state.pa
  ) {
    return;
  }


  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down,
    muted
  } = g;


  const pa =
    state.pa;


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  ctx.font =
    '10px system-ui';


  for (
    const kind of [
      'OB',
      'FVG'
    ]
  ) {

    const enabled =
      state.paOverlays.has(
        kind === 'OB'
          ? 'Order blocks'
          : 'Fair-value gaps'
      );


    if (!enabled) {
      continue;
    }


    const visible =
      pa.zones
        .filter(
          z =>
            z.kind ===
            kind &&
            z.endedAt ==
            null &&
            z.index <
            end
        )
        .slice(-4);


    for (
      const z of visible
    ) {

      const left =
        Math.max(
          0,
          x(
            z.index -
            start
          )
        );


      const width =
        plot -
        left;


      if (
        width <= 0
      ) {
        continue;
      }


      const color =
        z.direction === 1
          ? up
          : down;


      ctx.fillStyle =
        color;


      ctx.globalAlpha =
        kind === 'OB'
          ? 0.10
          : 0.05;


      ctx.fillRect(
        left,
        y(z.high),
        width,
        Math.max(
          1,
          y(z.low) -
          y(z.high)
        )
      );


      ctx.globalAlpha =
        0.7;


      ctx.strokeStyle =
        color;


      ctx.setLineDash(
        kind === 'FVG'
          ? [2, 4]
          : []
      );


      ctx.strokeRect(
        left,
        y(z.high),
        width,
        Math.max(
          1,
          y(z.low) -
          y(z.high)
        )
      );


      ctx.globalAlpha =
        1;


      ctx.setLineDash(
        []
      );


      ctx.fillText(
        kind +
        (
          z.direction === 1
            ? ' +'
            : ' −'
        ),

        Math.max(
          left + 4,
          plot - 47
        ),

        Math.max(
          top + 12,

          Math.min(
            bottom - 3,
            y(z.high) +
            12
          )
        )
      );
    }
  }


  if (
    state.paOverlays.has(
      'Structure'
    )
  ) {

    for (
      const b of
      pa.breaks.filter(
        b =>
          b.index >=
          start &&
          b.index <
          end
      )
    ) {

      ctx.strokeStyle =
        ctx.fillStyle =
          b.direction === 1
            ? up
            : down;


      ctx.setLineDash(
        [3, 3]
      );


      ctx.beginPath();


      ctx.moveTo(
        Math.max(
          0,
          x(
            b.from -
            start
          )
        ),

        y(
          b.price
        )
      );


      ctx.lineTo(
        x(
          b.index -
          start
        ),

        y(
          b.price
        )
      );


      ctx.stroke();


      ctx.setLineDash(
        []
      );


      ctx.fillText(
        b.type,

        Math.max(
          0,
          Math.min(
            plot - 43,
            x(
              b.index -
              start
            ) -
            20
          )
        ),

        y(
          b.price
        ) -
        5
      );
    }
  }


  if (
    state.paOverlays.has(
      'Swings'
    )
  ) {

    for (
      const p of
      pa.pivots.filter(
        p =>
          p.confirmedAt >=
          start &&
          p.confirmedAt <
          end
      )
    ) {

      ctx.fillStyle =
        muted;


      ctx.fillText(
        p.type,

        Math.max(
          0,
          Math.min(
            plot - 25,

            x(
              p.confirmedAt -
              start
            ) -
            8
          )
        ),

        y(
          p.price
        ) +
        (
          p.type.endsWith(
            'H'
          )
            ? -10
            : 14
        )
      );
    }
  }


  ctx.restore();


  const active =
    pa.zones.filter(
      z =>
        z.endedAt ==
        null
    );


  const last =
    pa.breaks.at(-1);


  if (
    $('#pa-summary')
  ) {

    $('#pa-summary').textContent =
      (
        pa.trend === 1
          ? 'Bullish structure'
          : pa.trend === -1
            ? 'Bearish structure'
            : 'Structure forming'
      ) +
      ' · ' +
      active.filter(
        z =>
          z.kind ===
          'OB'
      ).length +
      ' active OB · ' +
      active.filter(
        z =>
          z.kind ===
          'FVG'
      ).length +
      ' open FVG';
  }


  if (
    $('#pa-last')
  ) {

    $('#pa-last').textContent =
      last
        ? 'Last confirmed ' +
          last.type +
          ' · ' +
          new Date(
            state.data[
              last.index
            ].time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No confirmed structure break';
  }
}


if (
  $('#pa-toggles')
) {

  $('#pa-toggles').innerHTML =
    paNames.map(
      name => `
        <button
          data-pa="${name}"
          aria-pressed="${
            state.paOverlays.has(
              name
            )
          }"
          class="${
            state.paOverlays.has(
              name
            )
              ? 'active'
              : ''
          }"
        >
          ${name}
        </button>
      `
    ).join('');


  $('#pa-toggles').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-pa]'
        );


      if (!button) {
        return;
      }


      const name =
        button.dataset.pa;


      if (
        state.paOverlays.has(
          name
        )
      ) {

        state.paOverlays.delete(
          name
        );

      } else {

        state.paOverlays.add(
          name
        );
      }


      button.classList.toggle(
        'active',
        state.paOverlays.has(
          name
        )
      );


      button.setAttribute(
        'aria-pressed',
        state.paOverlays.has(
          name
        )
      );


      save(
        'stride-pa',
        [
          ...state.paOverlays
        ]
      );


      draw();
    };
}


async function ensureNotificationPermission() {

  if (!('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}


async function showSignalNotification(title, body) {

  const allowed =
    await ensureNotificationPermission();

  if (!allowed) {
    return;
  }

  const options = {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'stride-signal-' + Date.now(),
    renotify: false
  };

  try {
    const registration =
      await navigator.serviceWorker?.ready;

    if (registration?.showNotification) {
      await registration.showNotification(
        title,
        options
      );
      return;
    }
  } catch {}

  try {
    new Notification(
      title,
      options
    );
  } catch {}
}


/* ======================================================
   SIGNAL ALERTS
====================================================== */


function renderSignalAlerts() {

  if (
    $('#signal-alert-switch')
  ) {

    $('#signal-alert-switch').checked =
      signalAlertsEnabled;
  }


  if (
    $('#signal-alert-status')
  ) {

    $('#signal-alert-status').textContent =
      signalAlertsEnabled
        ? 'On · ' +
          current().name +
          ' · ' +
          state.tf +
          ' · ' +
          state.signalSensitivity
        : 'Off';
  }


  const list =
    $('#signal-alert-history');


  if (!list) {
    return;
  }


  list.replaceChildren();


  if (
    !Array.isArray(
      signalHistory
    ) ||
    !signalHistory.length
  ) {

    list.textContent =
      'No new signal alerts yet.';

    return;
  }


  for (
    const alert of
    signalHistory.slice(
      0,
      20
    )
  ) {

    const row =
      document.createElement(
        'div'
      );


    row.className =
      'alert-row';


    const text =
      document.createElement(
        'span'
      );


    text.textContent =
      (
        alert.source ||
        'Stride Signals'
      ) +
      ' · ' +
      alert.side.toUpperCase() +
      ' · ' +
      alert.name +
      ' · ' +
      alert.tf +
      ' · ₹' +
      fmt(
        alert.price
      );


    text.className =
      alert.side === 'Buy'
        ? 'up'
        : 'down';


    const time =
      document.createElement(
        'small'
      );


    time.textContent =
      new Date(
        alert.time *
        1000
      ).toLocaleString(
        'en-IN',
        {
          timeZone:
            'Asia/Kolkata',

          day:
            '2-digit',

          month:
            'short',

          hour:
            '2-digit',

          minute:
            '2-digit',

          hour12:
            false
        }
      ) +
      ' IST';


    row.append(
      text,
      time
    );


    list.append(
      row
    );
  }
}


function processSignalAlerts() {

  const fresh =
    signalTracker.collect(
      state.signals || [],
      signalAlertsEnabled
    );


  for (
    const event of fresh
  ) {

    const candle =
      state.data.find(
        c =>
          c.time ===
          event.time
      );


    if (!candle) {
      continue;
    }


    const alert = {

      source:
        'Stride Signals',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        candle.close
    };


    signalHistory.unshift(
      alert
    );


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      alert.side.toUpperCase() +
      ' signal · ' +
      alert.name +
      ' · ' +
      alert.tf +
      ' · ₹' +
      fmt(alert.price)
    );

    showSignalNotification(
      'Stride ' +
      alert.side.toUpperCase() +
      ' · ' +
      alert.name,
      alert.tf +
      ' · ₹' +
      fmt(alert.price) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#signal-alert-switch')
) {

  $('#signal-alert-switch').onchange =
    event => {

      signalAlertsEnabled =
        event.target.checked;

      if (signalAlertsEnabled) {
        ensureNotificationPermission();
      }

      save(
        'stride-signal-alerts-enabled',
        signalAlertsEnabled
      );


      signalTracker.baseline(
        state.signals ||
        []
      );


      renderSignalAlerts();
    };
}


$$('[data-test-signal]')
  .forEach(
    button => {

      button.onclick =
        async () => {

          const side =
            button.dataset.testSignal;

          const message =
            'TEST ' +
            side +
            ' signal · ' +
            current().name +
            ' · ' +
            state.tf +
            ' · live alert test';

          toast(
            message
          );

          await showSignalNotification(
            'Stride TEST ' +
            side +
            ' · ' +
            current().name,
            state.tf +
            ' · Browser notification test'
          );
        };
    }
  );


renderSignalAlerts();


/* ======================================================
   PRO SCALPER
====================================================== */


function renderGainzSSL(
  ctx,
  g
) {

  const combo =
    state.gainzSSL;

  if (!combo) {
    return;
  }

  const latest =
    combo.latest;

  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;


  const drawSeries =
    (
      arr,
      color,
      width = 1.2
    ) => {

      if (
        !Array.isArray(
          arr
        )
      ) {
        return;
      }

      ctx.strokeStyle =
        color;

      ctx.lineWidth =
        width;

      ctx.beginPath();

      let began =
        false;

      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                Number(value)
              )
            ) {

              began =
                false;

              return;
            }

            if (began) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              began =
                true;
            }
          }
        );

      ctx.stroke();
    };


  ctx.save();

  ctx.beginPath();
  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );
  ctx.clip();


  drawSeries(
    combo.ssl1,
    up,
    1.4
  );

  drawSeries(
    combo.ssl2,
    down,
    1.4
  );


  if (
    latest &&
    latest.signal !==
      'NO TRADE'
  ) {

    const plan =
      latest.plan;

    const color =
      latest.side === 1
        ? up
        : down;


    const labelX =
      Math.max(
        8,
        plot - 160
      );


    const labelY =
      plan &&
      Number.isFinite(
        Number(
          plan.entry
        )
      )
        ? Math.max(
            top + 14,
            Math.min(
              bottom - 24,
              y(
                plan.entry
              ) -
              11
            )
          )
        : top + 12;


    ctx.fillStyle =
      color;

    ctx.fillRect(
      labelX,
      labelY,
      74,
      22
    );


    ctx.fillStyle =
      '#ffffff';

    ctx.font =
      'bold 11px system-ui';

    ctx.fillText(
      latest.signal,
      labelX + 8,
      labelY + 15
    );


    if (plan) {

      const levels = [
        [
          'SL',
          plan.stop,
          down
        ],
        [
          'ENTRY',
          plan.entry,
          '#7f8794'
        ],
        [
          'TP1',
          plan.target1,
          up
        ],
        [
          'TP2',
          plan.target2,
          up
        ],
        [
          'TP3',
          plan.target3,
          up
        ]
      ];


      for (
        const [
          label,
          value,
          levelColor
        ] of levels
      ) {

        if (
          !Number.isFinite(
            Number(value)
          )
        ) {
          continue;
        }

        const py =
          y(value);

        if (
          py < top ||
          py > bottom
        ) {
          continue;
        }


        ctx.strokeStyle =
          levelColor;

        ctx.globalAlpha =
          0.72;

        ctx.setLineDash(
          [6, 4]
        );

        ctx.beginPath();
        ctx.moveTo(
          Math.max(
            0,
            plot - 240
          ),
          py
        );
        ctx.lineTo(
          plot - 82,
          py
        );
        ctx.stroke();

        ctx.setLineDash(
          []
        );

        ctx.globalAlpha =
          1;

        ctx.fillStyle =
          levelColor;

        ctx.fillRect(
          plot - 80,
          py - 9,
          78,
          18
        );

        ctx.fillStyle =
          '#ffffff';

        ctx.font =
          'bold 10px system-ui';

        ctx.fillText(
          label +
          ' ' +
          fmt(value),
          plot - 76,
          py + 3
        );
      }
    }
  }


  ctx.restore();
}


function renderGainzSSLPanel() {

  const combo =
    state.gainzSSL;

  const latest =
    combo?.latest;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !== undefined
      ) {
        el.className =
          className;
      }
    };


  if (!latest) {

    set(
      '#gainz-ssl-signal',
      'NO TRADE',
      'muted'
    );

    set(
      '#gainz-baseline-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-ssl-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-qqe-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-qqe-value',
      '—'
    );

    return;
  }


  set(
    '#gainz-ssl-signal',
    latest.signal,
    latest.signal.startsWith(
      'LONG'
    )
      ? 'up'
      : latest.signal.startsWith(
          'SHORT'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-baseline-state',
    latest.baselineSide === 1
      ? 'BULLISH'
      : latest.baselineSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.baselineSide === 1
      ? 'up'
      : latest.baselineSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-ssl-state',
    latest.sslSide === 1
      ? 'BULLISH'
      : latest.sslSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.sslSide === 1
      ? 'up'
      : latest.sslSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-qqe-state',
    latest.qqeSide === 1
      ? 'BULLISH'
      : latest.qqeSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.qqeSide === 1
      ? 'up'
      : latest.qqeSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-qqe-value',
    Number.isFinite(
      Number(
        latest.qqeValue
      )
    )
      ? Number(
          latest.qqeValue
        ).toFixed(
          1
        )
      : '—'
  );


  set(
    '#gainz-risk',
    latest.riskLevel +
    (
      Number.isFinite(
        Number(
          latest.riskPercentile
        )
      )
        ? ' · ' +
          Number(
            latest.riskPercentile
          ).toFixed(
            0
          ) +
          '%'
        : ''
    )
  );


  set(
    '#gainz-entry-distance',
    latest.entryDistance +
    ' · ' +
    latest.score +
    ' pts'
  );


  set(
    '#gainz-reasons',
    latest.reasons?.length
      ? latest.reasons.join(
          ' · '
        )
      : 'Waiting for SSL and QQE alignment'
  );
}

function refreshLiveTradeFinalizer() {
  // Quotes may refresh the display, but cannot close the current candle.
  refreshPrimeConfirmation();
}


function recomputeAllIndicatorsConsensus() {
  refreshPrimeConfirmation();

  state.allIndicatorsConsensus =
    analyseAllIndicators({
      finalizer:
        state.liveTradeFinalizer ??
        state.tradeFinalizer,
      edge:
        state.niftyEdge,
      marketMap:
        state.marketMap,
      mtf:
        state.mtf,
      gainz:
        state.gainzSSL,
      aiNifty:
        state.aiNifty,
      globalWatch:
        state.globalWatch
    });

  state.allIndicatorsConsensus = primeGate(state.allIndicatorsConsensus, state.primeMarket, 'signal');
  renderAllIndicatorsConsensus();
  renderTradeFinalizer();
  renderProSuiteSummary();
}


function renderAllIndicatorsConsensus() {

  const result =
    state.allIndicatorsConsensus;

  const set =
    (
      selector,
      value,
      className
    ) => {
      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !==
        undefined
      ) {
        el.className =
          className;
      }
    };


  if (!result) {
    set(
      '#all-indicators-signal',
      'LOADING…',
      'muted'
    );

    return;
  }


  set(
    '#all-indicators-signal',
    result.signal,
    result.signal.includes(
      'BUY'
    )
      ? 'up'
      : result.signal.includes(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#all-indicators-confidence',
    result.confidence +
    ' / 100'
  );


  set(
    '#all-indicators-bull',
    'Bull weight ' +
    result.bullWeight
  );


  set(
    '#all-indicators-bear',
    'Bear weight ' +
    result.bearWeight
  );


  set(
    '#all-indicators-alignment',
    result.alignedCount +
    ' aligned · ' +
    result.opposingCount +
    ' opposing · ' +
    result.totalVotes +
    ' active groups'
  );


  const list =
    $('#all-indicators-votes');

  if (list) {
    list.innerHTML =
      result.votes
        .map(
          vote => {
            const cls =
              vote.side === 1
                ? 'up'
                : 'down';

            return (
              '<div class="all-indicator-vote">' +
                '<span>' +
                  vote.name +
                '</span>' +
                '<strong class="' +
                  cls +
                '">' +
                  (
                    vote.side === 1
                      ? 'BULLISH'
                      : 'BEARISH'
                  ) +
                '</strong>' +
              '</div>'
            );
          }
        )
        .join('');
  }


  set(
    '#all-indicators-reason',
    result.reason
  );


  const chatSignal =
    $('#all-chat-live-signal');

  if (
    chatSignal
  ) {
    chatSignal.textContent =
      result.signal;

    chatSignal.className =
      result.signal.includes(
        'BUY'
      )
        ? 'up'
        : result.signal.includes(
            'SELL'
          )
          ? 'down'
          : 'muted';
  }
}


function renderGlobalWatch() {

  const watch =
    state.globalWatch;

  const set =
    (
      selector,
      value,
      className
    ) => {
      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !==
        undefined
      ) {
        el.className =
          className;
      }
    };


  if (!watch) {
    set(
      '#global-watch-bias',
      'LOADING…',
      'muted'
    );

    set(
      '#global-watch-confidence',
      '0 / 100'
    );

    return;
  }


  const bullish =
    watch.bias.includes(
      'BULLISH'
    );

  const bearish =
    watch.bias.includes(
      'BEARISH'
    );


  set(
    '#global-watch-bias',
    watch.bias,
    bullish
      ? 'up'
      : bearish
        ? 'down'
        : 'muted'
  );


  set(
    '#global-watch-confidence',
    watch.confidence +
    ' / 100'
  );


  set(
    '#global-watch-session',
    isNseCashMarketOpen()
      ? 'NSE OPEN · GLOBAL CONFIRMATION'
      : 'NSE CLOSED · NEXT SESSION BIAS'
  );


  set(
    '#global-watch-sources',
    watch.sourceCount +
    ' global cues'
  );


  const rows =
    $('#global-watch-rows');

  if (rows) {
    rows.innerHTML =
      watch.rows
        .map(
          row => {
            const change =
              Number(
                row.changePercent
              );

            const changeText =
              Number.isFinite(
                change
              )
                ? (
                    change >= 0
                      ? '+'
                      : ''
                  ) +
                  change.toFixed(
                    2
                  ) +
                  '%'
                : '—';

            const cls =
              row.side === 1
                ? 'up'
                : row.side === -1
                  ? 'down'
                  : 'muted';

            return (
              '<div class="global-watch-row">' +
                '<span>' +
                  row.name +
                '</span>' +
                '<strong class="' +
                  cls +
                '">' +
                  changeText +
                '</strong>' +
              '</div>'
            );
          }
        )
        .join(
          ''
        );
  }


  set(
    '#global-watch-reasons',
    watch.reasons?.length
      ? watch.reasons.join(
          ' · '
        )
      : 'Global cues are mixed. No directional bias.'
  );
}


async function refreshGlobalWatch() {

  try {
    const response =
      await fetch(
        API_BASE +
        '/api/global-watch',
        {
          cache:
            'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'Global watch request failed'
      );
    }

    const payload =
      await response.json();

    state.globalWatch =
      analyseGlobalWatch(
        payload
      );

    state.globalWatchUpdated =
      Date.now();

    renderGlobalWatch();

    recomputeAllIndicatorsConsensus();

  } catch (error) {
    console.warn(
      '24/7 Global Watch unavailable:',
      error
    );

    state.globalWatch =
      null;

    renderGlobalWatch();

    recomputeAllIndicatorsConsensus();
  }
}


function renderAiNifty() {

  const ai =
    state.aiNifty;

  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !==
        undefined
      ) {
        el.className =
          className;
      }
    };


  if (!ai) {
    set(
      '#ai-nifty-signal',
      'WAIT',
      'muted'
    );

    set(
      '#ai-nifty-confidence',
      '0 / 100'
    );

    set(
      '#ai-nifty-sources',
      '0 sources'
    );

    return;
  }


  set(
    '#ai-nifty-signal',
    ai.signal,
    ai.signal === 'BUY'
      ? 'up'
      : ai.signal === 'SELL'
        ? 'down'
        : 'muted'
  );


  set(
    '#ai-nifty-confidence',
    ai.confidence +
    ' / 100'
  );


  set(
    '#ai-nifty-sources',
    ai.sourceCount +
    ' external source' +
    (
      ai.sourceCount === 1
        ? ''
        : 's'
    )
  );


  set(
    '#ai-nifty-alignment',
    ai.externalBull +
    ' bullish · ' +
    ai.externalBear +
    ' bearish' +
    (
      ai.externalNeutral
        ? ' · ' +
          ai.externalNeutral +
          ' neutral'
        : ''
    )
  );


  set(
    '#ai-nifty-price-agreement',
    Number.isFinite(
      Number(
        ai.priceAgreement
      )
    )
      ? Number(
          ai.priceAgreement
        ).toFixed(
          3
        ) +
        '% price gap'
      : 'Price cross-check —'
  );


  set(
    '#ai-nifty-entry',
    ai.plan
      ? '₹' +
        fmt(
          ai.plan.entry
        )
      : '—'
  );


  set(
    '#ai-nifty-stop',
    ai.plan
      ? '₹' +
        fmt(
          ai.plan.stop
        )
      : '—'
  );


  set(
    '#ai-nifty-tp1',
    ai.plan
      ? '₹' +
        fmt(
          ai.plan.target1
        )
      : '—'
  );


  set(
    '#ai-nifty-tp2',
    ai.plan
      ? '₹' +
        fmt(
          ai.plan.target2
        )
      : '—'
  );


  set(
    '#ai-nifty-tp3',
    ai.plan
      ? '₹' +
        fmt(
          ai.plan.target3
        )
      : '—'
  );


  set(
    '#ai-nifty-reasons',
    ai.reasons?.length
      ? ai.reasons.join(
          ' · '
        )
      : 'Waiting for external market confirmation'
  );
}


function recomputeAiNifty() {

  state.aiNifty =
    analyseSmrtAiNifty({
      upstoxPrice:
        quote(),
      finalizer:
        state.liveTradeFinalizer ??
        state.tradeFinalizer,
      mtf:
        state.mtf,
      external:
        state.externalNifty
    });

  renderAiNifty();

  recomputeAllIndicatorsConsensus();
}


async function refreshExternalNifty() {

  try {
    const response =
      await fetch(
        API_BASE +
        '/api/external-nifty',
        {
          cache:
            'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'External market source request failed'
      );
    }

    const data =
      await response.json();

    state.externalNifty =
      data;

    state.externalNiftyUpdated =
      Date.now();

    recomputeAiNifty();

  } catch (error) {
    console.warn(
      'External NIFTY sources unavailable:',
      error
    );

    state.externalNifty =
      {
        live: false,
        sources: []
      };

    recomputeAiNifty();
  }
}


function allIndicatorsChatSnapshot() {

  const consensus =
    state.allIndicatorsConsensus;

  const finalizer =
    state.liveTradeFinalizer ??
    state.tradeFinalizer;

  const edge =
    state.niftyEdge?.latest;

  const map =
    state.marketMap;

  const gainz =
    state.gainzSSL?.latest;

  const ai =
    state.aiNifty;

  const global =
    state.globalWatch;

  const scanner =
    state.candleSetup;

  return {
    ready:
      Boolean(
        state.data?.length
      ),

    price:
      quote(),

    timeframe:
      state.tf,

    consensus,

    finalizer,

    edge,

    marketMap:
      map,

    mtf:
      state.mtf,

    gainz,

    ai,

    global,

    candleSetup:
      scanner
  };
}


function allIndicatorsChatAnswer(
  question = ''
) {

  const q =
    String(question)
      .trim()
      .toLowerCase();

  const snap =
    allIndicatorsChatSnapshot();

  if (!snap.ready) {
    return (
      'Market data is still loading. Wait for the Upstox feed and ask again.'
    );
  }

  const c =
    snap.consensus;

  const signal =
    c?.signal ||
    'NO TRADE';

  const confidence =
    Number.isFinite(
      Number(
        c?.confidence
      )
    )
      ? c.confidence +
        '/100'
      : '—';

  const finalizer =
    snap.finalizer;

  const plan =
    finalizer?.plan;

  const support =
    snap.marketMap
      ?.nearestSupport
      ?.price;

  const resistance =
    snap.marketMap
      ?.nearestResistance
      ?.price;

  const voteText =
    Array.isArray(
      c?.votes
    ) &&
    c.votes.length
      ? c.votes
          .map(
            vote =>
              vote.name +
              ': ' +
              (
                vote.side === 1
                  ? 'bullish'
                  : 'bearish'
              )
          )
          .join(
            ' · '
          )
      : 'Indicator votes are still forming.';

  const mtfText =
    [
      ['5m', snap.mtf?.['5m']?.state],
      ['15m', snap.mtf?.['15m']?.state],
      ['1h', snap.mtf?.['1h']?.state]
    ]
      .map(
        ([tf, value]) =>
          tf +
          ': ' +
          (
            value ||
            '—'
          )
      )
      .join(
        ' · '
      );

  const money =
    value =>
      Number.isFinite(
        Number(value)
      )
        ? '₹' +
          Number(value)
            .toLocaleString(
              'en-IN',
              {
                minimumFractionDigits:
                  2,
                maximumFractionDigits:
                  2
              }
            )
        : '—';

  if (
    /all indicators|indicator status|all status|votes|consensus/.test(
      q
    )
  ) {
    return (
      'All-indicator consensus: ' +
      signal +
      ' · Confidence ' +
      confidence +
      '. ' +
      voteText
    );
  }

  if (
    /signal|buy|sell|trade now|what now/.test(
      q
    )
  ) {
    return (
      'Current consensus signal: ' +
      signal +
      ' · Confidence ' +
      confidence +
      '. Bull weight ' +
      (
        c?.bullWeight ??
        '—'
      ) +
      ' vs bear weight ' +
      (
        c?.bearWeight ??
        '—'
      ) +
      '. ' +
      (
        signal ===
        'NO TRADE'
          ? 'The indicators are not aligned strongly enough for a confirmed setup.'
          : 'This is a decision-support signal; confirm the risk levels before acting.'
      )
    );
  }

  if (
    /why|reason|no trade/.test(
      q
    )
  ) {
    return (
      signal +
      ' · ' +
      (
        c?.reason ||
        'No consensus reason available.'
      ) +
      ' Finalizer: ' +
      (
        finalizer?.state ||
        '—'
      ) +
      '. NIFTY EDGE: ' +
      (
        snap.edge?.signal ||
        '—'
      ) +
      '. Market Map: ' +
      (
        snap.marketMap?.action ||
        snap.marketMap?.trend ||
        '—'
      ) +
      '. SSL+QQE: ' +
      (
        snap.gainz?.signal ||
        '—'
      ) +
      '.'
    );
  }

  if (
    /trend|mtf|5m|15m|1h/.test(
      q
    )
  ) {
    return (
      'Multi-timeframe confirmation · ' +
      mtfText +
      '. Market Map: ' +
      (
        snap.marketMap?.trend ||
        '—'
      ) +
      '. Global Watch: ' +
      (
        snap.global?.bias ||
        '—'
      ) +
      '.'
    );
  }

  if (
    /entry|stop|target|tp|plan/.test(
      q
    )
  ) {
    if (!plan) {
      return (
        'No active trade plan. Current final consensus is ' +
        signal +
        ' and Finalizer is ' +
        (
          finalizer?.state ||
          'NO TRADE'
        ) +
        '.'
      );
    }

    return (
      'Trade plan · Entry ' +
      money(
        plan.entry
      ) +
      ' · Stop ' +
      money(
        plan.stop
      ) +
      ' · TP1 ' +
      money(
        plan.target1
      ) +
      ' · TP2 ' +
      money(
        plan.target2
      ) +
      ' · TP3 ' +
      money(
        plan.target3
      ) +
      '.'
    );
  }

  if (
    /support|resistance|level/.test(
      q
    )
  ) {
    return (
      'Market Map levels · Support ' +
      money(
        support
      ) +
      ' · Resistance ' +
      money(
        resistance
      ) +
      ' · Structure ' +
      (
        snap.marketMap?.trend ||
        '—'
      ) +
      '.'
    );
  }

  if (
    /ai|external|global/.test(
      q
    )
  ) {
    return (
      'AI NIFTY: ' +
      (
        snap.ai?.signal ||
        '—'
      ) +
      ' · Global Watch: ' +
      (
        snap.global?.bias ||
        '—'
      ) +
      ' · External sources are used as confirmation, not as a standalone trade trigger.'
    );
  }

  return (
    'NIFTY 50 · ' +
    snap.timeframe +
    ' · Price ' +
    money(
      snap.price
    ) +
    '. Consensus: ' +
    signal +
    ' (' +
    confidence +
    '). Ask: Signal now, All indicators, Why no trade, Trend, Trade plan, or Support/Resistance.'
  );
}


function appendAllIndicatorsChat(
  role,
  text
) {

  const box =
    $('#all-indicators-chat-messages');

  if (!box) {
    return;
  }

  const item =
    document.createElement(
      'div'
    );

  item.className =
    'all-chat-message ' +
    role;

  item.textContent =
    text;

  box.appendChild(
    item
  );

  box.scrollTop =
    box.scrollHeight;
}


function askAllIndicatorsChat(
  question
) {

  const value =
    String(question || '')
      .trim()
      .slice(
        0,
        240
      );

  if (!value) {
    return;
  }

  appendAllIndicatorsChat(
    'user',
    value
  );

  appendAllIndicatorsChat(
    'assistant',
    allIndicatorsChatAnswer(
      value
    )
  );
}


function setupAllIndicatorsChat() {

  const form =
    $('#all-indicators-chat-form');

  const input =
    $('#all-indicators-chat-input');

  if (
    form &&
    input
  ) {
    form.onsubmit =
      event => {
        event.preventDefault();

        const value =
          input.value;

        input.value =
          '';

        askAllIndicatorsChat(
          value
        );

        input.focus();
      };
  }


  $$('[data-all-chat]').forEach(
      button => {
        button.onclick =
          () =>
            askAllIndicatorsChat(
              button.dataset.allChat
            );
      }
    );


  const box =
    $('#all-indicators-chat-messages');

  if (
    box &&
    !box.children.length
  ) {
    appendAllIndicatorsChat(
      'assistant',
      'All indicators are connected. Ask for the current signal, indicator votes, trend, levels, or trade plan.'
    );
  }
}


function renderTradeFinalizer() {

  const f =
    state.liveTradeFinalizer ??
    state.tradeFinalizer;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !== undefined
      ) {
        el.className =
          className;
      }
    };


  if (!f) {

    set(
      '#finalizer-state',
      'NO TRADE',
      'muted'
    );

    set(
      '#finalizer-score',
      '0 / 100'
    );

    return;
  }


  set(
    '#finalizer-state',
    f.state,
    f.state.includes(
      'BUY'
    )
      ? 'up'
      : f.state.includes(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#finalizer-score',
    f.score +
    ' / 100'
  );


  set(
    '#finalizer-bull',
    'Bull ' +
    f.bullScore
  );


  set(
    '#finalizer-bear',
    'Bear ' +
    f.bearScore
  );


  set(
    '#finalizer-invalidation',
    f.invalidation
  );


  const liveFinalizerPlan = f.primeConfirmed ? f.plan : null;

  set(
    '#finalizer-entry',
    liveFinalizerPlan
      ? '₹' +
        fmt(
          liveFinalizerPlan.entry
        )
      : '—'
  );


  set(
    '#finalizer-stop',
    liveFinalizerPlan
      ? '₹' +
        fmt(
          liveFinalizerPlan.stop
        )
      : '—'
  );


  set(
    '#finalizer-tp1',
    liveFinalizerPlan
      ? '₹' +
        fmt(
          liveFinalizerPlan.target1
        )
      : '—'
  );


  set(
    '#finalizer-tp2',
    liveFinalizerPlan
      ? '₹' +
        fmt(
          liveFinalizerPlan.target2
        )
      : '—'
  );


  set(
    '#finalizer-tp3',
    liveFinalizerPlan
      ? '₹' +
        fmt(
          liveFinalizerPlan.target3
        )
      : '—'
  );


  set(
    '#finalizer-reasons',
    f.reasons?.length
      ? f.reasons.join(
          ' · '
        )
      : 'Waiting for confirmed closed-candle confluence'
  );
}


function renderCandleScanner() {

  const scanner =
    state.candleScanner;

  const setup =
    state.candleSetup;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className
      ) {
        el.className =
          className;
      }
    };


  const latest =
    scanner?.latest;


  const strongest =
    latest
      ?.patterns
      ?.[0];


  set(
    '#candle-pattern',
    strongest?.name ??
    'NONE'
  );


  set(
    '#candle-pattern-side',
    strongest?.side === 1
      ? 'BULLISH'
      : strongest?.side === -1
        ? 'BEARISH'
        : strongest
          ? 'NEUTRAL'
          : '—',
    strongest?.side === 1
      ? 'up'
      : strongest?.side === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#candle-pattern-strength',
    strongest
      ? strongest.strength +
        ' / 4'
      : '0 / 4'
  );


  set(
    '#candle-trade-state',
    setup?.action ??
    'NO TRADE',
    setup?.action?.startsWith(
      'BUY'
    )
      ? 'up'
      : setup?.action?.startsWith(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#candle-confluence-score',
    Number.isFinite(
      Number(
        setup?.score
      )
    )
      ? setup.score +
        ' pts'
      : '0 pts'
  );


  set(
    '#candle-pattern-list',
    latest?.patterns?.length
      ? latest.patterns
          .slice(
            0,
            4
          )
          .map(
            p =>
              p.name
          )
          .join(
            ' · '
          )
      : 'No confirmed closed-candle pattern'
  );
}


function renderMarketMap(
  ctx,
  g
) {

  const map =
    state.marketMap;

  if (!map) {
    return;
  }

  const {
    plot,
    top,
    bottom,
    y,
    up,
    down
  } = g;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, plot, bottom - top);
  ctx.clip();

  const drawLevel = (
    value,
    label,
    color
  ) => {

    if (
      !Number.isFinite(
        Number(value)
      )
    ) {
      return;
    }

    const py =
      y(value);

    if (
      py < top ||
      py > bottom
    ) {
      return;
    }

    ctx.strokeStyle =
      color;

    ctx.globalAlpha =
      0.62;

    ctx.setLineDash(
      [7, 5]
    );

    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(plot, py);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.fillStyle =
      color;

    ctx.font =
      'bold 10px system-ui';

    ctx.fillText(
      label +
      ' ' +
      fmt(value),
      8,
      Math.max(
        top + 11,
        py - 4
      )
    );
  };


  drawLevel(
    map.nearestResistance
      ?.price,
    'R',
    down
  );


  drawLevel(
    map.nearestSupport
      ?.price,
    'S',
    up
  );


  ctx.restore();
}


function updateMarketMapPanel() {

  const map =
    state.marketMap;

  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className
      ) {
        el.className =
          className;
      }
    };


  if (!map) {

    set(
      '#market-map-support',
      '—'
    );

    set(
      '#market-map-resistance',
      '—'
    );

    set(
      '#market-map-trend',
      'WARMING UP',
      'muted'
    );

    set(
      '#market-map-reversal',
      'NONE',
      'muted'
    );

    set(
      '#market-map-breakout',
      'NONE',
      'muted'
    );

    set(
      '#market-map-action',
      'NO TRADE',
      'muted'
    );

    set(
      '#market-map-score',
      '0 / 10'
    );

    return;
  }


  set(
    '#market-map-support',
    map.nearestSupport
      ? '₹' +
        fmt(
          map.nearestSupport
            .price
        )
      : '—'
  );


  set(
    '#market-map-resistance',
    map.nearestResistance
      ? '₹' +
        fmt(
          map.nearestResistance
            .price
        )
      : '—'
  );


  const bullish =
    map.trend.includes(
      'BULLISH'
    );

  const bearish =
    map.trend.includes(
      'BEARISH'
    );


  set(
    '#market-map-trend',
    map.trend,
    bullish
      ? 'up'
      : bearish
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-reversal',
    map.reversal,
    map.reversal.startsWith(
      'BULLISH'
    )
      ? 'up'
      : map.reversal.startsWith(
          'BEARISH'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-breakout',
    map.breakout,
    map.breakout ===
      'BREAKOUT UP'
      ? 'up'
      : map.breakout ===
          'BREAKDOWN'
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-action',
    map.action,
    map.action.startsWith(
      'BUY'
    )
      ? 'up'
      : map.action.startsWith(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-score',
    map.confluence +
    ' / 10'
  );
}


function renderChartConsensus(
  ctx,
  g
) {

  const analysis =
    state.chartConsensus;

  if (!analysis) {
    return;
  }

  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;

  const rows =
    analysis.rows
      .slice(
        start,
        end
      );

  ctx.save();

  ctx.beginPath();
  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );
  ctx.clip();

  ctx.font =
    'bold 10px system-ui';

  rows.forEach(
    (
      row,
      i
    ) => {

      if (
        !row?.signal
      ) {
        return;
      }

      const candle =
        state.data[
          start + i
        ];

      if (!candle) {
        return;
      }

      const buy =
        row.side === 1;

      const strong =
        row.signal.includes(
          'STRONG'
        );

      const label =
        buy
          ? (
              strong
                ? 'BUY+'
                : 'BUY'
            )
          : (
              strong
                ? 'SELL+'
                : 'SELL'
            );

      const width =
        strong
          ? 52
          : 44;

      const height =
        20;

      const px =
        Math.max(
          0,
          Math.min(
            plot - width,
            x(i) -
            width / 2
          )
        );

      const anchor =
        buy
          ? candle.low
          : candle.high;

      const py =
        Math.max(
          top + 2,
          Math.min(
            bottom -
              height -
              2,
            y(anchor) +
              (
                buy
                  ? 24
                  : -34
              )
          )
        );

      ctx.globalAlpha =
        strong
          ? 1
          : 0.88;

      ctx.fillStyle =
        buy
          ? up
          : down;

      ctx.fillRect(
        px,
        py,
        width,
        height
      );

      ctx.globalAlpha =
        1;

      ctx.fillStyle =
        '#ffffff';

      ctx.fillText(
        label,
        px + 7,
        py + 14
      );

      // Small triangle pointer, like a chart indicator marker.
      ctx.beginPath();

      if (buy) {
        ctx.moveTo(
          x(i) - 4,
          py
        );
        ctx.lineTo(
          x(i) + 4,
          py
        );
        ctx.lineTo(
          x(i),
          py - 6
        );
      } else {
        ctx.moveTo(
          x(i) - 4,
          py + height
        );
        ctx.lineTo(
          x(i) + 4,
          py + height
        );
        ctx.lineTo(
          x(i),
          py + height + 6
        );
      }

      ctx.closePath();

      ctx.fillStyle =
        buy
          ? up
          : down;

      ctx.fill();
    }
  );

  ctx.restore();
}


function renderNiftyEdge(
  ctx,
  g
) {

  const analysis =
    state.niftyEdge;

  if (!analysis) {
    return;
  }

  const latest =
    analysis.latest;

  if (!latest) {
    return;
  }

  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;

  const rows =
    analysis.rows
      .slice(
        start,
        end
      );

  ctx.save();

  ctx.beginPath();
  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );
  ctx.clip();

  ctx.font =
    'bold 11px system-ui';

  rows.forEach(
    (
      row,
      i
    ) => {

      if (
        !row ||
        ![
          'BUY+',
          'SELL+'
        ].includes(
          row.signal
        )
      ) {
        return;
      }

      const candle =
        state.data[
          start + i
        ];

      if (!candle) {
        return;
      }

      const buy =
        row.side === 1;

      const label =
        row.signal;

      const width =
        48;

      const height =
        21;

      const px =
        Math.max(
          0,
          Math.min(
            plot - width,
            x(i) -
            width / 2
          )
        );

      const py =
        Math.max(
          top + 3,
          Math.min(
            bottom -
            height -
            2,
            y(
              buy
                ? candle.low
                : candle.high
            ) +
            (
              buy
                ? 20
                : -31
            )
          )
        );

      ctx.fillStyle =
        buy
          ? up
          : down;

      ctx.fillRect(
        px,
        py,
        width,
        height
      );

      ctx.fillStyle =
        getComputedStyle(
          document.body
        ).getPropertyValue(
          '--bg'
        );

      ctx.fillText(
        label,
        px + 7,
        py + 14
      );
    }
  );

  const currentActionable =
    [
      'BUY+',
      'SELL+',
      'BUY',
      'SELL'
    ].includes(
      latest.signal
    );

  const plan =
    currentActionable
      ? latest.plan
      : null;

  if (
    plan &&
    latest.time >=
      state.data[
        start
      ]?.time
  ) {

    const levelBoxes = [
      [
        'ENTRY',
        plan.entry,
        '#777f8c'
      ],
      [
        'SL',
        plan.stop,
        down
      ],
      [
        'TP1',
        plan.target1,
        up
      ],
      [
        'TP2',
        plan.target2,
        up
      ],
      [
        'TP3',
        plan.target3,
        up
      ]
    ];

    for (
      const [
        label,
        value,
        color
      ] of levelBoxes
    ) {

      if (
        !Number.isFinite(
          Number(value)
        )
      ) {
        continue;
      }

      const py =
        Math.max(
          top + 2,
          Math.min(
            bottom - 20,
            y(value) - 9
          )
        );

      ctx.strokeStyle =
        color;

      ctx.setLineDash(
        [5, 4]
      );

      ctx.beginPath();
      ctx.moveTo(
        Math.max(
          0,
          plot - 165
        ),
        py + 9
      );
      ctx.lineTo(
        plot - 82,
        py + 9
      );
      ctx.stroke();

      ctx.setLineDash(
        []
      );

      ctx.fillStyle =
        color;

      ctx.fillRect(
        plot - 80,
        py,
        78,
        18
      );

      ctx.fillStyle =
        '#ffffff';

      ctx.font =
        'bold 10px system-ui';

      ctx.fillText(
        label +
        ' ' +
        fmt(value),
        plot - 76,
        py + 12
      );
    }
  }

  ctx.restore();
}


function renderScalper(
  ctx,
  g
) {

  const supported =
    [
      '1m',
      '3m',
      '5m'
    ].includes(
      state.tf
    );


  const enabled =
    scalpEnabled &&
    supported;


  const last =
    state.scalps
      ?.filter(Boolean)
      .at(-1);


  const setup =
    state.scalps
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#scalp-enable')
  ) {

    $('#scalp-enable').checked =
      scalpEnabled;
  }


  if (
    $('#scalp-alerts')
  ) {

    $('#scalp-alerts').checked =
      scalpAlerts;
  }


  if (
    $('#scalp-state')
  ) {

    $('#scalp-state').textContent =
      !scalpEnabled
        ? 'Mode off'
        : !supported
          ? 'Paused · choose 1m, 3m or 5m'
          : !last
            ? 'Warming up'
            : last.direction === 1
              ? 'BUY conditions aligned'
              : last.direction === -1
                ? 'SELL conditions aligned'
                : 'WAIT · mixed conditions';


    $('#scalp-state').className =
      enabled &&
      last?.direction === 1
        ? 'up'
        : enabled &&
          last?.direction === -1
          ? 'down'
          : 'muted';
  }


  if (
    $('#scalp-confirmations')
  ) {

    if (
      enabled &&
      last
    ) {

      const vwapText =
        last.vwapAvailable
          ? last.vwap > 0
            ? 'above'
            : last.vwap < 0
              ? 'below'
              : 'at VWAP'
          : 'N/A (index volume unavailable)';


      $('#scalp-confirmations').textContent =
        'EMA 9/21: ' +
        (
          last.ema > 0
            ? 'bullish'
            : last.ema < 0
              ? 'bearish'
              : 'flat'
        ) +
        ' · VWAP: ' +
        vwapText +
        ' · RSI 14: ' +
        (
          Number.isFinite(
            last.rsi
          )
            ? last.rsi.toFixed(1)
            : '—'
        );

    } else {

      $('#scalp-confirmations').textContent =
        'Uses EMA 9/21, RSI 14 and genuine session VWAP when volume is available';
    }
  }


  if (
    $('#scalp-setup')
  ) {

    $('#scalp-setup').textContent =
      enabled &&
      setup
        ? 'Latest ' +
          setup.signal.toUpperCase() +
          ' setup · ' +
          new Date(
            setup.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST · live-session levels'
        : 'No setup displayed';
  }


  for (
    const key of [
      'entry',
      'stop',
      'target'
    ]
  ) {

    if (
      $('#scalp-' + key)
    ) {

      $('#scalp-' + key).textContent =
        enabled &&
        setup
          ? fmt(
              setup[key]
            )
          : '—';
    }
  }


  if (!enabled) {
    return;
  }


  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  ctx.font =
    'bold 10px system-ui';


  state.scalps
    .slice(
      start,
      end
    )
    .forEach(
      (
        s,
        i
      ) => {

        if (
          !s?.signal
        ) {
          return;
        }

        const buy =
          s.signal === 'Buy';

        const label =
          buy
            ? 'BUY'
            : 'SELL';

        const markerW =
          42;

        const markerH =
          20;

        const px =
          Math.max(
            0,
            Math.min(
              plot - markerW,
              x(i) -
              markerW / 2
            )
          );

        const py =
          Math.max(
            top + 3,
            Math.min(
              bottom - markerH - 2,

              y(
                s.entry
              ) +
              (
                buy
                  ? 24
                  : -34
              )
            )
          );

        ctx.fillStyle =
          buy
            ? up
            : down;

        ctx.fillRect(
          px,
          py,
          markerW,
          markerH
        );

        ctx.fillStyle =
          getComputedStyle(
            document.body
          ).getPropertyValue(
            '--bg'
          );

        ctx.font =
          'bold 11px system-ui';

        ctx.fillText(
          label,
          px + 8,
          py + 14
        );
      }
    );


  ctx.restore();
}


function processScalpAlerts() {

  const fresh =
    scalpTracker.collect(
      state.scalps || [],

      scalpEnabled &&
      scalpAlerts &&
      [
        '1m',
        '3m',
        '5m'
      ].includes(
        state.tf
      )
    );


  for (
    const event of fresh
  ) {

    const alert = {

      source:
        'Pro Scalper',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        event.entry
    };


    signalHistory.unshift(
      alert
    );


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      'Pro Scalper ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name +
      ' · ' +
      state.tf +
      ' · ₹' +
      fmt(event.entry)
    );

    showSignalNotification(
      'Pro Scalper ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name,
      state.tf +
      ' · ₹' +
      fmt(event.entry) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#scalp-enable')
) {

  $('#scalp-enable').onchange =
    event => {

      scalpEnabled =
        event.target.checked;


      save(
        'stride-scalper',
        scalpEnabled
      );


      scalpTracker.baseline(
        state.scalps ||
        []
      );


      momentumTracker.baseline(
        state.momentum ||
        []
      );


      draw();
    };
}


if (
  $('#scalp-alerts')
) {

  $('#scalp-alerts').onchange =
    event => {

      scalpAlerts =
        event.target.checked;


      save(
        'stride-scalper-alerts',
        scalpAlerts
      );


      scalpTracker.baseline(
        state.scalps ||
        []
      );
    };
}


$$('[data-scalp-tf]')
  .forEach(
    button => {

      button.onclick =
        () => {

          const target =
            document.querySelector(
              '[data-tf="' +
              button.dataset.scalpTf +
              '"]'
            );


          target?.click();
        };
    }
  );


/* ======================================================
   NATIVE APP
====================================================== */


if (
  window.Capacitor
    ?.isNativePlatform()
) {

  document.body.classList.add(
    'native-app'
  );


  if (
    $('#install')
  ) {

    $('#install').hidden =
      true;
  }
}


/* ======================================================
   MOMENTUM
====================================================== */


function renderMomentum(
  ctx,
  g
) {

  const last =
    state.momentum
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#momentum-alerts')
  ) {

    $('#momentum-alerts').checked =
      momentumAlerts;
  }


  if (
    $('#momentum-status')
  ) {

    $('#momentum-status').textContent =
      last
        ? 'Last ' +
          last.signal.toUpperCase() +
          ' · ' +
          new Date(
            last.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No confirmed momentum crossing';
  }


  /*
    Momentum calculations and alerts remain active.
    Chart labels are intentionally hidden to keep the
    primary BUY / SELL view clean.
  */
}


function processMomentumAlerts() {

  const fresh =
    momentumTracker.collect(
      state.momentum || [],
      momentumAlerts
    );


  for (
    const event of fresh
  ) {

    signalHistory.unshift({
      source:
        'Stride Momentum',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        event.price
    });


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      'Momentum ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name +
      ' · ' +
      state.tf +
      ' · ₹' +
      fmt(event.price)
    );

    showSignalNotification(
      'Stride Momentum ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name,
      state.tf +
      ' · ₹' +
      fmt(event.price) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#momentum-alerts')
) {

  $('#momentum-alerts').onchange =
    event => {

      momentumAlerts =
        event.target.checked;


      save(
        'stride-momentum-alerts',
        momentumAlerts
      );


      momentumTracker.baseline(
        state.momentum ||
        []
      );
    };
}


/* ======================================================
   INITIAL WATCHLIST
====================================================== */


renderWatch();


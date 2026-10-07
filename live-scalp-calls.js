import { confirmedTrigger } from './confirmed-trigger.js';

const finite = v => v != null && v !== '' && Number.isFinite(Number(v));
export function liveScalpCall({finalizer, consensus, risk, feedStatus, quoteTime, seconds, timeframe, symbol, now = Date.now(), replay = false, sample = false, atr, ema, closedTime} = {}) {
  const wait = reason => ({signal:'WAIT',side:0,reason,plan:null,time:finalizer?.time ?? null});
  if (!['1m','3m'].includes(timeframe) || !['NIFTY'].includes(symbol)) return wait('Select NIFTY 1m or 3m for live scalping calls');
  const trigger = confirmedTrigger({finalizer,consensus,now,seconds,replay,sample});
  if (trigger.side === 0) return wait(trigger.reason);
  if (!finite(closedTime) || Number(closedTime) !== Number(finalizer.time)) return wait('Waiting for the latest closed-candle analysis');
  const quoteAge = now / 1000 - Number(quoteTime);
  if (feedStatus !== 'LIVE' || !finite(quoteTime) || quoteAge < 0 || quoteAge > 20) return wait('Waiting for a fresh live Upstox quote');
  if (risk?.ready !== true || risk?.quality !== 'GOOD') return wait('Risk Engine has not approved the plan');
  const p = finalizer.plan;
  if (!p || !['entry','stop','target1','target2','target3'].every(k => finite(p[k]) && Number(p[k]) > 0)) return wait('Complete entry, stop and T1/T2/T3 required');
  const plan = Object.fromEntries(['entry','stop','target1','target2','target3'].map(k=>[k,Number(p[k])]));
  const direction = trigger.side, riskPoints = direction * (plan.entry - plan.stop);
  const rewards = ['target1','target2','target3'].map(k=>direction*(plan[k]-plan.entry));
  if (riskPoints <= 0 || rewards[0] <= 0 || rewards[1] <= rewards[0] || rewards[2] <= rewards[1] || rewards[2]/riskPoints < 2 - 1e-9) return wait('Invalid plan direction or T3 below 2R');
  if (!finite(atr) || Number(atr) <= 0 || !finite(ema)) return wait('ATR and EMA distance checks warming up');
  if (Math.abs(plan.entry - Number(ema))/Number(atr) > 1.5) return wait('Price extended more than 1.5 ATR from EMA 21');
  return {...trigger,plan,time:Number(finalizer.time),symbol,timeframe,rr:rewards[2]/riskPoints,
    reason:'Closed candle · 5m/15m/1h + consensus + Finalizer + Risk Engine · T3 ≥ 2R'};
}

export class LiveCallTracker {
  constructor(saved = []) { this.sent = Array.isArray(saved) ? saved.filter(s=>typeof s?.key==='string' && Number.isFinite(s.at)).slice(-50) : []; this.baselines = new Map(); }
  collect(call, {context, closedTime, enabled, now = Date.now(), cooldownMs = 180000} = {}) {
    if (!this.baselines.has(context)) { if (finite(closedTime)) this.baselines.set(context,Number(closedTime)); return null; }
    if (!enabled) { if (finite(closedTime)) this.baselines.set(context,Number(closedTime)); return null; }
    if (![1,-1].includes(call?.side) || !call?.plan || !finite(call.time) || call.time <= this.baselines.get(context)) return null;
    const key = `${context}:${call.time}`;
    const last = this.sent.filter(s=>s.context===context).at(-1);
    if (this.sent.some(s=>s.key===key) || (last && now-last.at < cooldownMs)) return null;
    this.sent.push({key,context,at:now}); this.sent = this.sent.slice(-50);
    return call;
  }
}


import test from 'node:test';
import assert from 'node:assert/strict';
import {liveScalpCall,LiveCallTracker} from './live-scalp-calls.js';
const now=Date.parse('2026-10-07T04:30:00Z');
const time=now/1000-60;
const input = () => ({now,seconds:60,timeframe:'1m',symbol:'NIFTY',feedStatus:'LIVE',quoteTime:now/1000,closedTime:time,
  finalizer:{time,side:1,primeConfirmed:true,plan:{entry:100,stop:98,target1:102,target2:103,target3:104}},
  consensus:{signal:'BUY',confidence:85},risk:{ready:true,quality:'GOOD'},atr:2,ema:100});
test('confirmed real closed candle returns complete ordered plan',()=>{
  const r=liveScalpCall(input()); assert.equal(r.signal,'BUY'); assert.equal(r.rr,2); assert.equal(r.plan.stop,98);
  const s=input();s.finalizer.side=-1;s.consensus.signal='SELL';s.finalizer.plan={entry:100,stop:102,target1:98,target2:97,target3:96};
  assert.equal(liveScalpCall(s).signal,'SELL');
});
test('replay, sample, closed market, stale quotes and non-live feeds never produce calls',()=>{
  for (const patch of [{replay:true},{sample:true},{now:Date.parse('2026-10-07T12:00:00Z')},{quoteTime:now/1000-21},{quoteTime:null},{feedStatus:'STALE'},{timeframe:'5m'},{symbol:'OTHER'}]) {
    assert.equal(liveScalpCall({...input(),...patch}).signal,'WAIT');
  }
});
test('forming, stale or old analysis is blocked',()=>{
  for (const t of [now/1000,now/1000-200]) {const s=input();s.finalizer.time=t;s.closedTime=t;assert.equal(liveScalpCall(s).signal,'WAIT');}
  assert.equal(liveScalpCall({...input(),closedTime:time+60}).signal,'WAIT');
});
test('consensus, Prime and Risk Engine are mandatory',()=>{
  for (const patch of [{consensus:{signal:'SELL',confidence:90}},{consensus:{signal:'BUY',confidence:79}},{risk:{ready:false,quality:'GOOD'}},{risk:{ready:true,quality:'BLOCK'}}]) assert.equal(liveScalpCall({...input(),...patch}).signal,'WAIT');
  const s=input();s.finalizer.primeConfirmed=false;assert.equal(liveScalpCall(s).signal,'WAIT');
});
test('missing or wrong-direction prices, low R:R and chasing extended prices block calls',()=>{
  for(const patch of [{stop:null},{stop:101},{target3:103.5},{target2:105},{target1:''}]){const s=input();Object.assign(s.finalizer.plan,patch);assert.equal(liveScalpCall(s).signal,'WAIT');}
  for(const patch of [{ema:90},{atr:null},{ema:null}])assert.equal(liveScalpCall({...input(),...patch}).signal,'WAIT');
});
test('startup and settings changes do not alert historical signals; duplicates and cooldown are blocked',()=>{
  const tracker=new LiveCallTracker();const call=liveScalpCall(input());const opts={context:'NIFTY:1m',closedTime:time,enabled:true,now};
  assert.equal(tracker.collect(call,opts),null);
  assert.equal(tracker.collect(call,opts),null);
  const next={...call,time:time+60};assert.equal(tracker.collect(next,{...opts,closedTime:next.time,now:now+60000}),next);
  assert.equal(tracker.collect(next,{...opts,now:now+300000}),null);
  assert.equal(tracker.collect({...next,time:next.time+60},{...opts,now:now+120000}),null);
  const later={...next,time:next.time+180};assert.equal(tracker.collect(later,{...opts,closedTime:later.time,now:now+240000}),later);
  const restored=new LiveCallTracker(tracker.sent); restored.collect(later,{...opts,closedTime:time});
  assert.equal(restored.collect(later,{...opts,now:now+600000}),null);
  tracker.collect({...later,time:later.time+60},{...opts,closedTime:later.time+60,enabled:false});
  assert.equal(tracker.collect({...later,time:later.time+60},{...opts,now:now+700000}),null);
});


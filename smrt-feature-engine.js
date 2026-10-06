// Closed OHLCV only. This engine vetoes existing decisions; it never creates direction.
const valid = x => x !== null && x !== undefined && Number.isFinite(Number(x));
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const tp = b => (b.high+b.low+b.close)/3;
const hi = a => Math.max(...a.map(b=>b.high));
const lo = a => Math.min(...a.map(b=>b.low));
const stamp = t => new Date(Number(t)*1000+19800000);
const day = t => stamp(t).toISOString().slice(0,10);
const minute = t => stamp(t).getUTCHours()*60+stamp(t).getUTCMinutes();
function week(t){const d=stamp(t);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function levels(a){if(!a.length)return null;const h=hi(a),l=lo(a),c=a.at(-1).close,p=(h+l+c)/3,bc=(h+l)/2,tc=2*p-bc;return {high:h,low:l,close:c,pivot:p,bc:Math.min(bc,tc),tc:Math.max(bc,tc),r1:2*p-l,s1:2*p-h,r2:p+h-l,s2:p-h+l,r3:h+2*(p-l),s3:l-2*(h-p)};}
export function analyseFeatures(input,{ema=null,vwap=null}={}){
 const unavailable={ready:false,reasons:['Waiting for 30 valid closed candles'],confidence:0};
 if(!Array.isArray(input)||input.length<30)return unavailable;
 if(input.some(b=>!['time','open','high','low','close'].every(k=>valid(b[k]))||b.high<b.low||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))return {...unavailable,reasons:['Invalid OHLC data']};
 const c=input.map(b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,['time','open','high','low','close','volume'].includes(k)&&valid(v)?Number(v):v])));
 if(c.some((b,i)=>i&&b.time<=c[i-1].time))return {...unavailable,reasons:['Unsorted or duplicate candle timestamps']};
 const last=c.at(-1),prior=c.at(-2),n=c.length;
 const tr=c.map((b,i)=>i?Math.max(b.high-b.low,Math.abs(b.high-c[i-1].close),Math.abs(b.low-c[i-1].close)):b.high-b.low);
 let atr=mean(tr.slice(1,15));for(let i=15;i<n;i++)atr=(atr*13+tr[i])/14;
 let e=mean(c.slice(0,20).map(b=>b.close));for(let i=20;i<n;i++)e+=(c[i].close-e)*2/21;
 const tail=c.slice(-14),range=hi(tail)-lo(tail),chop=range>0?100*Math.log10(tr.slice(-14).reduce((s,x)=>s+x,0)/range)/Math.log10(14):100;
 const ar=c.slice(-26);let ih=0,il=0;ar.forEach((b,i)=>{if(b.high>=ar[ih].high)ih=i;if(b.low<=ar[il].low)il=i;});
 const typical=c.slice(-20).map(tp),avg=mean(typical),dev=mean(typical.map(x=>Math.abs(x-avg))),cci=dev?(tp(last)-avg)/(.015*dev):0;
 const volumeReady=c.every(b=>valid(b.volume)&&b.volume>=0)&&c.slice(-21).every(b=>b.volume>0);
 let obv=null,mfi=null,cmf=null,relativeVolume=null,profile=null;
 if(volumeReady){obv=0;for(let i=1;i<n;i++)obv+=Math.sign(c[i].close-c[i-1].close)*c[i].volume;
 let pos=0,neg=0;for(let i=n-14;i<n;i++){const flow=tp(c[i])*c[i].volume;if(tp(c[i])>tp(c[i-1]))pos+=flow;else if(tp(c[i])<tp(c[i-1]))neg+=flow;}mfi=pos+neg?100*pos/(pos+neg):50;
 const v=c.slice(-20),total=v.reduce((s,b)=>s+b.volume,0);cmf=v.reduce((s,b)=>s+(b.high===b.low?0:(2*b.close-b.high-b.low)/(b.high-b.low))*b.volume,0)/total;
 relativeVolume=last.volume/mean(c.slice(-21,-1).map(b=>b.volume));
 const session=c.filter(b=>day(b.time)===day(last.time));const bottom=lo(session),width=(hi(session)-bottom)/32;
 if(width>0){const bins=Array(32).fill(0);for(const b of session){const start=Math.min(31,Math.floor((b.low-bottom)/width)),end=Math.min(31,Math.floor((b.high-bottom)/width));for(let i=start;i<=end;i++)bins[i]+=b.volume/(end-start+1);}
 const poc=bins.indexOf(Math.max(...bins));let l=poc,h=poc,sum=bins[poc],total=bins.reduce((s,x)=>s+x,0);while(sum<total*.7&&(l>0||h<31)){if(h<31&&(l===0||bins[h+1]>=bins[l-1]))sum+=bins[++h];else sum+=bins[--l];}profile={poc:bottom+(poc+.5)*width,val:bottom+l*width,vah:bottom+(h+1)*width,method:'OHLCV allocation estimate, 32 bins / 70% value area'};}
 }
 const days=[...new Set(c.map(b=>day(b.time)))],weeks=[...new Set(c.map(b=>week(b.time)))];
 const previousDay=levels(c.filter(b=>day(b.time)===days.at(-2))),previousWeek=levels(c.filter(b=>week(b.time)===weeks.at(-2)));
 const session=c.filter(b=>day(b.time)===day(last.time));const opening=session.filter(b=>minute(b.time)>=555&&minute(b.time)<570);
 const orb=opening.length&&minute(session[0].time)===555&&minute(last.time)>=570?{high:hi(opening),low:lo(opening),side:last.close>hi(opening)?1:last.close<lo(opening)?-1:0}:null;
 const gap=previousDay&&minute(session[0].time)===555?{points:session[0].open-previousDay.close,percent:100*(session[0].open/previousDay.close-1),filled:lo(session)<=previousDay.close&&hi(session)>=previousDay.close}:null;
 const swings=[];for(let i=2;i<n-2;i++){const w=c.slice(i-2,i+3);if(c[i].high===hi(w))swings.push({type:'high',price:c[i].high,time:c[i].time,confirmedAt:c[i+2].time});if(c[i].low===lo(w))swings.push({type:'low',price:c[i].low,time:c[i].time,confirmedAt:c[i+2].time});}
 const resistance=hi(c.slice(-22,-2)),support=lo(c.slice(-22,-2));
 const breakout=last.close>resistance?1:last.close<support?-1:0;
 const retest=prior.close>resistance&&last.low<=resistance+atr*.2&&last.close>resistance?1:prior.close<support&&last.high>=support-atr*.2&&last.close<support?-1:0;
 const falseBreakout=(last.high>resistance&&last.close<=resistance)||(last.low<support&&last.close>=support)||(prior.close>resistance&&last.close<=resistance)||(prior.close<support&&last.close>=support);
 const volatility=atr/last.close*100,regime=volatility>.8?'HIGH VOLATILITY':volatility<.03?'LOW VOLATILITY':chop>=61.8?'RANGE':chop<=38.2?'TREND':'TRANSITION';
 const mins=minute(last.time),weekday=stamp(last.time).getUTCDay(),sessionQuality=weekday>0&&weekday<6&&mins>=570&&mins<915?(mins>=690&&mins<810?60:90):0;
 const emaDistance=valid(ema)&&atr>0?Math.abs(last.close-Number(ema))/atr:null,vwapDistance=valid(vwap)&&atr>0?Math.abs(last.close-Number(vwap))/atr:null;
 const reasons=[];if(!(atr>0))reasons.push('ATR unavailable');if(!volumeReady)reasons.push('Real volume unavailable');if(sessionQuality===0)reasons.push('Outside eligible NSE session / opening or closing filter');if(['RANGE','HIGH VOLATILITY','LOW VOLATILITY'].includes(regime))reasons.push('Market regime: '+regime);if(falseBreakout)reasons.push('False breakout detected');if(emaDistance===null||vwapDistance===null)reasons.push('EMA / verified VWAP unavailable');if(emaDistance>2||vwapDistance>2)reasons.push('Price extended beyond 2 ATR');if(relativeVolume!==null&&relativeVolume<1.1)reasons.push('Relative volume below 1.1');
 return {ready:true,time:last.time,close:last.close,atr,keltner:{middle:e,upper:e+2*atr,lower:e-2*atr},choppiness:chop,aroon:{up:100*ih/25,down:100*il/25},cci,mfi,obv,cmf,relativeVolume,volumeSpike:relativeVolume!==null&&relativeVolume>=2,volumeProfile:profile,previousDay,previousWeek,orb,gap,swings:swings.slice(-12),breakout,retest,falseBreakout,regime,sessionQuality,emaDistance,vwapDistance,reasons,confidence:Math.max(0,Math.min(100,Math.round(100-reasons.length*15-(100-sessionQuality)*.15)))};
}
export function buildFeaturePlan(f,side){if(!f?.ready||!(f.atr>0)||![1,-1].includes(side))return null;const swing=[...f.swings].reverse().find(x=>x.type===(side===1?'low':'high')&&(f.close-x.price)*side>0);const base=f.close-side*f.atr*1.2,stop=swing?(side===1?Math.min(base,swing.price-f.atr*.15):Math.max(base,swing.price+f.atr*.15)):base,risk=Math.abs(f.close-stop);return {entry:f.close,stop,target1:f.close+side*risk*1.25,target2:f.close+side*risk*2,target3:f.close+side*risk*3,invalidation:stop,rr1:1.25,rr2:2,rr3:3};}
export function trailStop(plan,f,side){return side===1?Math.max(plan.stop,f.close-f.atr*1.5):Math.min(plan.stop,f.close+f.atr*1.5);}
export function gateFeatures(decision,f,{consensus=null,risk=null,memory=null,cooldownSeconds=900,sample=false,now=Date.now()/1000,intervalSeconds=300}={}){
 const reasons=[...(f?.reasons||['Feature data unavailable'])];if(!f?.ready&&!reasons.length)reasons.push('Feature data unavailable');if(sample)reasons.push('Sample data cannot produce live signals');if(!valid(f?.time)||now-Number(f.time)>intervalSeconds*2||Number(f.time)+intervalSeconds>now)reasons.push('Closed-candle data is stale or forming');
 const side=Number(decision?.side||0);if(side){if(Number(consensus?.side)!==side)reasons.push('All Indicators Consensus does not confirm');if(risk?.ready!==true||risk?.quality==='BLOCK')reasons.push('Risk Engine does not approve');if(f?.breakout&&f.retest!==side)reasons.push('Breakout awaiting retest confirmation');if(memory?.time!==undefined&&(f.time===memory.time||f.time-memory.time<cooldownSeconds))reasons.push('Signal cooldown / duplicate prevention');}
 if(reasons.length||!side)return {...decision,state:'NO TRADE',side:0,plan:null,confidence:f?.confidence||0,reasons:[...new Set([...(decision?.reasons||[]),...reasons])],featureReasons:reasons};
 if(memory){memory.time=f.time;memory.side=side;}return {...decision,confidence:Math.min(Number(decision.score)||0,f.confidence),reasons:[...(decision.reasons||[]),'Feature filters passed']};
}
export function replayMetrics(trades){const t=trades.filter(x=>valid(x.pnl)&&valid(x.r)&&valid(x.risk)&&x.risk>0);if(!t.length)return {trades:0,winRate:null,profitFactor:null,maxDrawdown:null,expectancy:null,averageRR:null};let equity=0,peak=0,dd=0,gain=0,loss=0;for(const x of t){equity+=x.pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);gain+=Math.max(0,x.pnl);loss+=Math.max(0,-x.pnl);}return {trades:t.length,winRate:100*t.filter(x=>x.pnl>0).length/t.length,profitFactor:loss?gain/loss:gain?Infinity:null,maxDrawdown:dd,expectancy:mean(t.map(x=>x.pnl)),averageRR:mean(t.map(x=>x.r))};}
// Forward replay ledger: entries are approved signals at a closed candle's close.
// Future closed candles alone determine exits. Stop wins ambiguous stop/target bars.
export function advanceReplay(ledger,candles,decision,f){
 for(const b of candles){if(b.time<=(ledger.time??-Infinity))continue;ledger.time=b.time;const a=ledger.active;if(!a||b.time<=a.time)continue;
 const stopHit=a.side===1?b.low<=a.stop:b.high>=a.stop,targetHit=a.side===1?b.high>=a.target3:b.low<=a.target3;
 if(stopHit||targetHit){const exit=stopHit?(a.side===1?Math.min(b.open,a.stop):Math.max(b.open,a.stop)):a.target3,pnl=(exit-a.entry)*a.side;ledger.trades.push({entryTime:a.time,exitTime:b.time,pnl,r:pnl/a.risk,risk:a.risk});ledger.active=null;}
 else if(f?.time===b.time) a.stop=trailStop(a,f,a.side);
 }
 if(!ledger.active&&decision?.side&&decision.plan){const p=decision.plan;ledger.active={...p,side:decision.side,time:f.time,risk:Math.abs(p.entry-p.stop)};}
 return replayMetrics(ledger.trades);
}
export function backtestRecordedSignals({candles,signals,intervalSeconds=300}){
 if(!Array.isArray(candles)||!Array.isArray(signals)||!Number.isFinite(intervalSeconds)||intervalSeconds<=0)throw new Error('Expected candles, recorded signals, and positive intervalSeconds');
 const ledger={trades:[],active:null},memory={},byTime=new Map(signals.map(s=>[s.time,s]));
 const ordered=candles.slice().sort((a,b)=>a.time-b.time);
 if(ordered.some((b,i)=>i&&b.time===ordered[i-1].time))throw new Error('Duplicate candle timestamps');
 for(let i=0;i<ordered.length;i++){
  const b=ordered[i],s=byTime.get(b.time),f=analyseFeatures(ordered.slice(0,i+1),{ema:s?.ema,vwap:s?.vwap});
  // Recorded approvals are rechecked; no synthetic strategy directions are generated.
  const candidate=s?.decision?{...s.decision,plan:buildFeaturePlan(f,s.decision.side)}:{side:0};
  const decision=gateFeatures(candidate,f,{consensus:s?.consensus,risk:s?.risk,memory,now:b.time+intervalSeconds,intervalSeconds});
  advanceReplay(ledger,[b],decision,f);
 }
 return {metrics:replayMetrics(ledger.trades),trades:ledger.trades,openTrade:ledger.active,assumptions:'Recorded approvals rechecked causally; T3 exits, ATR trailing, stop-first ambiguous bars; points before fees/slippage. Open trades excluded.'};
}
export function mountReplayTools(){const host=document.getElementById('smrt-replay-tools');if(!host)return;const label=document.createElement('label');label.textContent='Backtest your recorded OHLCV and approved signal JSON: ';const input=document.createElement('input');input.type='file';input.accept='.json,application/json';const out=document.createElement('pre');out.style.whiteSpace='pre-wrap';input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;const result=backtestRecordedSignals(JSON.parse(await file.text()));out.textContent=JSON.stringify(result,null,2);}catch(e){out.textContent='Replay unavailable: '+e.message;}});label.append(input);host.append(label,out);}
export function renderFeatures(f,decision,metrics){const host=document.getElementById('smrt-feature-panel');if(!host)return;host.replaceChildren();const add=(label,value)=>{const row=document.createElement('p');row.textContent=label+': '+(value===null||value===undefined?'Unavailable':typeof value==='object'?JSON.stringify(value):value);host.append(row);};add('Status',decision?.state||'NO TRADE');add('Confidence (confluence score, not probability)',decision?.confidence??0);for(const k of ['keltner','choppiness','aroon','cci','mfi','obv','cmf','relativeVolume','volumeSpike','volumeProfile','previousDay','previousWeek','orb','gap','swings','breakout','retest','falseBreakout','regime','sessionQuality','emaDistance','vwapDistance'])add(k,f?.[k]);add('Trade plan / invalidation / R:R',decision?.plan);add('Signal reasons',decision?.reasons);add('Replay metrics (closed trades only; points, before costs)',metrics);}

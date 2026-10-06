// Closed OHLCV only. Context indicators only; no trade signals or orders.
const valid = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
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



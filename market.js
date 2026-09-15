// Market adapters return normalized INR OHLCV candles. No credentials belong in this client.
export const instruments = [
 {id:'NIFTY',name:'NIFTY 50',kind:'INDEX',description:'Nifty 50 Index',base:24836.6,change:0.68},
 {id:'BANKNIFTY',name:'BANK NIFTY',kind:'INDEX',description:'Nifty Bank Index',base:53241.35,change:0.42},
 {id:'NIFTY-FUT',name:'NIFTY FUT',kind:'FUTURE',description:'Demo front-month future',base:24904.5,change:0.73},
 {id:'NIFTY-CE',name:'NIFTY 25,000 CE',kind:'CALL',description:'Demo call option · 25,000',base:184.75,change:3.24},
 {id:'NIFTY-PE',name:'NIFTY 24,500 PE',kind:'PUT',description:'Demo put option · 24,500',base:126.4,change:-2.16},
 {id:'MCX-GOLD',name:'MCX GOLD',kind:'COMMODITY',description:'MCX Gold Futures · demo',base:152784,change:0.29}
];
export const intervals={'1m':60,'5m':300,'15m':900,'1h':3600,'1D':86400};
export function sma(values,n){let sum=0;return values.map((v,i)=>{sum+=v;if(i>=n)sum-=values[i-n];return i>=n-1?sum/n:null})}
export function ema(values,n){const k=2/(n+1);let last=values[0];return values.map((v,i)=>last=i?v*k+last*(1-k):v)}
export function indicators(candles){
 const close=candles.map(c=>c.close),e9=ema(close,9),e21=ema(close,21),e50=ema(close,50),e12=ema(close,12),e26=ema(close,26);
 const macd=e12.map((v,i)=>v-e26[i]),signal=ema(macd,9),hist=macd.map((v,i)=>v-signal[i]);
 let gain=0,loss=0,totalV=0,totalPV=0,day='';
 const rsi=close.map((v,i)=>{if(!i)return null;const d=v-close[i-1];if(i<=14){gain+=Math.max(d,0)/14;loss+=Math.max(-d,0)/14}else{gain=(gain*13+Math.max(d,0))/14;loss=(loss*13+Math.max(-d,0))/14}return i<14?null:loss===0?(gain===0?50:100):100-100/(1+gain/loss)});
 const bb=close.map((v,i)=>{if(i<19)return null;const a=close.slice(i-19,i+1),m=a.reduce((s,x)=>s+x,0)/20,sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/20);return {mid:m,upper:m+2*sd,lower:m-2*sd}});
 const vwap=candles.map(c=>{const d=new Date((c.time+19800)*1000).toISOString().slice(0,10);if(day!==d){day=d;totalV=0;totalPV=0}totalV+=c.volume;totalPV+=(c.high+c.low+c.close)/3*c.volume;return totalV?totalPV/totalV:c.close});
 return {s50:sma(close,50),s200:sma(close,200),e200:ema(close,200),e9,e21,e50,rsi,macd,signal,hist,bb,vwap};
}
export class DemoMarketAdapter {
 async history(symbol,timeframe){
  const instrument=instruments.find(i=>i.id===symbol);if(!instrument||!intervals[timeframe])throw Error('Unsupported instrument or interval');
  let seed=Array.from(symbol+timeframe).reduce((a,c)=>a+c.charCodeAt(0),17);
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const n=400,step=intervals[timeframe],end=Math.floor(Date.now()/1000/step)*step,unit=instrument.base*(instrument.kind==='CALL'||instrument.kind==='PUT'?.009:.00038);
  let price=instrument.base-unit*9;
  const rows=Array.from({length:n},(_,i)=>{const open=price;price=Math.max(unit,open+(random()-.475)*unit*2.2+Math.sin(i/14)*unit*.19);return {time:end-(n-1-i)*step,open,close:price,high:Math.max(open,price)+random()*unit*.8,low:Math.max(.01,Math.min(open,price)-random()*unit*.8),volume:Math.round(30000+random()*90000)}});
  const offset=instrument.base-rows.at(-1).close;return rows.map(c=>({...c,open:c.open+offset,high:c.high+offset,low:c.low+offset,close:c.close+offset}));
 }
 subscribe(symbol,timeframe,onTick,onError){let alive=true,last=this.quotes?.[symbol]??instruments.find(i=>i.id===symbol).base;const tick=async()=>{if(!alive)return;try{const r=await fetch('/.netlify/functions/live-quote?symbol='+encodeURIComponent(symbol),{cache:'no-store'});const q=await r.json();if(q.live&&Number.isFinite(q.price)){const delta=q.price-last;last=q.price;onTick({time:Math.floor(Date.now()/1000),delta,volume:Math.round(100+Math.random()*800),live:true});return}}catch{}onTick({time:Math.floor(Date.now()/1000),delta:(Math.random()-.48)*instruments.find(i=>i.id===symbol).base*.00008,volume:Math.round(100+Math.random()*800),live:false})};tick();const timer=setInterval(tick,3000);return()=>{alive=false;clearInterval(timer)}}
}
// Inject a compatible adapter here. Production history + subscriptions should call
// your authenticated backend, where exchange/broker credentials remain secret.
export const market = new DemoMarketAdapter();
// Original volatility-trailing indicator. Uses only closed bars and past values.
export function strideSignals(candles, { period = 14, multiplier = 2.5, closedCount = Math.max(0, candles.length - 1) } = {}) {
  if (!Number.isInteger(period) || period < 2 || !Number.isFinite(multiplier) || multiplier <= 0 || !Number.isInteger(closedCount) || closedCount < 0 || closedCount > candles.length) throw new Error('Invalid signal settings');
  const result = Array(candles.length).fill(null);
  let atr = 0, stop = null, direction = 0;
  for (let i = 0; i < closedCount; i++) {
    const c = candles[i], previousClose = i ? candles[i - 1].close : c.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
    if (i < period) atr += tr / period;
    else atr = (atr * (period - 1) + tr) / period;
    if (i < period - 1) continue;
    const distance = atr * multiplier;
    let signal = null;
    if (stop === null) {
      direction = c.close >= candles[i - period + 1].close ? 1 : -1;
      stop = c.close - direction * distance;
    } else if (direction === 1 && c.close < stop) {
      direction = -1; stop = c.close + distance; signal = 'Sell';
    } else if (direction === -1 && c.close > stop) {
      direction = 1; stop = c.close - distance; signal = 'Buy';
    } else {
      stop = direction === 1 ? Math.max(stop, c.close - distance) : Math.min(stop, c.close + distance);
    }
    result[i] = { time: c.time, atr, stop, direction, signal };
  }
  return result;
}

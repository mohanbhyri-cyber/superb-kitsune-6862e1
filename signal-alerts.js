// smrt-efficiency-engine.js
// Closed-candle trend-quality / noise filter for NIFTY.
// Context only: it does not create BUY or SELL orders.

const finite = v => Number.isFinite(Number(v));

function trueRange(c, p) {
  if (!c) return null;
  const h = Number(c.high), l = Number(c.low);
  if (!finite(h) || !finite(l)) return null;
  if (!p || !finite(p.close)) return h - l;
  const pc = Number(p.close);
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

function kaufmanER(candles, end, period = 10) {
  if (end < period) return null;
  const change = Math.abs(Number(candles[end].close) - Number(candles[end-period].close));
  let noise = 0;
  for (let i=end-period+1;i<=end;i++) noise += Math.abs(Number(candles[i].close)-Number(candles[i-1].close));
  return noise > 0 ? change / noise : 0;
}

function choppiness(candles, end, period = 14) {
  if (end < period) return null;
  let trSum=0, high=-Infinity, low=Infinity;
  for(let i=end-period+1;i<=end;i++){
    const tr=trueRange(candles[i],candles[i-1]);
    if(!finite(tr)) return null;
    trSum+=tr;
    high=Math.max(high,Number(candles[i].high));
    low=Math.min(low,Number(candles[i].low));
  }
  const range=high-low;
  if(!(range>0) || !(trSum>0)) return 100;
  return 100*Math.log10(trSum/range)/Math.log10(period);
}

function atr(candles,end,period=14){
  if(end<period) return null;
  let sum=0;
  for(let i=end-period+1;i<=end;i++){
    const tr=trueRange(candles[i],candles[i-1]);
    if(!finite(tr)) return null;
    sum+=tr;
  }
  return sum/period;
}

export function analyseEfficiencyEngine(candles, trend) {
  if(!Array.isArray(candles) || candles.length<30) {
    return {ready:false,quality:'WARMING UP',score:0,reason:'Need at least 30 candles'};
  }
  // indicatorData deliberately contains a synthetic forming placeholder when
  // the raw feed contains only completed candles.
  const end=Math.max(0,candles.length-2);
  const er=kaufmanER(candles,end,10);
  const chop=choppiness(candles,end,14);
  const a=atr(candles,end,14);
  const close=Number(candles[end]?.close);
  const move=Math.abs(close-Number(candles[Math.max(0,end-14)]?.close));
  const atrMove=finite(a)&&a>0 ? move/(a*14) : null;
  const adx=Number(trend?.adx?.[end]);

  if(![er,chop,a,close].every(finite)) {
    return {ready:false,quality:'WARMING UP',score:0,reason:'Efficiency inputs unavailable'};
  }

  const erScore=Math.max(0,Math.min(100,er*100));
  const chopScore=Math.max(0,Math.min(100,(61.8-chop)/(61.8-38.2)*100));
  const adxScore=finite(adx)?Math.max(0,Math.min(100,(adx-15)/25*100)):50;
  const moveScore=finite(atrMove)?Math.max(0,Math.min(100,atrMove*100)):50;
  const score=Math.round(erScore*.35+chopScore*.30+adxScore*.25+moveScore*.10);

  const quality=score>=75?'HIGH':score>=55?'GOOD':score>=35?'MIXED':'LOW';
  const noise=chop>=61.8?'HIGH':chop<=38.2?'LOW':'MEDIUM';
  const regime=er>=0.45&&chop<50?'CLEAN TREND':chop>=61.8?'CHOPPY':'TRANSITION';

  return {ready:true,score,quality,noise,regime,er,choppiness:chop,adx:finite(adx)?adx:null,atrNormalizedMove:atrMove,time:candles[end]?.time};
}

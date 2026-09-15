import {indicators} from './market.js';
// Original demonstration rules; no execution or performance claims.
export function proScalper(candles, {closedCount=Math.max(0,candles.length-1)}={}) {
 if(!Number.isInteger(closedCount)||closedCount<0||closedCount>candles.length)throw Error('Invalid closed candle count');
 const calc=candles.length?indicators(candles):null,result=Array(candles.length).fill(null);
 let atr=0,previous=0;
 for(let i=0;i<closedCount;i++){
  const c=candles[i],prev=i?candles[i-1].close:c.close,tr=Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev));
  atr=i<14?atr+tr/14:(atr*13+tr)/14;
  if(i<49)continue;
  const rsi=calc.rsi[i],long=calc.e9[i]>calc.e21[i]&&c.close>calc.vwap[i]&&rsi>=52&&rsi<=70,short=calc.e9[i]<calc.e21[i]&&c.close<calc.vwap[i]&&rsi>=30&&rsi<=48;
  const direction=long?1:short?-1:0,signal=direction&&direction!==previous&&atr>0?(direction===1?'Buy':'Sell'):null;
  const risk=atr*1.5;
  result[i]={time:c.time,signal,direction,atr,rsi,ema:calc.e9[i]>calc.e21[i]?1:calc.e9[i]<calc.e21[i]?-1:0,vwap:c.close>calc.vwap[i]?1:c.close<calc.vwap[i]?-1:0,entry:c.close,stop:signal?c.close-direction*risk:null,target:signal?c.close+direction*risk*2:null};
  previous=direction;
 }
 return result;
}

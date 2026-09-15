import {indicators} from './market.js';
export function momentumSignals(candles){
 const out=Array(candles.length).fill(null);if(!candles.length)return out;const c=indicators(candles);
 for(let i=50;i<candles.length-1;i++){
  const r=c.rsi[i],prev=c.rsi[i-1],price=candles[i].close;
  const signal=prev<=55&&r>55&&price>c.e50[i]?'Buy':prev>=45&&r<45&&price<c.e50[i]?'Sell':null;
  out[i]={time:candles[i].time,signal,rsi:r,ema:c.e50[i],price};
 }
 return out;
}

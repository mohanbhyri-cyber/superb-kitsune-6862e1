import { analyseFeatures } from './new-indicator-calculations.js';
const value=v=>v===null||v===undefined?'Unavailable':typeof v==='number'?Number.isFinite(v)?v.toFixed(2):'Unavailable':typeof v==='object'?Object.entries(v).filter(([k])=>k!=='side').map(([k,x])=>k+': '+value(x)).join(' · '):String(v);
export function newIndicatorRows(candles) {
 const f=analyseFeatures(candles);
 return [
 ['Keltner Channel (EMA 20 / ATR 14 × 2)',f.keltner,'Volatility channel'],
 ['Choppiness Index (14)',f.choppiness,'Trend/range context; not a trade signal'],
 ['Aroon Up / Down (25)',f.aroon,'Trend timing'],
 ['CCI (20)',f.cci,'Commodity Channel Index'],
 ['MFI (14)',f.mfi,'Requires real candle volume'],
 ['OBV',f.obv,'Cumulative volume over loaded history; real volume required'],
 ['CMF (20)',f.cmf,'Requires real candle volume'],
 ['Volume Profile · POC / VAH / VAL',f.volumeProfile,'OHLCV allocation estimate: 32 bins, 70% value area; not tick-level volume'],
 ['Daily Pivots / CPR',f.previousDay,'Uses loaded previous-day candles; complete prior session required'],
 ['Weekly Pivots / CPR',f.previousWeek,'Uses loaded previous-week candles; complete prior week required'],
 ['Opening Range (09:15–09:30 IST)',f.orb,'Requires intraday candles covering the opening window; not a BUY/SELL signal']
 ].map(([name,data,reason])=>({name,data:data??null,status:data===null||data===undefined?'WAIT':'READY',reason:f.ready?reason:'Needs 30 valid closed candles'}));
}
export function renderNewIndicators(candles){
 const host=document.getElementById('new-trading-indicators');if(!host)return;const table=document.createElement('table');table.style.cssText='width:100%;font-size:13px;border-collapse:collapse';
 const h=document.createElement('tr');for(const label of ['New indicator','Status','Value','Details']){const th=document.createElement('th');th.textContent=label;th.style.cssText='padding:10px;text-align:left;border-bottom:1px solid #526078';h.append(th);}table.append(h);
 for(const row of newIndicatorRows(candles)){const tr=document.createElement('tr');for(const text of [row.name,row.status,value(row.data),row.reason]){const td=document.createElement('td');td.textContent=text;td.style.cssText='padding:10px;border-bottom:1px solid #526078;max-width:320px;overflow-wrap:anywhere';tr.append(td);}table.append(tr);}host.replaceChildren(table);
}

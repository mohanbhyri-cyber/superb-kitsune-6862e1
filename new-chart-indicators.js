import { analyseFeatures } from './new-indicator-calculations.js';
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export function chartIndicatorData(candles){
 const out={};const push=(name,time,value)=>{(out[name]??=[]).push(finite(value)?{time,value:Number(value)}:{time});};
 if(!Array.isArray(candles)||candles.some((b,i)=>!b||!['time','open','high','low','close'].every(k=>finite(b[k]))||b.high<b.low||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||(i&&b.time<=candles[i-1].time)))return out;
 for(let i=Math.max(0,candles.length-250);i<candles.length;i++){
 const f=analyseFeatures(candles.slice(0,i+1)),time=Number(candles[i].time);
 for(const [k,v] of Object.entries({KCUpper:f.keltner?.upper,KCMiddle:f.keltner?.middle,KCLower:f.keltner?.lower,DailyPivot:f.previousDay?.pivot,DailyBC:f.previousDay?.bc,DailyTC:f.previousDay?.tc,WeeklyPivot:f.previousWeek?.pivot,WeeklyBC:f.previousWeek?.bc,WeeklyTC:f.previousWeek?.tc,ORBHigh:f.orb?.high,ORBLow:f.orb?.low,CCI:f.cci,MFI:f.mfi,CMF:f.cmf,OBV:f.obv,AroonUp:f.aroon?.up,AroonDown:f.aroon?.down,Choppiness:f.choppiness}))push(k,time,v);
 }return out;
}
const controllers=new WeakMap();
export function syncNewChartIndicators(chart,candles,L){
 if(!chart?.addSeries||!chart?.panes||!L?.LineSeries)return;
 let ctl=controllers.get(chart);
 if(!ctl){
 ctl={series:new Map(),key:null,data:{},overlay:'Keltner',oscillator:'CCI'};controllers.set(chart,ctl);
 const host=document.getElementById('tv-lightweight-chart');if(host&&!document.getElementById('new-chart-indicator-controls')){
 const controls=document.createElement('div');controls.id='new-chart-indicator-controls';controls.style.cssText='display:flex;gap:12px;flex-wrap:wrap;padding:8px;font-size:12px';
 const select=(label,options,field)=>{const el=document.createElement('label');el.textContent=label+' ';const s=document.createElement('select');for(const name of options){const o=document.createElement('option');o.value=name;o.textContent=name;s.append(o);}s.value=ctl[field];s.addEventListener('change',()=>{ctl[field]=s.value;render(chart,ctl,L);});el.append(s);controls.append(el);};
 select('Price overlay',['None','Keltner','Daily Pivots + CPR','Weekly Pivots + CPR','Opening Range'], 'overlay');
 select('Indicator pane',['None','CCI','MFI','CMF','OBV','Aroon','Choppiness'],'oscillator');
 const note=document.createElement('span');note.id='new-chart-indicator-note';controls.append(note);host.parentNode.insertBefore(controls,host);
 }}
 const key=candles.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume].join(',')).join(';');
 if(key!==ctl.key){ctl.key=key;ctl.data=chartIndicatorData(candles);}
 render(chart,ctl,L);
}
function render(chart,ctl,L){
 const groups={'Keltner':['KCUpper','KCMiddle','KCLower'],'Daily Pivots + CPR':['DailyPivot','DailyBC','DailyTC'],'Weekly Pivots + CPR':['WeeklyPivot','WeeklyBC','WeeklyTC'],'Opening Range':['ORBHigh','ORBLow']};
 const wanted=[...(groups[ctl.overlay]||[]),...(ctl.oscillator==='None'?[]:ctl.oscillator==='Aroon'?['AroonUp','AroonDown']:[ctl.oscillator])];
 for(const [name,s] of ctl.series)if(!wanted.includes(name)){chart.removeSeries(s);ctl.series.delete(name);}
 const overlays=new Set(groups[ctl.overlay]||[]);
 for(const name of wanted){let s=ctl.series.get(name);if(!s){const color=name.endsWith('Down')||name.endsWith('Lower')?'#f17c86':name.includes('Weekly')?'#c084fc':'#49c6e5';s=chart.addSeries(L.LineSeries,{title:name,color,lineWidth:1,priceLineVisible:false,lastValueVisible:true},overlays.has(name)?0:1);ctl.series.set(name,s);}
 s.setData(ctl.data[name]||[]);}
 const panes=chart.panes();if(panes.length>1)panes[1].setHeight(130);
 const note=document.getElementById('new-chart-indicator-note');
 if(note){const missing=wanted.filter(k=>!(ctl.data[k]||[]).some(r=>finite(r.value)));note.textContent=missing.length?'WAIT: '+missing.join(', ')+' — real volume / history required':'Closed candles · last 250 plotted bars';}
}

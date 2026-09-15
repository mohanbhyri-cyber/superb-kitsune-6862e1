import {momentumSignals} from './momentum.js';
import {proScalper} from './pro-scalper.js';
import {SignalAlertTracker} from './signal-alerts.js';
import {priceAction} from './price-action.js';
import {instruments, intervals, indicators, market, strideSignals} from './market.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],fmt=n=>n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}},save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const paNames=['Structure','Swings','Order blocks','Fair-value gaps'];
const savedPA=read('stride-pa',['Structure','Order blocks','Fair-value gaps']);
const state={paOverlays:new Set(Array.isArray(savedPA)?savedPA.filter(x=>paNames.includes(x)):paNames),quotes:Object.fromEntries(instruments.map(i=>[i.id,i.base])),symbol:'NIFTY',tf:'5m',data:[],calc:null,signalSensitivity:['fast','balanced','slow'].includes(read('stride-sensitivity','balanced'))?read('stride-sensitivity','balanced'):'balanced',filter:'all',count:90,offset:0,tool:'cursor',drawings:read('stride-drawings',{}),alerts:read('stride-alerts',[]),overlays:new Set(['Momentum','Stride Signals','EMA 9','EMA 21','EMA 50','Volume','S/R']),hover:null};
const colors={'Momentum':'#58c8dc','Stride Signals':'#72e4bd','EMA 9':'#e6ba6f','EMA 21':'#7fa8f5','EMA 50':'#c098e8','EMA 200':'#f2946e','SMA 50':'#58c8dc','SMA 200':'#d7cc77','Bollinger':'#879fac','VWAP':'#ed90b2','Volume':'#72e4bd','S/R':'#9aa8ad'};
const momentumTracker=new SignalAlertTracker();
let momentumAlerts=read('stride-momentum-alerts',false)===true;
const signalTracker=new SignalAlertTracker(),scalpTracker=new SignalAlertTracker();
let scalpEnabled=read('stride-scalper',true)===true,scalpAlerts=read('stride-scalper-alerts',false)===true;
let signalAlertsEnabled=read('stride-signal-alerts-enabled',false)===true;
const signalHistory=read('stride-signal-history',[]);
let unsubscribe,request=0,geometry,drag,startPoint,installPrompt;
if(read('stride-theme','dark')==='light')document.body.classList.add('light');
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',4000)}
function current(){return instruments.find(i=>i.id===state.symbol)}
function quote(){return state.data.at(-1)?.close??current().base}
function change(i){return ((i.id===state.symbol?quote():state.quotes[i.id])/(i.base/(1+i.change/100))-1)*100}
function renderWatch(){const list=instruments.filter(i=>state.filter==='all'||['FUTURE','CALL','PUT'].includes(i.kind));$('#watch-rows').innerHTML=list.map(i=>`<button class="watch-row ${i.id===state.symbol?'selected':''}" data-symbol="${i.id}"><span><strong>${i.name}</strong><small>${i.description}</small></span><span class="watch-price"><strong>${fmt(i.id===state.symbol?quote():state.quotes[i.id])}</strong><span class="${change(i)>=0?'up':'down'}">${change(i)>=0?'+':''}${change(i).toFixed(2)}%</span></span></button>`).join('');$('#ticker').innerHTML=instruments.map(i=>`<div class="ticker-item"><span>${i.name}</span><b>${fmt(i.id===state.symbol?quote():state.quotes[i.id])}</b><span class="${change(i)>=0?'up':'down'}">${change(i)>=0?'+':''}${change(i).toFixed(2)}%</span></div>`).join('')}
function canvas(id){const el=$(id),rect=el.getBoundingClientRect(),dpr=devicePixelRatio||1;el.width=rect.width*dpr;el.height=rect.height*dpr;const ctx=el.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:rect.width,h:rect.height}}
function draw(){if(!state.data.length)return;state.pa=priceAction(state.data);state.momentum=momentumSignals(state.data);state.calc=indicators(state.data);state.scalps=proScalper(state.data);state.signals=strideSignals(state.data,{multiplier:{fast:1.5,balanced:2.5,slow:3.5}[state.signalSensitivity]});const {ctx,w,h}=canvas('#chart'),style=getComputedStyle(document.body),muted=style.getPropertyValue('--muted'),grid=style.getPropertyValue('--line'),up=style.getPropertyValue('--green'),down=style.getPropertyValue('--red');
 const end=state.data.length-state.offset,start=Math.max(0,end-state.count),rows=state.data.slice(start,end),plot=w-68,top=30,bottom=h-72,lo=Math.min(...rows.map(c=>c.low)),hi=Math.max(...rows.map(c=>c.high)),pad=(hi-lo)*.15||1,min=lo-pad,max=hi+pad,x=i=>(i+.5)*plot/rows.length,y=v=>top+(max-v)/(max-min)*(bottom-top);
 geometry={start,end,rows,plot,min,max,top,bottom,x,y,w,h};ctx.font='10px ui-monospace,monospace';ctx.lineWidth=.7;
 for(let i=0;i<5;i++){const v=min+(max-min)*i/4,py=y(v);ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(plot,py);ctx.stroke();ctx.fillStyle=muted;ctx.fillText(fmt(v),plot+7,py+3)}
 for(let i=0;i<rows.length;i+=Math.max(1,Math.floor(rows.length/5))){ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(x(i),top);ctx.lineTo(x(i),h-20);ctx.stroke();ctx.fillStyle=muted;const date=new Date(rows[i].time*1000);ctx.fillText(state.tf==='1D'?date.toLocaleDateString('en-IN',{day:'2-digit',month:'short'}):date.toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}),Math.max(0,x(i)-17),h-7)}
 const line=(arr,color,dash=[])=>{ctx.save();ctx.beginPath();ctx.rect(0,top,plot,h-top-20);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.setLineDash(dash);ctx.beginPath();let begun=false;arr.slice(start,end).forEach((v,i)=>{if(v==null){begun=false;return}if(begun)ctx.lineTo(x(i),y(v));else{ctx.moveTo(x(i),y(v));begun=true}});ctx.stroke();ctx.restore()};
 if(state.overlays.has('Bollinger')){line(state.calc.bb.map(b=>b?.upper),colors.Bollinger);line(state.calc.bb.map(b=>b?.lower),colors.Bollinger);line(state.calc.bb.map(b=>b?.mid),colors.Bollinger,[3,4])}
 if(state.overlays.has('S/R'))for(const v of [lo,hi]){ctx.strokeStyle=muted;ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(0,y(v));ctx.lineTo(plot,y(v));ctx.stroke();ctx.setLineDash([])}
 drawPriceAction(ctx,{start,end,plot,top,bottom,x,y,up,down,muted});
 const maxVol=Math.max(...rows.map(c=>c.volume));rows.forEach((c,i)=>{ctx.strokeStyle=ctx.fillStyle=c.close>=c.open?up:down;const bw=Math.max(2,plot/rows.length*.6);ctx.beginPath();ctx.moveTo(x(i),y(c.high));ctx.lineTo(x(i),y(c.low));ctx.stroke();ctx.fillRect(x(i)-bw/2,y(Math.max(c.open,c.close)),bw,Math.max(1,Math.abs(y(c.open)-y(c.close))));if(state.overlays.has('Volume')){ctx.globalAlpha=.25;ctx.fillRect(x(i)-bw/2,h-23-c.volume/maxVol*35,bw,c.volume/maxVol*35);ctx.globalAlpha=1}});
 for(const [name,key] of [['EMA 9','e9'],['EMA 21','e21'],['EMA 50','e50'],['EMA 200','e200'],['SMA 50','s50'],['SMA 200','s200'],['VWAP','vwap']])if(state.overlays.has(name))line(state.calc[key],colors[name]);
 if(state.overlays.has('Stride Signals')){
  for(const direction of [1,-1])line(state.signals.map(s=>s?.direction===direction?s.stop:null),direction===1?up:down,[5,3]);
  ctx.save();ctx.beginPath();ctx.rect(0,top,plot,bottom-top);ctx.clip();ctx.font='bold 10px system-ui';
  state.signals.slice(start,end).forEach((s,i)=>{if(!s?.signal)return;const buy=s.signal==='Buy',label=buy?'BUY':'SELL',bw=36,px=Math.max(0,Math.min(plot-bw,x(i)-bw/2)),py=Math.max(top+3,Math.min(bottom-21,y(buy?rows[i].low:rows[i].high)+(buy?10:-27)));ctx.fillStyle=buy?up:down;ctx.fillRect(px,py,bw,18);ctx.fillStyle=style.getPropertyValue('--bg');ctx.fillText(label,px+6,py+13)});ctx.restore();
 }
 renderMomentum(ctx,{start,end,plot,top,bottom,x,y,up,down});
 renderScalper(ctx,{start,end,plot,top,bottom,x,y,up,down});
 renderSignalStatus();
 const last=rows.at(-1);ctx.fillStyle=last.close>=last.open?up:down;ctx.fillRect(plot,y(last.close)-10,68,20);ctx.fillStyle=style.getPropertyValue('--bg');ctx.fillText(fmt(last.close),plot+5,y(last.close)+4);
 const list=state.drawings[state.symbol+state.tf]||[];ctx.save();ctx.beginPath();ctx.rect(0,top,plot,bottom-top);ctx.clip();for(const d of list){const idx=state.data.findIndex(c=>c.time===d.a.time)-start,px=x(idx),py=y(d.a.price);ctx.strokeStyle=ctx.fillStyle=d.type==='exit'?down:up;ctx.lineWidth=1.5;if(d.type==='trend'){const ix=state.data.findIndex(c=>c.time===d.b.time)-start;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x(ix),y(d.b.price));ctx.stroke()}else if(d.type==='level'){ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(plot,py);ctx.stroke()}else{ctx.font='bold 12px system-ui';ctx.fillText(d.type==='entry'?'▲ ENTRY':'▼ EXIT',px,py)}}ctx.restore();
 const hover=state.hover==null?rows.length-1:Math.max(0,Math.min(rows.length-1,state.hover));const c=rows[hover];$('#ohlc').textContent=`O ${fmt(c.open)}  H ${fmt(c.high)}  L ${fmt(c.low)}  C ${fmt(c.close)}  V ${(c.volume/1000).toFixed(1)}K`;
 if(state.hover!=null){ctx.strokeStyle=muted;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(hover),top);ctx.lineTo(x(hover),h-20);ctx.stroke();ctx.setLineDash([])}
 drawPane('#rsi',[state.calc.rsi],['#a996ec'],start,end,0,100,[30,70]);const mm=[...state.calc.macd.slice(start,end),...state.calc.signal.slice(start,end),...state.calc.hist.slice(start,end)],ml=Math.min(...mm,0),mh=Math.max(...mm,0);drawPane('#macd',[state.calc.macd,state.calc.signal],['#7fa8f5','#e6ba6f'],start,end,ml-(mh-ml)*.1,mh+(mh-ml)*.1,[0],state.calc.hist);
 $('#rsi-value').textContent=state.calc.rsi.at(-1).toFixed(2);$('#macd-value').textContent=state.calc.macd.at(-1).toFixed(2);$('#levels').innerHTML=`<div><small>Resistance</small><strong class="down">${fmt(hi)}</strong></div><div><small>VWAP · session</small><strong>${fmt(state.calc.vwap.at(-1))}</strong></div><div><small>Support</small><strong class="up">${fmt(lo)}</strong></div>`;
}
function drawPane(id,series,colors,start,end,min,max,thresholds,hist){const {ctx,w,h}=canvas(id),plot=w-62,n=end-start,x=i=>(i+.5)*plot/n,y=v=>5+(max-v)/(max-min||1)*(h-15);ctx.font='9px monospace';ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted');for(const t of thresholds){ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--line');ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(0,y(t));ctx.lineTo(plot,y(t));ctx.stroke();ctx.fillText(t.toFixed(0),plot+10,y(t)+3)}ctx.setLineDash([]);if(hist)hist.slice(start,end).forEach((v,i)=>{ctx.fillStyle=v>=0?'#72e4bd66':'#f17c8666';ctx.fillRect(x(i)-plot/n*.3,Math.min(y(0),y(v)),plot/n*.6,Math.max(1,Math.abs(y(v)-y(0))))});series.forEach((arr,k)=>{ctx.strokeStyle=colors[k];ctx.lineWidth=1.2;ctx.beginPath();let began=false;arr.slice(start,end).forEach((v,i)=>{if(v==null)return;if(began)ctx.lineTo(x(i),y(v));else{ctx.moveTo(x(i),y(v));began=true}});ctx.stroke()})}
function summary(){const i=current(),c=change(i);$('#symbol-name').textContent=i.name;$('#instrument-kind').textContent=i.kind;$('#price').textContent=fmt(quote());$('#change').className=c>=0?'up':'down';$('#change').textContent=`${c>=0?'+':''}${fmt(quote()-i.base/(1+i.change/100))} (${c>=0?'+':''}${c.toFixed(2)}%)`;$('#signal-tf').textContent=state.tf;
 const calc=state.calc,r=calc.rsi.at(-1),e=calc.e9.at(-1)>calc.e21.at(-1)?1:-1,m=calc.hist.at(-1)>0?1:-1,rs=r>55?1:r<45?-1:0,score=e+m+rs,label=score>=2?'Buy':score<=-2?'Sell':'Neutral';$('#signal-label').textContent=label;$('#signal-label').style.color=label==='Sell'?'var(--red)':label==='Neutral'?'var(--gold)':'var(--green)';$('#signal-icon').textContent=label==='Buy'?'↗':label==='Sell'?'↘':'→';$('#signal-summary').textContent=`${Math.abs(score)} of 3 net directional signals`;$('#signal-reasons').innerHTML=`<div class="reason"><span>EMA 9 / 21 crossover</span><b>${e>0?'Bullish':'Bearish'}</b></div><div class="reason"><span>RSI (14)</span><b>${r.toFixed(1)} · ${rs>0?'Bullish':rs<0?'Bearish':'Neutral'}</b></div><div class="reason"><span>MACD momentum</span><b>${m>0?'Bullish':'Bearish'}</b></div>`;$$('.signal-meter i').forEach((el,j)=>{el.classList.toggle('lit',j<Math.abs(score)+1);el.style.background=j<Math.abs(score)+1?(score<0?'var(--red)':score===0?'var(--gold)':'var(--green)'):''});renderWatch()}
async function loadData(){const id=++request;unsubscribe?.();$('#updated').textContent='Loading demo candles…';try{const data=await market.history(state.symbol,state.tf);if(id!==request)return;const shift=state.quotes[state.symbol]-data.at(-1).close;state.data=data.map(c=>({...c,open:c.open+shift,high:c.high+shift,low:c.low+shift,close:c.close+shift}));state.offset=0;state.hover=null;draw();summary();signalTracker.baseline(state.signals);scalpTracker.baseline(state.scalps);momentumTracker.baseline(state.momentum);$('#updated').textContent='● Demo feed connected';unsubscribe=market.subscribe(state.symbol,state.tf,tick=>{const last=state.data.at(-1),bucket=Math.floor(tick.time/intervals[state.tf])*intervals[state.tf];if(bucket>last.time)state.data.push({time:bucket,open:last.close,high:last.close,low:last.close,close:last.close,volume:0});const c=state.data.at(-1);c.close=Math.max(.01,c.close+tick.delta);c.high=Math.max(c.high,c.close);c.low=Math.min(c.low,c.close);c.volume+=tick.volume;state.quotes[state.symbol]=c.close;if(state.data.length>500)state.data.shift();draw();summary();processSignalAlerts();processScalpAlerts();processMomentumAlerts();checkAlerts();$('#updated').textContent=(tick.live?'● Live quote connected ':'● Demo updated ')+new Date().toLocaleTimeString('en-IN',{hour12:false})},()=>toast('Feed interrupted. Select an instrument to reconnect.'))}catch(e){$('#updated').textContent='Data unavailable';toast(e.message)}}
$('#indicators').innerHTML=Object.entries(colors).map(([name,color])=>`<button class="${state.overlays.has(name)?'on':''}" data-indicator="${name}" style="--color:${color}" aria-pressed="${state.overlays.has(name)}">${name}</button>`).join('');
function checkAlerts(){}
loadData();new ResizeObserver(()=>draw()).observe($('.canvas-area'));
// UI actions are shared by pointer controls and the optional WebMCP interface.
function selectInstrument(symbol){if(!instruments.some(i=>i.id===symbol))throw Error('Unknown instrument');state.symbol=symbol;startPoint=null;return loadData()}
$('#watch-rows').addEventListener('click',e=>{const b=e.target.closest('[data-symbol]');if(b)selectInstrument(b.dataset.symbol)});
$$('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderWatch()});
$$('[data-tf]').forEach(b=>b.onclick=()=>{state.tf=b.dataset.tf;startPoint=null;$$('[data-tf]').forEach(x=>x.classList.toggle('active',x===b));loadData()});
$('#indicators').onclick=e=>{const b=e.target.closest('[data-indicator]');if(!b)return;const name=b.dataset.indicator;state.overlays.has(name)?state.overlays.delete(name):state.overlays.add(name);b.classList.toggle('on',state.overlays.has(name));b.setAttribute('aria-pressed',state.overlays.has(name));draw()};
$('#indicators-toggle').onclick=()=>$('#indicators').classList.toggle('hidden');
$('#theme').onclick=()=>{document.body.classList.toggle('light');save('stride-theme',document.body.classList.contains('light')?'light':'dark');draw()};
$('#reset-view').onclick=()=>{state.count=90;state.offset=0;state.hover=null;draw()};
$$('[data-tool]').forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;startPoint=null;$$('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));$('#chart-tip').textContent=state.tool==='cursor'?'Scroll to zoom · drag to pan':state.tool==='trend'?'Select the first point, then the second point':'Tap the chart to place '+state.tool});
function persistDrawings(){save('stride-drawings',state.drawings)}
$('#undo').onclick=()=>{(state.drawings[state.symbol+state.tf]||[]).pop();startPoint=null;persistDrawings();draw()};
const chart=$('#chart');function point(event){if(!geometry)return null;const rect=chart.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top,g=geometry;if(px<0||px>g.plot||py<g.top||py>g.bottom)return null;const idx=Math.max(0,Math.min(g.rows.length-1,Math.floor(px/g.plot*g.rows.length)));return {time:g.rows[idx].time,price:g.max-(py-g.top)/(g.bottom-g.top)*(g.max-g.min),index:idx}}
chart.addEventListener('pointerdown',e=>{chart.setPointerCapture(e.pointerId);const p=point(e);if(!p)return;if(state.tool==='cursor'){drag={x:e.clientX,offset:state.offset};return}const key=state.symbol+state.tf;state.drawings[key]??=[];if(state.tool==='trend'){if(!startPoint){startPoint=p;$('#chart-tip').textContent='Select the second point';return}state.drawings[key].push({type:'trend',a:startPoint,b:p});startPoint=null;$('#chart-tip').textContent='Trend line saved · select two more points'}else state.drawings[key].push({type:state.tool,a:p});persistDrawings();draw()});
chart.addEventListener('pointermove',e=>{const p=point(e);state.hover=p?.index??null;if(drag){state.offset=Math.max(0,Math.min(state.data.length-state.count,drag.offset+Math.round((e.clientX-drag.x)/geometry.plot*state.count)))}draw()});
chart.addEventListener('pointerup',()=>drag=null);chart.addEventListener('pointercancel',()=>drag=null);chart.addEventListener('pointerleave',()=>{if(!drag){state.hover=null;draw()}});
chart.addEventListener('wheel',e=>{e.preventDefault();state.count=Math.max(25,Math.min(state.data.length, state.count+Math.sign(e.deltaY)*10));state.offset=Math.min(state.offset,state.data.length-state.count);draw()},{passive:false});
// Zoom controls also work on touch screens and with a keyboard.
const zoom=document.createElement('div');zoom.className='zoom-controls';zoom.innerHTML='<button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button>';$('.canvas-area').append(zoom);zoom.children[0].onclick=()=>{state.count=Math.max(25,state.count-15);draw()};zoom.children[1].onclick=()=>{state.count=Math.min(state.data.length,state.count+15);state.offset=Math.min(state.offset,state.data.length-state.count);draw()};
function openAlert(){if(!state.data.length)return;$('#alert-symbol').textContent=current().name+' · Demo price '+fmt(quote());$('#alert-price').value=(quote()*1.001).toFixed(2);$('#alert-dialog').showModal()}
$('#add-alert').onclick=$('#new-alert').onclick=openAlert;$('#close-dialog').onclick=()=>$('#alert-dialog').close();
function renderAlerts(){const active=state.alerts.filter(a=>!a.triggered).length;$('#alert-count').textContent=active;$('#alert-total').textContent=state.alerts.length;$('#alert-list').innerHTML=state.alerts.length?state.alerts.map(a=>`<div class="alert-row"><span>${instruments.find(i=>i.id===a.symbol)?.name??'Instrument'} ${a.direction==='above'?'≥':'≤'} ₹${fmt(a.price)}<br><small class="${a.triggered?'up':'muted'}">${a.triggered?'Triggered · '+new Date(a.triggered).toLocaleTimeString('en-IN'):'Active · monitoring demo feed'}</small></span><button data-delete-alert="${a.id}" aria-label="Delete alert">✕</button></div>`).join(''):'No alerts yet. Set a price to keep an eye on.';save('stride-alerts',state.alerts)}
function createAlert(symbol,direction,price){if(!instruments.some(i=>i.id===symbol)||!['above','below'].includes(direction)||!Number.isFinite(price)||price<=0)throw Error('Enter a valid instrument, direction and positive price');const a={id:crypto.randomUUID(),symbol,direction,price,triggered:null};state.alerts.push(a);renderAlerts();return a}
$('#alert-form').onsubmit=e=>{e.preventDefault();try{createAlert(state.symbol,$('#alert-direction').value,Number($('#alert-price').value));$('#alert-dialog').close();toast('Price alert created on this device');checkAlerts()}catch(error){toast(error.message)}};
$('#alert-list').onclick=e=>{const b=e.target.closest('[data-delete-alert]');if(b){state.alerts=state.alerts.filter(a=>a.id!==b.dataset.deleteAlert);renderAlerts()}};
checkAlerts=()=>{let changed=false;for(const a of state.alerts){if(a.triggered)continue;const price=state.quotes[a.symbol];if(a.direction==='above'?price>=a.price:price<=a.price){a.triggered=Date.now();changed=true;toast(instruments.find(i=>i.id===a.symbol).name+' crossed '+fmt(a.price)+' · demo alert')}}if(changed)renderAlerts()};renderAlerts();
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null}else toast(matchMedia('(display-mode: standalone)').matches?'Stride is already running as an app.':'Open in Chrome on Android: menu → Install app. On iPhone: Share → Add to Home Screen.')};
if('serviceWorker' in navigator&&!window.Capacitor?.isNativePlatform())navigator.serviceWorker.register('./sw.js').catch(()=>toast('Offline mode is unavailable in this browser.'));
const context=document.modelContext;if(context?.registerTool){try{Promise.resolve(context.registerTool({name:'select_instrument',description:'Select a demo instrument in the trading workspace.',inputSchema:{type:'object',properties:{symbol:{type:'string',enum:instruments.map(i=>i.id)}},required:['symbol'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async({symbol})=>{await selectInstrument(symbol);return {symbol:state.symbol,price:quote(),mode:'demo'}}})).catch(()=>{})}catch{}}

// Keep watchlist quotes and alerts running even when another chart is selected.
const watchSubscriptions=instruments.map(i=>market.subscribe(i.id,'1m',tick=>{if(i.id===state.symbol)return;state.quotes[i.id]=Math.max(.01,state.quotes[i.id]+tick.delta);renderWatch();checkAlerts()},()=>{}));
window.addEventListener('pagehide',()=>{unsubscribe?.();watchSubscriptions.forEach(stop=>stop())});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});

// TradingView is an optional live market preview. It is deliberately separate from the demo feed.



function renderSignalStatus(){
 const enabled=state.overlays.has('Stride Signals'),last=state.signals.filter(Boolean).at(-1),event=state.signals.filter(s=>s?.signal).at(-1);
 $('#stride-status').textContent=!enabled?'Indicator hidden':!last?'Warming up':last.direction===1?'Bullish trend':'Bearish trend';
 $('#stride-status').className=!enabled?'muted':last?.direction===1?'up':'down';
 $('#stride-stop').textContent=enabled&&last?'ATR trail ₹'+fmt(last.stop):'—';
 $('#stride-last').textContent=event?'Last '+event.signal.toLowerCase()+' · '+new Date(event.time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST':'No reversal in loaded history';
 $('#stride-settings').dataset.enabled=String(enabled);renderSignalAlerts();
}
$('#signal-sensitivity').value=state.signalSensitivity;
$('#signal-sensitivity').onchange=e=>{state.signalSensitivity=e.target.value;save('stride-sensitivity',state.signalSensitivity);draw();signalTracker.baseline(state.signals)};

function drawPriceAction(ctx,g){
 const {start,end,plot,top,bottom,x,y,up,down,muted}=g,pa=state.pa;
 ctx.save();ctx.beginPath();ctx.rect(0,top,plot,bottom-top);ctx.clip();ctx.font='10px system-ui';
 for(const kind of ['OB','FVG']){
  const enabled=state.paOverlays.has(kind==='OB'?'Order blocks':'Fair-value gaps');if(!enabled)continue;
  const visible=pa.zones.filter(z=>z.kind===kind&&z.endedAt==null&&z.index<end).slice(-4);
  for(const z of visible){const left=Math.max(0,x(z.index-start)),width=plot-left;if(width<=0)continue;const color=z.direction===1?up:down;ctx.fillStyle=color;ctx.globalAlpha=kind==='OB'?.10:.05;ctx.fillRect(left,y(z.high),width,Math.max(1,y(z.low)-y(z.high)));ctx.globalAlpha=.7;ctx.strokeStyle=color;ctx.setLineDash(kind==='FVG'?[2,4]:[]);ctx.strokeRect(left,y(z.high),width,Math.max(1,y(z.low)-y(z.high)));ctx.globalAlpha=1;ctx.setLineDash([]);ctx.fillText(kind+(z.direction===1?' +':' −'),Math.max(left+4,plot-47),Math.max(top+12,Math.min(bottom-3,y(z.high)+12)))}
 }
 if(state.paOverlays.has('Structure'))for(const b of pa.breaks.filter(b=>b.index>=start&&b.index<end)){ctx.strokeStyle=ctx.fillStyle=b.direction===1?up:down;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(Math.max(0,x(b.from-start)),y(b.price));ctx.lineTo(x(b.index-start),y(b.price));ctx.stroke();ctx.setLineDash([]);ctx.fillText(b.type,Math.max(0,Math.min(plot-43,x(b.index-start)-20)),y(b.price)-5)}
 if(state.paOverlays.has('Swings'))for(const p of pa.pivots.filter(p=>p.confirmedAt>=start&&p.confirmedAt<end)){ctx.fillStyle=muted;ctx.fillText(p.type,Math.max(0,Math.min(plot-25,x(p.confirmedAt-start)-8)),y(p.price)+(p.type.endsWith('H')?-10:14))}
 ctx.restore();
 const active=pa.zones.filter(z=>z.endedAt==null),last=pa.breaks.at(-1);
 $('#pa-summary').textContent=(pa.trend===1?'Bullish structure':pa.trend===-1?'Bearish structure':'Structure forming')+' · '+active.filter(z=>z.kind==='OB').length+' active OB · '+active.filter(z=>z.kind==='FVG').length+' open FVG';
 $('#pa-last').textContent=last?'Last confirmed '+last.type+' · '+new Date(state.data[last.index].time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST':'No confirmed structure break';
}
$('#pa-toggles').innerHTML=paNames.map(name=>`<button data-pa="${name}" aria-pressed="${state.paOverlays.has(name)}" class="${state.paOverlays.has(name)?'active':''}">${name}</button>`).join('');
$('#pa-toggles').onclick=e=>{const b=e.target.closest('[data-pa]');if(!b)return;const name=b.dataset.pa;state.paOverlays.has(name)?state.paOverlays.delete(name):state.paOverlays.add(name);b.classList.toggle('active',state.paOverlays.has(name));b.setAttribute('aria-pressed',state.paOverlays.has(name));save('stride-pa',[...state.paOverlays]);draw()};

function renderSignalAlerts(){
 $('#signal-alert-switch').checked=signalAlertsEnabled;
 $('#signal-alert-status').textContent=signalAlertsEnabled?'On · '+current().name+' · '+state.tf+' · '+state.signalSensitivity:'Off';
 const list=$('#signal-alert-history');list.replaceChildren();
 if(!Array.isArray(signalHistory)||!signalHistory.length){list.textContent='No new signal alerts yet.';return}
 for(const a of signalHistory.slice(0,20)){
  const row=document.createElement('div');row.className='alert-row';
  const text=document.createElement('span');text.textContent=(a.source||'Stride Signals')+' · '+a.side.toUpperCase()+' · '+a.name+' · '+a.tf+' · ₹'+fmt(a.price);text.className=a.side==='Buy'?'up':'down';
  const time=document.createElement('small');time.textContent=new Date(a.time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST';row.append(text,time);list.append(row);
 }
}
function processSignalAlerts(){
 const fresh=signalTracker.collect(state.signals,signalAlertsEnabled);
 for(const event of fresh){const c=state.data.find(c=>c.time===event.time);const alert={side:event.signal,name:current().name,tf:state.tf,time:event.time,price:c.close};signalHistory.unshift(alert);signalHistory.splice(20);save('stride-signal-history',signalHistory);toast(alert.side.toUpperCase()+' signal · '+alert.name+' · '+alert.tf+' · ₹'+fmt(alert.price)+' · demo');}
 renderSignalAlerts();
}
$('#signal-alert-switch').onchange=e=>{signalAlertsEnabled=e.target.checked;save('stride-signal-alerts-enabled',signalAlertsEnabled);signalTracker.baseline(state.signals||[]);renderSignalAlerts()};
$$('[data-test-signal]').forEach(b=>b.onclick=()=>toast('TEST '+b.dataset.testSignal+' signal · '+current().name+' · '+state.tf+' · sample notification only'));
renderSignalAlerts();

function renderScalper(ctx,g){
 const supported=['1m','5m'].includes(state.tf),enabled=scalpEnabled&&supported,last=state.scalps.filter(Boolean).at(-1),setup=state.scalps.filter(s=>s?.signal).at(-1);
 $('#scalp-enable').checked=scalpEnabled;$('#scalp-alerts').checked=scalpAlerts;
 $('#scalp-state').textContent=!scalpEnabled?'Mode off':!supported?'Paused · choose 1m or 5m':!last?'Warming up':last.direction===1?'BUY conditions aligned':last.direction===-1?'SELL conditions aligned':'WAIT · mixed conditions';
 $('#scalp-state').className=enabled&&last?.direction===1?'up':enabled&&last?.direction===-1?'down':'muted';
 $('#scalp-confirmations').textContent=enabled&&last?'EMA 9/21: '+(last.ema>0?'bullish':last.ema<0?'bearish':'flat')+' · VWAP: '+(last.vwap>0?'above':last.vwap<0?'below':'at')+' · RSI 14: '+last.rsi.toFixed(1):'Uses EMA 9/21, session VWAP and RSI 14';
 $('#scalp-setup').textContent=enabled&&setup?'Latest '+setup.signal.toUpperCase()+' setup · '+new Date(setup.time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST · historical levels':'No setup displayed';
 for(const key of ['entry','stop','target'])$('#scalp-'+key).textContent=enabled&&setup?fmt(setup[key]):'—';
 if(!enabled)return;
 const {start,end,plot,top,bottom,x,y,up,down}=g;ctx.save();ctx.beginPath();ctx.rect(0,top,plot,bottom-top);ctx.clip();ctx.font='bold 10px system-ui';
 state.scalps.slice(start,end).forEach((s,i)=>{if(!s?.signal)return;ctx.fillStyle=s.signal==='Buy'?up:down;ctx.fillText('SC '+s.signal.toUpperCase(),Math.max(0,Math.min(plot-48,x(i)-22)),Math.max(top+12,Math.min(bottom-5,y(s.entry)+(s.signal==='Buy'?25:-30))))});ctx.restore();
}
function processScalpAlerts(){
 const fresh=scalpTracker.collect(state.scalps,scalpEnabled&&scalpAlerts&&['1m','5m'].includes(state.tf));
 for(const event of fresh){const alert={source:'Pro Scalper',side:event.signal,name:current().name,tf:state.tf,time:event.time,price:event.entry};signalHistory.unshift(alert);signalHistory.splice(20);save('stride-signal-history',signalHistory);toast('Pro Scalper '+event.signal.toUpperCase()+' · '+current().name+' · '+state.tf+' · demo');}renderSignalAlerts();
}
$('#scalp-enable').onchange=e=>{scalpEnabled=e.target.checked;save('stride-scalper',scalpEnabled);scalpTracker.baseline(state.scalps);momentumTracker.baseline(state.momentum);draw()};
$('#scalp-alerts').onchange=e=>{scalpAlerts=e.target.checked;save('stride-scalper-alerts',scalpAlerts);scalpTracker.baseline(state.scalps)};
$$('[data-scalp-tf]').forEach(b=>b.onclick=()=>document.querySelector('[data-tf="'+b.dataset.scalpTf+'"]').click());

if(window.Capacitor?.isNativePlatform()){document.body.classList.add('native-app');$('#install').hidden=true;}

function renderMomentum(ctx,g){
 const last=state.momentum.filter(s=>s?.signal).at(-1);$('#momentum-alerts').checked=momentumAlerts;
 $('#momentum-status').textContent=last?'Last '+last.signal.toUpperCase()+' · '+new Date(last.time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST':'No confirmed momentum crossing';
 if(!state.overlays.has('Momentum'))return;
 const {start,end,plot,top,bottom,x,y,up,down}=g;ctx.save();ctx.beginPath();ctx.rect(0,top,plot,bottom-top);ctx.clip();ctx.font='bold 10px system-ui';state.momentum.slice(start,end).forEach((s,i)=>{if(!s?.signal)return;ctx.fillStyle=s.signal==='Buy'?up:down;ctx.fillText('M '+s.signal.toUpperCase(),Math.max(0,Math.min(plot-48,x(i)-22)),Math.max(top+12,Math.min(bottom-5,y(s.price)+(s.signal==='Buy'?40:-45))))});ctx.restore();
}
function processMomentumAlerts(){for(const event of momentumTracker.collect(state.momentum,momentumAlerts)){signalHistory.unshift({source:'Stride Momentum',side:event.signal,name:current().name,tf:state.tf,time:event.time,price:event.price});signalHistory.splice(20);save('stride-signal-history',signalHistory);toast('Momentum '+event.signal.toUpperCase()+' · '+current().name+' · '+state.tf+' · demo');}renderSignalAlerts()}
$('#momentum-alerts').onchange=e=>{momentumAlerts=e.target.checked;save('stride-momentum-alerts',momentumAlerts);momentumTracker.baseline(state.momentum)};

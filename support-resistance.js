// Confirmed support/resistance from real closed candles only; no trade signals.
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export function supportResistance(data,{seconds=300,now=Date.now()/1000,lookback=200}={}){
 if(!Array.isArray(data)||!finite(seconds)||seconds<=0||!finite(now))return {support:null,resistance:null};
 const c=data.filter(b=>finite(b?.time)&&Number(b.time)+seconds<=now).slice(-lookback);
 if(c.length<7||c.some((b,i)=>!['high','low','close'].every(k=>finite(b[k]))||Number(b.high)<Number(b.low)||Number(b.close)>Number(b.high)||Number(b.close)<Number(b.low)||(i&&Number(b.time)<=Number(c[i-1].time))))return {support:null,resistance:null};
 const price=Number(c.at(-1).close),supports=[],resistances=[];
 for(let i=2;i<c.length-2;i++){const w=c.slice(i-2,i+3),h=Number(c[i].high),l=Number(c[i].low);
 if(w.every(b=>h>=Number(b.high))&&w.some(b=>h>Number(b.high)))resistances.push({price:h,time:Number(c[i].time),confirmedAt:Number(c[i+2].time),source:'Confirmed swing high'});
 if(w.every(b=>l<=Number(b.low))&&w.some(b=>l<Number(b.low)))supports.push({price:l,time:Number(c[i].time),confirmedAt:Number(c[i+2].time),source:'Confirmed swing low'});
 }
 // Recent range boundaries remain explicitly labelled when swings are unavailable.
 const recent=c.slice(-20);const low=Math.min(...recent.map(b=>Number(b.low))),high=Math.max(...recent.map(b=>Number(b.high)));
 if(!supports.some(b=>b.price<price)&&low<price)supports.push({price:low,source:'Closed 20-bar range low'});
 if(!resistances.some(b=>b.price>price)&&high>price)resistances.push({price:high,source:'Closed 20-bar range high'});
 return {support:supports.filter(x=>x.price<price).sort((a,b)=>b.price-a.price)[0]??null,resistance:resistances.filter(x=>x.price>price).sort((a,b)=>a.price-b.price)[0]??null,time:Number(c.at(-1).time)};
}
export function drawSupportResistance(ctx,levels,{y,plot,top,bottom}){
 ctx.save();ctx.font='bold 11px sans-serif';ctx.lineWidth=1.5;
 for(const [key,color,label] of [['support','#20c997','Support'],['resistance','#f15b6c','Resistance']]){
 const row=levels[key];if(!row||!finite(row.price))continue;const py=y(row.price);if(!Number.isFinite(py)||py<top||py>bottom)continue;
 ctx.strokeStyle=color;ctx.setLineDash([7,4]);ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(plot,py);ctx.stroke();ctx.setLineDash([]);
 const text=label+' '+row.price.toFixed(2),width=ctx.measureText(text).width+12;ctx.fillStyle='#141b29';ctx.fillRect(5,Math.max(top,py-19),width,17);ctx.fillStyle=color;ctx.fillText(text,11,Math.max(top+12,py-6));
 }ctx.restore();
}

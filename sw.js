const CACHE='stride-v49';
const ASSETS=[
  './',
  './index.html',
  './style.css',
  './app.js',
  './trend-indicators.js',
  './market.js',
  './price-action.js',
  './signal-alerts.js',
  './pro-scalper.js',
  './momentum.js',
  './pro-suite.js',
  './smrt-nifty-edge.js',
  './smrt-market-map.js',
  './smrt-candle-scanner.js',
  './smrt-trade-finalizer.js',
  './smrt-gainz-ssl-combo.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(k=>k.startsWith('stride-')&&k!==CACHE)
          .map(k=>caches.delete(k))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);

  if(event.request.method!=='GET') return;
  if(url.origin!==self.location.origin) return;

  if(url.pathname.startsWith('/api/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }

  const isFreshAsset=
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html') ||
    url.pathname==='/' ;

  if(isFreshAsset){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE).then(c=>c.put(event.request,copy));
          }
          return response;
        })
        .catch(()=>caches.match(event.request))
    );
    return;
  }

  if(!ASSETS.some(p=>new URL(p,self.registration.scope).pathname===url.pathname)) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached=>cached||fetch(event.request))
  );
});

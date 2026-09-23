import { momentumSignals } from './momentum.js';
import { trendIndicators } from './trend-indicators.js';
import { proScalper } from './pro-scalper.js';
import { SignalAlertTracker } from './signal-alerts.js';
import { priceAction } from './price-action.js';
import {
  analyseNiftyEdge
} from './smrt-nifty-edge.js';
import { analyseMarketMap } from './smrt-market-map.js';
import {
  scanCandles,
  candleConfluence
} from './smrt-candle-scanner.js';
import { finalizeTrade } from './smrt-trade-finalizer.js';
import { analyseGainzSSL } from './smrt-gainz-ssl-combo.js';
import {
  analyseProSuite
} from './pro-suite.js';

import {
  API_BASE,
  instruments,
  intervals,
  indicators,
  market,
  strideSignals
} from './market.js';


const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


const fmt = n => {
  const value = Number(n);

  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};


const read = (key, fallback) => {
  try {
    return JSON.parse(
      localStorage.getItem(key)
    ) ?? fallback;
  } catch {
    return fallback;
  }
};


const save = (key, value) => {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  } catch {}
};


const paNames = [
  'Structure',
  'Swings',
  'Order blocks',
  'Fair-value gaps'
];


const savedPA = read(
  'stride-pa',
  [
    'Structure',
    'Order blocks',
    'Fair-value gaps'
  ]
);


const state = {

  paOverlays: new Set(
    Array.isArray(savedPA)
      ? savedPA.filter(
          x => paNames.includes(x)
        )
      : paNames
  ),

  quotes: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  sessionOpen: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  officialChange: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  previousClose: Object.fromEntries(
    instruments.map(
      i => [i.id, null]
    )
  ),

  symbol: 'NIFTY',

  tf: '5m',

  data: [],

  calc: null,

  trend: null,

  niftyEdge: null,

  niftyEdgeBacktest: null,

  marketMap: null,

  candleScanner: null,

  candleSetup: null,

  tradeFinalizer: null,

  gainzSSL: null,

  proSuite: null,

  proBacktest: null,

  smartSignal: null,

  smartPlan: null,

  smartStructure: null,

  smartMarketState: 'WAIT',

  futuresVWAP: null,

  futuresVWAPUpdated: 0,

  feedStatus: 'LOADING',

  lastUpdate: null,

  signalSensitivity:
    ['fast', 'balanced', 'slow'].includes(
      read(
        'stride-sensitivity',
        'balanced'
      )
    )
      ? read(
          'stride-sensitivity',
          'balanced'
        )
      : 'balanced',

  filter: 'all',

  count: 180,

  offset: 0,

  tool: 'cursor',

  drawings:
    read(
      'stride-drawings',
      {}
    ),

  alerts:
    read(
      'stride-alerts',
      []
    ),

  overlays: new Set([
    'Momentum',
    'Stride Signals',
    'Supertrend (10, 3)',
    'ADX/DMI (14)',
    'EMA 9',
    'EMA 21',
    'EMA 50',
    'EMA 200',
    'SMA 50',
    'SMA 200',
    'Bollinger',
    'VWAP',
    'Volume',
    'S/R'
  ]),

  hover: null,

  replay: {
    active: false,
    playing: false,
    source: [],
    index: 0,
    timer: null,
    speed: 700
  },

  mtf: {
    loading: false,
    updated: 0,
    '5m': null,
    '15m': null,
    '1h': null,
    overall: 'NO TRADE'
  }
};


const colors = {
  'Momentum': '#58c8dc',
  'Stride Signals': '#72e4bd',
  'Supertrend (10, 3)': '#56d6a0',
  'ADX/DMI (14)': '#c5a0ed',
  'EMA 9': '#e6ba6f',
  'EMA 21': '#7fa8f5',
  'EMA 50': '#c098e8',
  'EMA 200': '#f2946e',
  'SMA 50': '#58c8dc',
  'SMA 200': '#d7cc77',
  'Bollinger': '#879fac',
  'VWAP': '#ed90b2',
  'Volume': '#72e4bd',
  'S/R': '#9aa8ad'
};


const momentumTracker =
  new SignalAlertTracker();

const signalTracker =
  new SignalAlertTracker();

const scalpTracker =
  new SignalAlertTracker();


let momentumAlerts =
  read(
    'stride-momentum-alerts',
    false
  ) === true;


let scalpEnabled =
  read(
    'stride-scalper',
    true
  ) === true;


let scalpAlerts =
  read(
    'stride-scalper-alerts',
    false
  ) === true;


let signalAlertsEnabled =
  read(
    'stride-signal-alerts-enabled',
    false
  ) === true;


const signalHistory =
  read(
    'stride-signal-history',
    []
  );


let unsubscribe;

let request = 0;

let reconnectTimer = null;
let reconnectAttempts = 0;

let geometry;

let drag;

let startPoint;

let installPrompt;


if (
  read(
    'stride-theme',
    'dark'
  ) === 'light'
) {
  document.body.classList.add(
    'light'
  );
}


/* ======================================================
   BASIC HELPERS
====================================================== */


function toast(message) {

  const el = $('#toast');

  if (!el) return;

  el.textContent = message;

  el.style.display = 'block';

  clearTimeout(
    toast.timer
  );

  toast.timer =
    setTimeout(
      () => {
        el.style.display =
          'none';
      },
      4000
    );
}


function current() {

  return instruments.find(
    i => i.id === state.symbol
  );
}


function quote() {

  const live =
    state.quotes[
      state.symbol
    ];

  if (
    Number.isFinite(live)
  ) {
    return live;
  }

  const last =
    state.data.at(-1)?.close;

  return Number.isFinite(last)
    ? last
    : null;
}


function change(i) {

  const official =
    state.officialChange[
      i.id
    ];

  if (
    Number.isFinite(
      official
    )
  ) {
    return official;
  }

  const price =
    i.id === state.symbol
      ? quote()
      : state.quotes[i.id];

  const open =
    state.sessionOpen[i.id];

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(open) ||
    open <= 0
  ) {
    return null;
  }

  return (
    (
      price / open
    ) - 1
  ) * 100;
}


function formatChange(value) {

  if (
    !Number.isFinite(value)
  ) {
    return '—';
  }

  return (
    value >= 0
      ? '+'
      : ''
  ) +
  value.toFixed(2) +
  '%';
}


function formatISTTime(
  timestamp = Date.now()
) {

  return new Date(
    timestamp
  ).toLocaleTimeString(
    'en-IN',
    {
      timeZone:
        'Asia/Kolkata',

      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',

      hour12:
        false
    }
  );
}


function formatTradingDate(
  unixSeconds
) {

  if (
    !Number.isFinite(
      Number(unixSeconds)
    )
  ) {
    return '—';
  }

  return new Date(
    Number(unixSeconds) *
    1000
  ).toLocaleDateString(
    'en-IN',
    {
      timeZone:
        'Asia/Kolkata',

      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric'
    }
  );
}


function updateTradingDate() {

  const el =
    $('#trading-date');

  if (!el) return;

  /*
    History includes the previous trading session plus
    the current session. Display the date of the latest
    actual Upstox candle.
  */

  const latestCandle =
    state.data.at(-1);

  el.textContent =
    latestCandle?.time
      ? formatTradingDate(
          latestCandle.time
        )
      : '—';
}


async function refreshFuturesVWAP() {

  if (
    state.symbol !== 'NIFTY'
  ) {
    state.futuresVWAP = null;
    state.futuresVWAPUpdated = 0;
    return;
  }

  const minutes = {
    '1m': 1,
    '3m': 3,
    '5m': 5,
    '15m': 15
  }[state.tf] || 1;

  try {

    const response =
      await fetch(
        API_BASE + '/api/nifty-futures-vwap?interval=' +
        encodeURIComponent(minutes),
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'Futures VWAP request failed'
      );
    }

    const data =
      await response.json();

    const value =
      Number(data?.vwap);

    state.futuresVWAP =
      data?.live === true &&
      Number.isFinite(value)
        ? value
        : null;

    state.futuresVWAPUpdated =
      state.futuresVWAP === null
        ? 0
        : Date.now();

  } catch (error) {

    console.warn(
      'NIFTY futures VWAP unavailable:',
      error
    );

    state.futuresVWAP = null;
    state.futuresVWAPUpdated = 0;
  }
}


function setFeedStatus(
  status,
  message = ''
) {

  state.feedStatus =
    status;

  const el =
    $('#updated');

  if (!el) return;


  if (
    status === 'LIVE'
  ) {

    el.textContent =
      '● LIVE · UPSTOX · ' +
      formatISTTime() +
      ' IST';

    return;
  }


  if (
    status === 'STALE'
  ) {

    el.textContent =
      '● STALE · ' +
      (
        message ||
        'Waiting for update'
      );

    return;
  }


  if (
    status === 'RECONNECTING'
  ) {

    el.textContent =
      '● RECONNECTING · UPSTOX';

    return;
  }


  if (
    status ===
    'DATA UNAVAILABLE'
  ) {

    el.textContent =
      '● DATA UNAVAILABLE' +
      (
        message
          ? ' · ' + message
          : ''
      );

    return;
  }


  el.textContent =
    message || status;
}


/* ======================================================
   WATCHLIST
====================================================== */


function renderWatch() {

  const list =
    instruments.filter(
      i => {

        if (
          state.filter === 'all'
        ) {
          return true;
        }

        return [
          'FUTURE',
          'CALL',
          'PUT'
        ].includes(
          i.kind
        );
      }
    );


  const watchRows =
    $('#watch-rows');


  if (watchRows) {

    watchRows.innerHTML =
      list.map(
        i => {

          const price =
            i.id === state.symbol
              ? quote()
              : state.quotes[i.id];


          const ch =
            change(i);


          return `
            <button
              class="watch-row ${
                i.id === state.symbol
                  ? 'selected'
                  : ''
              }"
              data-symbol="${i.id}"
            >

              <span>

                <strong>
                  ${i.name}
                </strong>

                <small>
                  ${
                    i.description ||
                    'Upstox live market data'
                  }
                </small>

              </span>


              <span class="watch-price">

                <strong>
                  ${fmt(price)}
                </strong>

                <span class="${
                  Number.isFinite(ch)
                    ? ch >= 0
                      ? 'up'
                      : 'down'
                    : 'muted'
                }">
                  ${formatChange(ch)}
                </span>

              </span>

            </button>
          `;
        }
      ).join('');
  }


  const ticker =
    $('#ticker');


  if (ticker) {

    ticker.innerHTML =
      instruments.map(
        i => {

          const price =
            i.id === state.symbol
              ? quote()
              : state.quotes[i.id];


          const ch =
            change(i);


          return `
            <div class="ticker-item">

              <span>
                ${i.name}
              </span>

              <b>
                ${fmt(price)}
              </b>

              <span class="${
                Number.isFinite(ch)
                  ? ch >= 0
                    ? 'up'
                    : 'down'
                  : 'muted'
              }">
                ${formatChange(ch)}
              </span>

            </div>
          `;
        }
      ).join('');
  }
}


/* ======================================================
   STRIDE PRO TRADING SUITE
====================================================== */

function refreshProSuite() {

  if (
    !Array.isArray(
      state.data
    ) ||
    !state.data.length
  ) {

    state.proSuite =
      null;

    state.proBacktest =
      null;

    state.smartSignal =
      null;

    state.smartPlan =
      null;

    state.smartStructure =
      null;

    state.smartMarketState =
      'WAIT';

    return;
  }


  const result =
    analyseProSuite(
      state.data,
      {
        strideSignals:
          Array.isArray(
            state.signals
          )
            ? state.signals
            : []
      }
    );


  state.proSuite =
    result;


  const latest =
    result?.latest;


  state.smartSignal =
    latest?.smart ??
    null;


  state.smartPlan =
    latest?.plan ??
    null;


  state.smartStructure =
    latest?.structure ??
    null;


  state.smartMarketState =
    latest?.smart
      ?.marketState ??
    'WAIT';


  state.proBacktest =
    null;
}


function renderProSuiteSummary() {

  const edgeLatest =
    state.niftyEdge
      ?.latest;

  const edgeActionable =
    [
      'BUY+',
      'SELL+',
      'BUY',
      'SELL'
    ].includes(
      edgeLatest
        ?.signal
    )
      ? edgeLatest
      : null;

  const smart =
    edgeLatest
      ? {
          signal:
            edgeLatest.signal,
          strength:
            edgeLatest.strength,
          confluence:
            edgeLatest.score,
          marketState:
            edgeLatest.structure
        }
      : state.smartSignal;

  const plan =
    edgeActionable
      ?.plan ??
    state.smartPlan;

  const structure =
    edgeLatest
      ? {
          event:
            edgeLatest.structure
        }
      : state.smartStructure;

  const backtest =
    state.niftyEdgeBacktest ??
    state.proBacktest;


  const setText =
    (
      selector,
      value
    ) => {

      const el =
        $(selector);

      if (el) {
        el.textContent =
          value;
      }
    };


  setText(
    '#smart-signal',
    smart?.signal ??
    'WAIT'
  );


  setText(
    '#smart-strength',
    smart?.strength
      ? 'Strength: ' +
        smart.strength
      : 'Strength: —'
  );


  setText(
    '#smart-confluence',
    Number.isFinite(
      Number(
        smart?.confluence
      )
    )
      ? 'Confluence: ' +
        smart.confluence
      : 'Confluence: —'
  );


  setText(
    '#smart-market-state',
    'Market: ' +
    (
      smart?.marketState ??
      state.smartMarketState ??
      'WAIT'
    )
  );


  setText(
    '#smart-structure',
    'Structure: ' +
    (
      structure?.event ??
      structure?.structure ??
      '—'
    )
  );


  setText(
    '#smart-entry',
    plan
      ? 'Entry: ₹' +
        fmt(
          plan.entry
        )
      : 'Entry: —'
  );


  setText(
    '#smart-stop',
    plan
      ? 'Stop: ₹' +
        fmt(
          plan.stop
        )
      : 'Stop: —'
  );


  setText(
    '#smart-target1',
    plan
      ? 'Target 1: ₹' +
        fmt(
          plan.target1
        )
      : 'Target 1: —'
  );


  setText(
    '#smart-target2',
    plan
      ? 'Target 2: ₹' +
        fmt(
          plan.target2
        )
      : 'Target 2: —'
  );


  setText(
    '#smart-rr',
    plan
      ? 'R:R T1 ' +
        Number(
          plan.rr1
        ).toFixed(
          2
        ) +
        ' · T2 ' +
        Number(
          plan.rr2
        ).toFixed(
          2
        )
      : 'R:R: —'
  );


  setText(
    '#backtest-trades',
    'Trades: ' +
    (
      backtest
        ?.totalTrades ??
      0
    )
  );


  setText(
    '#backtest-wins',
    'Wins: ' +
    (
      backtest
        ?.wins ??
      0
    )
  );


  setText(
    '#backtest-losses',
    'Losses: ' +
    (
      backtest
        ?.losses ??
      0
    )
  );


  setText(
    '#backtest-win-rate',
    'Win rate: ' +
    (
      Number.isFinite(
        Number(
          backtest
            ?.winRate
        )
      )
        ? Number(
            backtest
              .winRate
          ).toFixed(
            1
          ) +
          '%'
        : '0.0%'
    )
  );


  setText(
    '#backtest-net-points',
    'Net points: ' +
    (
      Number.isFinite(
        Number(
          backtest
            ?.netPoints
        )
      )
        ? Number(
            backtest
              .netPoints
          ).toFixed(
            2
          )
        : '0.00'
    )
  );


  setText(
    '#backtest-average-rr',
    'Avg R:R: ' +
    (
      Number.isFinite(
        Number(
          backtest
            ?.averageRR
        )
      )
        ? Number(
            backtest
              .averageRR
          ).toFixed(
            2
          )
        : '0.00'
    )
  );


  setText(
    '#backtest-max-drawdown',
    'Max drawdown: ' +
    (
      Number.isFinite(
        Number(
          backtest
            ?.maxDrawdown
        )
      )
        ? Number(
            backtest
              .maxDrawdown
          ).toFixed(
            2
          )
        : '0.00'
    )
  );
}


/* ======================================================
   CANVAS
====================================================== */


function canvas(id) {

  const el =
    $(id);

  const rect =
    el.getBoundingClientRect();

  const dpr =
    devicePixelRatio || 1;

  el.width =
    rect.width * dpr;

  el.height =
    rect.height * dpr;


  const ctx =
    el.getContext('2d');

  ctx.scale(
    dpr,
    dpr
  );


  return {
    ctx,
    w: rect.width,
    h: rect.height
  };
}


/* ======================================================
   MAIN CHART
====================================================== */


let lastAnalysisKey = null;

let liveRenderTimer =
  null;

let liveRenderQueued =
  false;

let lastLiveRender =
  0;


function scheduleLiveRender(
  force = false
) {

  if (
    liveRenderQueued &&
    !force
  ) {
    return;
  }


  const now =
    performance.now();

  const elapsed =
    now -
    lastLiveRender;

  const delay =
    force
      ? 0
      : Math.max(
          0,
          120 - elapsed
        );


  liveRenderQueued =
    true;


  if (
    liveRenderTimer
  ) {

    clearTimeout(
      liveRenderTimer
    );
  }


  liveRenderTimer =
    setTimeout(
      () => {

        liveRenderQueued =
          false;

        liveRenderTimer =
          null;

        lastLiveRender =
          performance.now();


        requestAnimationFrame(
          () => {

            draw();

            summary();
          }
        );

      },
      delay
    );
}


function cancelScheduledRender() {

  if (
    liveRenderTimer
  ) {

    clearTimeout(
      liveRenderTimer
    );

    liveRenderTimer =
      null;
  }


  liveRenderQueued =
    false;
}

function draw() {

  if (
    !state.data.length
  ) {
    return;
  }


  const closedIndex =
    Math.max(
      0,
      state.data.length - 2
    );

  const closedCandle =
    state.data[
      closedIndex
    ] ||
    state.data.at(-1);

  const analysisKey = [
    state.data.length,
    state.data[0]?.time,
    closedCandle?.time,
    closedCandle?.open,
    closedCandle?.high,
    closedCandle?.low,
    closedCandle?.close,
    closedCandle?.volume,
    state.signalSensitivity,
    Number.isFinite(
      state.futuresVWAP
    )
      ? state.futuresVWAP
      : 'NA'
  ].join(':');

  if (analysisKey !== lastAnalysisKey) {
    lastAnalysisKey = analysisKey;
  state.pa =
    priceAction(
      state.data
    );


  state.momentum =
    momentumSignals(
      state.data
    );


  state.calc =
    indicators(
      state.data
    );

  state.trend = trendIndicators(state.data);


  state.scalps =
    proScalper(
      state.data
    );


  state.signals =
    strideSignals(
      state.data,
      {
        multiplier: {
          fast: 1.5,
          balanced: 2.5,
          slow: 3.5
        }[
          state.signalSensitivity
        ]
      }
    );


  state.niftyEdge =
    analyseNiftyEdge(
      state.data,
      {
        futuresVWAP:
          state.futuresVWAP
      }
    );


  state.niftyEdgeBacktest =
    null;


  state.marketMap =
    analyseMarketMap(
      state.data,
      {
        futuresVWAP:
          state.futuresVWAP
      }
    );


  state.candleScanner =
    scanCandles(
      state.data
    );


  state.candleSetup =
    candleConfluence(
      state.candleScanner,
      state.marketMap,
      state.niftyEdge,
      state.mtf
    );


  state.tradeFinalizer =
    finalizeTrade({
      edge:
        state.niftyEdge,
      marketMap:
        state.marketMap,
      candleSetup:
        state.candleSetup,
      mtf:
        state.mtf,
      calc:
        state.calc,
      trend:
        state.trend,
      data:
        state.data,
      futuresVWAP:
        state.futuresVWAP
    });


  state.gainzSSL =
    analyseGainzSSL(
      state.data,
      {
        finalizer:
          state.tradeFinalizer,
        mtf:
          state.mtf,
        signalExpiry:
          3
      }
    );


  refreshProSuite();
  }


  const {
    ctx,
    w,
    h
  } = canvas('#chart');


  const style =
    getComputedStyle(
      document.body
    );


  const muted =
    style.getPropertyValue(
      '--muted'
    );


  const grid =
    style.getPropertyValue(
      '--line'
    );


  const up =
    style.getPropertyValue(
      '--green'
    );


  const down =
    style.getPropertyValue(
      '--red'
    );


  const end =
    state.data.length -
    state.offset;


  const start =
    Math.max(
      0,
      end - state.count
    );


  const rows =
    state.data.slice(
      start,
      end
    );


  if (
    !rows.length
  ) {
    return;
  }


  const plot =
    w - 68;


  const top =
    30;


  const bottom =
    h - 72;


  const lo =
    Math.min(
      ...rows.map(
        c => c.low
      )
    );


  const hi =
    Math.max(
      ...rows.map(
        c => c.high
      )
    );


  const pad =
    (
      hi - lo
    ) * 0.15 || 1;


  const min =
    lo - pad;


  const max =
    hi + pad;


  const x =
    i =>
      (
        i + 0.5
      ) *
      plot /
      rows.length;


  const y =
    value =>
      top +
      (
        max - value
      ) /
      (
        max - min
      ) *
      (
        bottom - top
      );


  geometry = {
    start,
    end,
    rows,
    plot,
    min,
    max,
    top,
    bottom,
    x,
    y,
    w,
    h
  };


  ctx.font =
    '10px ui-monospace, monospace';


  ctx.lineWidth =
    0.7;


  /*
    PRICE GRID
  */

  for (
    let i = 0;
    i < 5;
    i++
  ) {

    const value =
      min +
      (
        max - min
      ) *
      i /
      4;


    const py =
      y(value);


    ctx.strokeStyle =
      grid;


    ctx.beginPath();

    ctx.moveTo(
      0,
      py
    );

    ctx.lineTo(
      plot,
      py
    );

    ctx.stroke();


    ctx.fillStyle =
      muted;


    ctx.fillText(
      fmt(value),
      plot + 7,
      py + 3
    );
  }


  /*
    TIME GRID
  */

  for (
    let i = 0;
    i < rows.length;
    i += Math.max(
      1,
      Math.floor(
        rows.length / 5
      )
    )
  ) {

    ctx.strokeStyle =
      grid;


    ctx.beginPath();

    ctx.moveTo(
      x(i),
      top
    );

    ctx.lineTo(
      x(i),
      h - 20
    );

    ctx.stroke();


    ctx.fillStyle =
      muted;


    const date =
      new Date(
        rows[i].time *
        1000
      );


    const label =
      date.toLocaleTimeString(
        'en-IN',
        {
          timeZone:
            'Asia/Kolkata',

          hour:
            '2-digit',

          minute:
            '2-digit',

          hour12:
            false
        }
      );


    ctx.fillText(
      label,
      Math.max(
        0,
        x(i) - 17
      ),
      h - 7
    );
  }


  /*
    INDICATOR LINE
  */

  const line =
    (
      arr,
      color,
      dash = []
    ) => {

      if (
        !Array.isArray(arr)
      ) {
        return;
      }


      ctx.save();


      ctx.beginPath();

      ctx.rect(
        0,
        top,
        plot,
        h - top - 20
      );

      ctx.clip();


      ctx.strokeStyle =
        color;


      ctx.lineWidth =
        1.2;


      ctx.setLineDash(
        dash
      );


      ctx.beginPath();


      let begun =
        false;


      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                value
              )
            ) {

              begun =
                false;

              return;
            }


            if (begun) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              begun =
                true;
            }
          }
        );


      ctx.stroke();

      ctx.restore();
    };


  /*
    BOLLINGER
  */

  if (
    state.overlays.has(
      'Bollinger'
    ) &&
    state.calc?.bb
  ) {

    line(
      state.calc.bb.map(
        b => b?.upper
      ),
      colors.Bollinger
    );


    line(
      state.calc.bb.map(
        b => b?.lower
      ),
      colors.Bollinger
    );


    line(
      state.calc.bb.map(
        b => b?.mid
      ),
      colors.Bollinger,
      [3, 4]
    );
  }


  /*
    SUPPORT / RESISTANCE
  */

  if (
    state.overlays.has(
      'S/R'
    )
  ) {

    for (
      const value of [
        lo,
        hi
      ]
    ) {

      ctx.strokeStyle =
        muted;


      ctx.setLineDash(
        [4, 5]
      );


      ctx.beginPath();

      ctx.moveTo(
        0,
        y(value)
      );

      ctx.lineTo(
        plot,
        y(value)
      );

      ctx.stroke();


      ctx.setLineDash(
        []
      );
    }
  }


  drawPriceAction(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down,
      muted
    }
  );


  /*
    CANDLES
  */

  const maxVol =
    Math.max(
      0,
      ...rows.map(
        c =>
          Number(
            c.volume
          ) || 0
      )
    );


  rows.forEach(
    (
      c,
      i
    ) => {

      ctx.strokeStyle =
        ctx.fillStyle =
          c.close >= c.open
            ? up
            : down;


      const bw =
        Math.max(
          2,
          plot /
          rows.length *
          0.6
        );


      ctx.beginPath();


      ctx.moveTo(
        x(i),
        y(c.high)
      );


      ctx.lineTo(
        x(i),
        y(c.low)
      );


      ctx.stroke();


      ctx.fillRect(
        x(i) -
        bw / 2,

        y(
          Math.max(
            c.open,
            c.close
          )
        ),

        bw,

        Math.max(
          1,
          Math.abs(
            y(c.open) -
            y(c.close)
          )
        )
      );


      /*
        Never fabricate NIFTY
        index volume.
      */

      if (
        state.overlays.has(
          'Volume'
        ) &&
        maxVol > 0 &&
        c.volume > 0
      ) {

        const vh =
          c.volume /
          maxVol *
          35;


        ctx.globalAlpha =
          0.25;


        ctx.fillRect(
          x(i) -
          bw / 2,

          h -
          23 -
          vh,

          bw,

          vh
        );


        ctx.globalAlpha =
          1;
      }
    }
  );


  /*
    MOVING AVERAGES
  */

  const indicatorLines = [
    ['EMA 9', 'e9'],
    ['EMA 21', 'e21'],
    ['EMA 50', 'e50'],
    ['EMA 200', 'e200'],
    ['SMA 50', 's50'],
    ['SMA 200', 's200'],
    ['VWAP', 'vwap']
  ];


  for (
    const [
      name,
      key
    ] of indicatorLines
  ) {

    if (
      state.overlays.has(
        name
      ) &&
      Array.isArray(
        state.calc?.[key]
      )
    ) {

      line(
        state.calc[key],
        colors[name]
      );
    }
  }


  if (state.overlays.has('Supertrend (10, 3)') && state.trend) {
    const upLine = state.trend.supertrend.map((v, i) =>
      state.trend.direction[i] === 1 ? v : null);
    const downLine = state.trend.supertrend.map((v, i) =>
      state.trend.direction[i] === -1 ? v : null);
    line(upLine, up);
    line(downLine, down);
  }

  /*
    NIFTY index candles often do not carry tradable volume.
    When index VWAP is unavailable, draw the live NIFTY
    futures VWAP as a separate fallback line.
  */

  if (
    state.overlays.has(
      'VWAP'
    ) &&
    state.symbol === 'NIFTY' &&
    !state.data.some(
      c =>
        Number(c.volume) > 0
    ) &&
    Number.isFinite(
      state.futuresVWAP
    )
  ) {

    line(
      Array(
        state.data.length
      ).fill(
        state.futuresVWAP
      ),
      colors.VWAP,
      [6, 4]
    );
  }


  /*
    STRIDE SIGNALS
  */

  if (
    state.overlays.has(
      'Stride Signals'
    )
  ) {

    for (
      const direction of [
        1,
        -1
      ]
    ) {

      line(
        state.signals.map(
          s =>
            s?.direction ===
            direction
              ? s.stop
              : null
        ),

        direction === 1
          ? up
          : down,

        [5, 3]
      );
    }


    ctx.save();


    ctx.beginPath();

    ctx.rect(
      0,
      top,
      plot,
      bottom - top
    );

    ctx.clip();


    ctx.font =
      'bold 10px system-ui';


    state.signals
      .slice(
        start,
        end
      )
      .forEach(
        (
          s,
          i
        ) => {

          if (
            !s?.signal
          ) {
            return;
          }


          const buy =
            s.signal === 'Buy';


          const label =
            buy
              ? 'BUY'
              : 'SELL';


          const bw =
            36;


          const px =
            Math.max(
              0,
              Math.min(
                plot - bw,
                x(i) -
                bw / 2
              )
            );


          const py =
            Math.max(
              top + 3,
              Math.min(
                bottom - 21,

                y(
                  buy
                    ? rows[i].low
                    : rows[i].high
                ) +
                (
                  buy
                    ? 10
                    : -27
                )
              )
            );


          ctx.fillStyle =
            buy
              ? up
              : down;


          ctx.fillRect(
            px,
            py,
            bw,
            18
          );


          ctx.fillStyle =
            style.getPropertyValue(
              '--bg'
            );


          ctx.fillText(
            label,
            px + 6,
            py + 13
          );
        }
      );


    ctx.restore();
  }


  renderMomentum(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderScalper(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderNiftyEdge(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderMarketMap(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderGainzSSL(
    ctx,
    {
      start,
      end,
      plot,
      top,
      bottom,
      x,
      y,
      up,
      down
    }
  );


  renderSignalStatus();


  /*
    LAST PRICE
  */

  const last =
    rows.at(-1);


  ctx.fillStyle =
    last.close >= last.open
      ? up
      : down;


  ctx.fillRect(
    plot,
    y(last.close) - 10,
    68,
    20
  );


  ctx.fillStyle =
    style.getPropertyValue(
      '--bg'
    );


  ctx.fillText(
    fmt(last.close),
    plot + 5,
    y(last.close) + 4
  );


  /*
    DRAWINGS
  */

  const list =
    state.drawings[
      state.symbol +
      state.tf
    ] || [];


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  for (
    const d of list
  ) {

    const idx =
      state.data.findIndex(
        c =>
          c.time ===
          d.a.time
      ) -
      start;


    const px =
      x(idx);


    const py =
      y(
        d.a.price
      );


    ctx.strokeStyle =
      ctx.fillStyle =
        d.type === 'exit'
          ? down
          : up;


    ctx.lineWidth =
      1.5;


    if (
      d.type === 'trend'
    ) {

      const ix =
        state.data.findIndex(
          c =>
            c.time ===
            d.b.time
        ) -
        start;


      ctx.beginPath();

      ctx.moveTo(
        px,
        py
      );

      ctx.lineTo(
        x(ix),
        y(
          d.b.price
        )
      );

      ctx.stroke();

    } else if (
      d.type === 'level'
    ) {

      ctx.beginPath();

      ctx.moveTo(
        0,
        py
      );

      ctx.lineTo(
        plot,
        py
      );

      ctx.stroke();

    } else {

      ctx.font =
        'bold 12px system-ui';


      ctx.fillText(
        d.type === 'entry'
          ? '▲ ENTRY'
          : '▼ EXIT',

        px,
        py
      );
    }
  }


  ctx.restore();


  /*
    OHLC
  */

  const hover =
    state.hover == null
      ? rows.length - 1
      : Math.max(
          0,
          Math.min(
            rows.length - 1,
            state.hover
          )
        );


  const c =
    rows[hover];


  if (
    $('#ohlc')
  ) {

    $('#ohlc').textContent =
      'O ' +
      fmt(c.open) +
      '  H ' +
      fmt(c.high) +
      '  L ' +
      fmt(c.low) +
      '  C ' +
      fmt(c.close) +
      '  V ' +
      (
        c.volume > 0
          ? (
              c.volume /
              1000
            ).toFixed(1) +
            'K'
          : 'N/A'
      );
  }


  if (
    state.hover != null
  ) {

    ctx.strokeStyle =
      muted;


    ctx.setLineDash(
      [3, 3]
    );


    ctx.beginPath();

    ctx.moveTo(
      x(hover),
      top
    );

    ctx.lineTo(
      x(hover),
      h - 20
    );

    ctx.stroke();


    ctx.setLineDash(
      []
    );
  }


  /*
    RSI
  */

  drawPane(
    '#rsi',
    [
      state.calc.rsi
    ],
    [
      '#a996ec'
    ],
    start,
    end,
    0,
    100,
    [
      30,
      70
    ]
  );


  /*
    MACD
  */

  const macdValues = [
    ...state.calc.macd.slice(
      start,
      end
    ),

    ...state.calc.signal.slice(
      start,
      end
    ),

    ...state.calc.hist.slice(
      start,
      end
    )
  ].filter(
    Number.isFinite
  );


  const ml =
    Math.min(
      0,
      ...macdValues
    );


  const mh =
    Math.max(
      0,
      ...macdValues
    );


  drawPane(
    '#macd',

    [
      state.calc.macd,
      state.calc.signal
    ],

    [
      '#7fa8f5',
      '#e6ba6f'
    ],

    start,
    end,

    ml -
    (
      mh - ml
    ) *
    0.1,

    mh +
    (
      mh - ml
    ) *
    0.1,

    [0],

    state.calc.hist
  );


  const lastRSI =
    state.calc.rsi.at(-1);


  const lastMACD =
    state.calc.macd.at(-1);


  if (
    $('#rsi-value')
  ) {

    $('#rsi-value').textContent =
      Number.isFinite(
        lastRSI
      )
        ? lastRSI.toFixed(2)
        : '—';
  }


  if (
    $('#macd-value')
  ) {

    $('#macd-value').textContent =
      Number.isFinite(
        lastMACD
      )
        ? lastMACD.toFixed(2)
        : '—';
  }


  /*
    LEVELS
  */

  if (
    $('#levels')
  ) {

    const vwap =
      state.calc.vwap?.at(-1);


    const hasVolume =
      state.data.some(
        c =>
          Number(
            c.volume
          ) > 0
      );


    const sessionVWAP =
      hasVolume &&
      Number.isFinite(vwap)
        ? vwap
        : null;


    const fallbackVWAP =
      state.symbol === 'NIFTY' &&
      Number.isFinite(
        state.futuresVWAP
      )
        ? state.futuresVWAP
        : null;


    const displayedVWAP =
      sessionVWAP ??
      fallbackVWAP;


    const vwapLabel =
      sessionVWAP !== null
        ? 'VWAP · session'
        : fallbackVWAP !== null
          ? 'VWAP · NIFTY FUT'
          : 'VWAP · unavailable';


    $('#levels').innerHTML = `
      <div>

        <small>
          Resistance
        </small>

        <strong class="down">
          ${fmt(hi)}
        </strong>

      </div>


      <div>

        <small>
          ${vwapLabel}
        </small>

        <strong>
          ${
            Number.isFinite(
              displayedVWAP
            )
              ? fmt(
                  displayedVWAP
                )
              : 'N/A'
          }
        </strong>

      </div>


      <div>

        <small>
          Support
        </small>

        <strong class="up">
          ${fmt(lo)}
        </strong>

      </div>
    `;
  }
}


/* ======================================================
   RSI / MACD PANES
====================================================== */


function drawPane(
  id,
  series,
  paneColors,
  start,
  end,
  min,
  max,
  thresholds,
  hist
) {

  const {
    ctx,
    w,
    h
  } = canvas(id);


  const plot =
    w - 62;


  const n =
    Math.max(
      1,
      end - start
    );


  const x =
    i =>
      (
        i + 0.5
      ) *
      plot /
      n;


  const y =
    value =>
      5 +
      (
        max - value
      ) /
      (
        max - min || 1
      ) *
      (
        h - 15
      );


  const style =
    getComputedStyle(
      document.body
    );


  ctx.font =
    '9px monospace';


  ctx.fillStyle =
    style.getPropertyValue(
      '--muted'
    );


  for (
    const t of thresholds
  ) {

    ctx.strokeStyle =
      style.getPropertyValue(
        '--line'
      );


    ctx.setLineDash(
      [3, 4]
    );


    ctx.beginPath();

    ctx.moveTo(
      0,
      y(t)
    );

    ctx.lineTo(
      plot,
      y(t)
    );

    ctx.stroke();


    ctx.fillText(
      t.toFixed(0),
      plot + 10,
      y(t) + 3
    );
  }


  ctx.setLineDash(
    []
  );


  if (hist) {

    hist
      .slice(
        start,
        end
      )
      .forEach(
        (
          value,
          i
        ) => {

          if (
            !Number.isFinite(
              value
            )
          ) {
            return;
          }


          ctx.fillStyle =
            value >= 0
              ? '#72e4bd66'
              : '#f17c8666';


          ctx.fillRect(
            x(i) -
            plot /
            n *
            0.3,

            Math.min(
              y(0),
              y(value)
            ),

            plot /
            n *
            0.6,

            Math.max(
              1,
              Math.abs(
                y(value) -
                y(0)
              )
            )
          );
        }
      );
  }


  series.forEach(
    (
      arr,
      k
    ) => {

      ctx.strokeStyle =
        paneColors[k];


      ctx.lineWidth =
        1.2;


      ctx.beginPath();


      let began =
        false;


      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                value
              )
            ) {

              began =
                false;

              return;
            }


            if (began) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              began =
                true;
            }
          }
        );


      ctx.stroke();
    }
  );
}


/* ======================================================
   SUMMARY + DATE
====================================================== */


function summary() {

  /*
    DISPLAY ACTUAL UPSTOX
    SESSION DATE
  */

  updateTradingDate();


  if (
    !state.data.length
  ) {
    return;
  }


  const instrument =
    current();


  const ch =
    change(
      instrument
    );


  const currentPrice =
    quote();


  if (
    $('#symbol-name')
  ) {

    $('#symbol-name').textContent =
      instrument.name;
  }


  if (
    $('#instrument-kind')
  ) {

    $('#instrument-kind').textContent =
      instrument.kind;
  }


  if (
    $('#price')
  ) {

    $('#price').textContent =
      fmt(
        currentPrice
      );
  }


  if (
    $('#change')
  ) {

    $('#change').className =
      Number.isFinite(ch)
        ? ch >= 0
          ? 'up'
          : 'down'
        : 'muted';


    $('#change').textContent =
      Number.isFinite(ch)
        ? formatChange(ch)
        : '—';
  }


  if (
    $('#signal-tf')
  ) {

    $('#signal-tf').textContent =
      state.tf;
  }


  const calc =
    state.calc;


  if (!calc) {
    return;
  }


  const r =
    calc.rsi?.at(-1);


  const e9 =
    calc.e9?.at(-1);


  const e21 =
    calc.e21?.at(-1);


  const hist =
    calc.hist?.at(-1);


  if (
    !Number.isFinite(r) ||
    !Number.isFinite(e9) ||
    !Number.isFinite(e21) ||
    !Number.isFinite(hist)
  ) {
    return;
  }


  const e =
    e9 > e21
      ? 1
      : -1;


  const m =
    hist > 0
      ? 1
      : -1;


  const rs =
    r > 55
      ? 1
      : r < 45
        ? -1
        : 0;


  const score =
    e + m + rs;


  const candidate =
    score >= 2 ? 'Buy' : score <= -2 ? 'Sell' : 'Neutral';
  // Use the latest closed Upstox candle for confirmation.
  const closed = Math.max(0, state.data.length - 2);
  const trend = state.trend;
  const stOn = state.overlays.has('Supertrend (10, 3)');
  const dmiOn = state.overlays.has('ADX/DMI (14)');
  const stDirection = trend?.direction[closed] || 0;
  const adxValue = trend?.adx[closed];
  const plusValue = trend?.plusDI[closed];
  const minusValue = trend?.minusDI[closed];
  const side = candidate === 'Buy' ? 1 : candidate === 'Sell' ? -1 : 0;
  const stPass = !stOn || (side !== 0 && stDirection === side);
  const dmiPass = !dmiOn || (Number.isFinite(adxValue) &&
    adxValue >= 20 && (side === 1 ? plusValue > minusValue :
      side === -1 ? minusValue > plusValue : false));
  const label = side && stPass && dmiPass ? candidate : 'Neutral';

  const closedClose = Number(state.data[closed]?.close);
  const closedEMA9 = calc.e9?.[closed];
  const closedEMA21 = calc.e21?.[closed];
  const closedRSI = calc.rsi?.[closed];
  const ready = [closedClose, trend?.supertrend[closed], adxValue,
    plusValue, minusValue, closedEMA9, closedEMA21, closedRSI]
    .every(Number.isFinite);
  const dmiDirection = plusValue > minusValue ? 1 :
    minusValue > plusValue ? -1 : 0;
  const momentumDirection = closedEMA9 > closedEMA21 && closedRSI >= 50
    ? 1 : closedEMA9 < closedEMA21 && closedRSI < 50 ? -1 : 0;
  const toolkitSide = ready && adxValue >= 20 &&
    stDirection !== 0 && stDirection === dmiDirection &&
    stDirection === momentumDirection ? stDirection : 0;
  const toolkitState = !ready ? 'WARMING UP' :
    toolkitSide === 1 ? 'BUY aligned' :
    toolkitSide === -1 ? 'SELL aligned' : 'WAIT';
  const toolkitStatus = $('#tradeiq-state');
  if (toolkitStatus) {
    toolkitStatus.textContent = toolkitState;
    toolkitStatus.className = toolkitSide === 1 ? 'up' :
      toolkitSide === -1 ? 'down' : 'muted';
  }
  const toolkitTrend = $('#tradeiq-trend');
  if (toolkitTrend) toolkitTrend.textContent = !ready ? 'Warming up' :
    stDirection === 1 ? 'Bullish' : stDirection === -1 ? 'Bearish' : 'Mixed';
  const toolkitStrength = $('#tradeiq-strength');
  if (toolkitStrength) toolkitStrength.textContent = !ready ? 'Warming up' :
    'ADX ' + adxValue.toFixed(1) + ' · ' +
    (adxValue < 20 ? 'Weak trend' : dmiDirection === 1 ? '+DI leads' :
      dmiDirection === -1 ? '-DI leads' : 'DI tied');
  const toolkitMomentum = $('#tradeiq-momentum');
  if (toolkitMomentum) toolkitMomentum.textContent = !ready ? 'Warming up' :
    momentumDirection === 1 ? 'Bullish' :
    momentumDirection === -1 ? 'Bearish' : 'Mixed';



  if (
    $('#signal-label')
  ) {

    $('#signal-label').textContent =
      label;


    $('#signal-label').style.color =
      label === 'Sell'
        ? 'var(--red)'
        : label === 'Neutral'
          ? 'var(--gold)'
          : 'var(--green)';
  }


  if (
    $('#signal-icon')
  ) {

    $('#signal-icon').textContent =
      label === 'Buy'
        ? '↗'
        : label === 'Sell'
          ? '↘'
          : '→';
  }


  if (
    $('#signal-summary')
  ) {

    $('#signal-summary').textContent =
      Math.abs(score) + ' of 3 net directional signals' +
      (candidate === 'Neutral' ? '' : label === 'Neutral'
        ? ' · awaiting trend confirmation' : ' · confirmed');
  }


  if (
    $('#signal-reasons')
  ) {

    $('#signal-reasons').innerHTML = `

      <div class="reason">

        <span>
          EMA 9 / 21 crossover
        </span>

        <b>
          ${
            e > 0
              ? 'Bullish'
              : 'Bearish'
          }
        </b>

      </div>


      <div class="reason">

        <span>
          RSI (14)
        </span>

        <b>
          ${r.toFixed(1)} ·
          ${
            rs > 0
              ? 'Bullish'
              : rs < 0
                ? 'Bearish'
                : 'Neutral'
          }
        </b>

      </div>


      <div class="reason">

        <span>
          MACD momentum
        </span>

        <b>
          ${
            m > 0
              ? 'Bullish'
              : 'Bearish'
          }
        </b>

      </div>
      <div class="reason">
        <span>Supertrend (10, 3) ${stOn ? '· filter on' : '· filter off'}</span>
        <b>${stDirection === 1 ? 'Bullish' : stDirection === -1 ? 'Bearish' : 'Warming up'}</b>
      </div>
      <div class="reason">
        <span>ADX/DMI (14) ${dmiOn ? '· filter on' : '· filter off'}</span>
        <b>${Number.isFinite(adxValue)
          ? 'ADX ' + adxValue.toFixed(1) + ' · +DI ' + plusValue.toFixed(1) +
            ' / -DI ' + minusValue.toFixed(1)
          : 'Warming up'}</b>
      </div>
    `;
  }


  $$('.signal-meter i')
    .forEach(
      (
        el,
        j
      ) => {

        const active =
          j <
          Math.abs(score) +
          1;


        el.classList.toggle(
          'lit',
          active
        );


        el.style.background =
          active
            ? score < 0
              ? 'var(--red)'
              : score === 0
                ? 'var(--gold)'
                : 'var(--green)'
            : '';
      }
    );


  renderProSuiteSummary();

  updateMarketMapPanel();

  renderCandleScanner();

  renderTradeFinalizer();

  renderGainzSSLPanel();

  renderWatch();
}


/* ======================================================
   REPLAY + MULTI-TIMEFRAME CONFIRMATION
====================================================== */


function updateReplayControls() {

  const r =
    state.replay;


  if (
    $('#replay-toggle')
  ) {

    $('#replay-toggle').textContent =
      r.active
        ? '● Replay'
        : '↶ Replay';


    $('#replay-toggle').classList.toggle(
      'active',
      r.active
    );
  }


  if (
    $('#replay-play')
  ) {

    $('#replay-play').textContent =
      r.playing
        ? '❚❚ Pause'
        : '▶ Play';


    $('#replay-play').disabled =
      !r.active;
  }


  if (
    $('#replay-step')
  ) {

    $('#replay-step').disabled =
      !r.active;
  }


  if (
    $('#replay-live')
  ) {

    $('#replay-live').disabled =
      !r.active;
  }


  if (
    $('#replay-status')
  ) {

    if (!r.active) {

      $('#replay-status').textContent =
        'LIVE';

      $('#replay-status').className =
        'replay-status live';

    } else {

      const total =
        r.source.length;

      const shown =
        Math.min(
          total,
          r.index + 1
        );

      $('#replay-status').textContent =
        'REPLAY ' +
        shown +
        ' / ' +
        total;

      $('#replay-status').className =
        'replay-status replay';
    }
  }
}


function clearReplayTimer() {

  if (
    state.replay.timer
  ) {

    clearInterval(
      state.replay.timer
    );

    state.replay.timer =
      null;
  }


  state.replay.playing =
    false;
}


function renderReplayFrame() {

  const r =
    state.replay;


  if (
    !r.active ||
    !r.source.length
  ) {
    return;
  }


  const end =
    Math.max(
      1,
      Math.min(
        r.source.length,
        r.index + 1
      )
    );


  state.data =
    r.source.slice(
      0,
      end
    );


  state.quotes[
    state.symbol
  ] =
    state.data.at(-1)
      ?.close ??
    null;


  state.offset =
    0;

  state.hover =
    null;

  lastAnalysisKey =
    null;


  draw();

  summary();

  updateReplayControls();


  if (
    r.index >=
    r.source.length - 1
  ) {

    clearReplayTimer();

    updateReplayControls();

    toast(
      'Replay complete'
    );
  }
}


function startReplay() {

  if (
    state.replay.active
  ) {
    return;
  }


  if (
    !Array.isArray(
      state.data
    ) ||
    state.data.length < 35
  ) {

    toast(
      'Not enough candles to start replay.'
    );

    return;
  }


  unsubscribe?.();

  unsubscribe =
    null;


  const source =
    state.data.map(
      candle => ({
        ...candle
      })
    );


  const warmup =
    Math.min(
      source.length - 2,
      Math.max(
        30,
        Math.min(
          60,
          source.length - 20
        )
      )
    );


  state.replay.active =
    true;

  state.replay.playing =
    false;

  state.replay.source =
    source;

  state.replay.index =
    warmup;


  setFeedStatus(
    'REPLAY',
    '● REPLAY MODE · historical candles'
  );


  renderReplayFrame();

  toast(
    'Replay mode started'
  );
}


function stepReplay() {

  const r =
    state.replay;


  if (
    !r.active
  ) {

    startReplay();

    return;
  }


  clearReplayTimer();


  if (
    r.index <
    r.source.length - 1
  ) {

    r.index +=
      1;

    renderReplayFrame();
  }
}


function toggleReplayPlay() {

  const r =
    state.replay;


  if (
    !r.active
  ) {

    startReplay();
  }


  if (
    state.replay.playing
  ) {

    clearReplayTimer();

    updateReplayControls();

    return;
  }


  state.replay.playing =
    true;


  state.replay.timer =
    setInterval(
      () => {

        if (
          !state.replay.active
        ) {

          clearReplayTimer();

          return;
        }


        if (
          state.replay.index >=
          state.replay.source.length - 1
        ) {

          clearReplayTimer();

          updateReplayControls();

          return;
        }


        state.replay.index +=
          1;


        renderReplayFrame();

      },
      state.replay.speed
    );


  updateReplayControls();
}


function exitReplay(
  reloadLive = true
) {

  clearReplayTimer();


  state.replay.active =
    false;

  state.replay.source =
    [];

  state.replay.index =
    0;


  updateReplayControls();


  if (
    reloadLive
  ) {

    loadData();

  } else {

    setFeedStatus(
      'LOADING',
      'Returning to live data…'
    );
  }
}


function timeframeTrend(
  candles
) {

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length < 30
  ) {

    return {
      state:
        !Array.isArray(candles) ||
        !candles.length
          ? 'DATA UNAVAILABLE'
          : 'WARMING UP',
      side: 0
    };
  }


  const calc =
    indicators(
      candles
    );

  const tr =
    trendIndicators(
      candles
    );


  const closed =
    Math.max(
      0,
      candles.length - 2
    );


  const e9 =
    calc.e9?.[
      closed
    ];

  const e21 =
    calc.e21?.[
      closed
    ];

  const e50 =
    calc.e50?.[
      closed
    ];

  const rsi =
    calc.rsi?.[
      closed
    ];

  const st =
    tr.direction?.[
      closed
    ] ||
    0;

  const adx =
    tr.adx?.[
      closed
    ];

  const plus =
    tr.plusDI?.[
      closed
    ];

  const minus =
    tr.minusDI?.[
      closed
    ];


  if (
    ![
      e9,
      e21,
      e50,
      rsi,
      adx,
      plus,
      minus
    ].every(
      Number.isFinite
    )
  ) {

    return {
      state: 'WARMING UP',
      side: 0
    };
  }


  let bull =
    0;

  let bear =
    0;


  if (
    e9 >
    e21
  ) {
    bull += 1;
  } else if (
    e9 <
    e21
  ) {
    bear += 1;
  }


  if (
    e21 >
    e50
  ) {
    bull += 1;
  } else if (
    e21 <
    e50
  ) {
    bear += 1;
  }


  if (
    st === 1
  ) {
    bull += 1;
  } else if (
    st === -1
  ) {
    bear += 1;
  }


  if (
    adx >= 20 &&
    plus >
    minus
  ) {
    bull += 1;
  } else if (
    adx >= 20 &&
    minus >
    plus
  ) {
    bear += 1;
  }


  if (
    rsi >= 52
  ) {
    bull += 1;
  } else if (
    rsi <= 48
  ) {
    bear += 1;
  }


  if (
    bull >= 4
  ) {

    return {
      state:
        adx >= 25
          ? 'STRONG BULLISH'
          : 'BULLISH',
      side: 1
    };
  }


  if (
    bear >= 4
  ) {

    return {
      state:
        adx >= 25
          ? 'STRONG BEARISH'
          : 'BEARISH',
      side: -1
    };
  }


  return {
    state: 'RANGE / MIXED',
    side: 0
  };
}


function renderMTF() {

  const map = [
    [
      '5m',
      '#mtf-5m'
    ],
    [
      '15m',
      '#mtf-15m'
    ],
    [
      '1h',
      '#mtf-1h'
    ]
  ];


  for (
    const [
      key,
      selector
    ] of map
  ) {

    const el =
      $(selector);

    const row =
      state.mtf[
        key
      ];


    if (!el) {
      continue;
    }


    el.textContent =
      row?.state ??
      (
        state.mtf.loading
          ? 'LOADING…'
          : '—'
      );


    el.className =
      row?.side === 1
        ? 'up'
        : row?.side === -1
          ? 'down'
          : 'muted';
  }


  const overall =
    $('#mtf-overall');


  if (
    overall
  ) {

    overall.textContent =
      state.mtf.overall;


    overall.className =
      state.mtf.overall.includes(
        'BUY'
      )
        ? 'up'
        : state.mtf.overall.includes(
            'SELL'
          )
          ? 'down'
          : 'muted';
  }
}


async function refreshMTF() {

  if (
    state.replay.active ||
    state.mtf.loading
  ) {
    return;
  }


  state.mtf.loading =
    true;

  renderMTF();


  try {

    const [
      m5,
      m15,
      h1
    ] =
      await Promise.all([
        market.mtfHistory(
          state.symbol,
          '5m'
        ),

        market.mtfHistory(
          state.symbol,
          '15m'
        ),

        market.mtfHistory(
          state.symbol,
          '1h'
        )
      ]);


    state.mtf['5m'] =
      timeframeTrend(
        m5
      );

    state.mtf['15m'] =
      timeframeTrend(
        m15
      );

    state.mtf['1h'] =
      timeframeTrend(
        h1
      );


    const edge =
      state.niftyEdge
        ?.latest;

    const signalSide =
      [
        'BUY+',
        'SELL+',
        'BUY',
        'SELL'
      ].includes(
        edge?.signal
      )
        ? edge.side
        : 0;

    const s5 =
      state.mtf['5m']
        ?.side ??
      0;

    const s15 =
      state.mtf['15m']
        ?.side ??
      0;

    const s1h =
      state.mtf['1h']
        ?.side ??
      0;


    if (
      signalSide === 1 &&
      s5 === 1 &&
      s15 === 1 &&
      s1h === 1
    ) {

      state.mtf.overall =
        'HIGH-CONFIDENCE BUY+';

    } else if (
      signalSide === -1 &&
      s5 === -1 &&
      s15 === -1 &&
      s1h === -1
    ) {

      state.mtf.overall =
        'HIGH-CONFIDENCE SELL+';

    } else {

      state.mtf.overall =
        'NO TRADE';
    }


    state.mtf.updated =
      Date.now();

  } catch (
    error
  ) {

    console.warn(
      'Multi-timeframe confirmation unavailable:',
      error
    );

    state.mtf.overall =
      'NO TRADE';

  } finally {

    state.mtf.loading =
      false;

    renderMTF();
  }
}


function scheduleReconnect() {

  if (
    state.replay.active
  ) {
    return;
  }


  clearTimeout(
    reconnectTimer
  );


  reconnectAttempts +=
    1;


  const delay =
    Math.min(
      15000,
      1500 *
      reconnectAttempts
    );


  setFeedStatus(
    'RECONNECTING',
    'Retrying in ' +
    Math.ceil(
      delay /
      1000
    ) +
    's'
  );


  reconnectTimer =
    setTimeout(
      () => {

        loadData().catch(
          () => {}
        );
      },
      delay
    );
}


/* ======================================================
   LIVE UPSTOX DATA
====================================================== */


async function loadData() {

  activateAllIndicators();


  clearTimeout(
    reconnectTimer
  );

  reconnectTimer =
    null;


  const id =
    ++request;
  lastAnalysisKey = null;


  unsubscribe?.();

  unsubscribe =
    null;


  state.data =
    [];


  state.calc =
    null;


  state.gainzSSL =
    null;


  state.tradeFinalizer =
    null;


  state.candleScanner =
    null;


  state.candleSetup =
    null;


  state.marketMap =
    null;


  state.niftyEdge =
    null;


  state.niftyEdgeBacktest =
    null;


  state.proSuite =
    null;


  state.proBacktest =
    null;


  state.smartSignal =
    null;


  state.smartPlan =
    null;


  state.smartStructure =
    null;


  state.smartMarketState =
    'WAIT';


  state.hover =
    null;


  state.offset =
    0;


  updateTradingDate();


  setFeedStatus(
    'LOADING',
    'Loading current + previous trading session…'
  );


  try {

    const data =
      await market.history(
        state.symbol,
        state.tf
      );


    if (
      id !== request
    ) {
      return;
    }


    if (
      !Array.isArray(data) ||
      !data.length
    ) {

      throw new Error(
        'No Upstox candles available.'
      );
    }


    state.data =
      data
        .filter(
          c =>
            c &&
            Number.isFinite(
              c.time
            ) &&
            Number.isFinite(
              c.open
            ) &&
            Number.isFinite(
              c.high
            ) &&
            Number.isFinite(
              c.low
            ) &&
            Number.isFinite(
              c.close
            )
        )
        .sort(
          (
            a,
            b
          ) =>
            a.time -
            b.time
        );


    if (
      !state.data.length
    ) {

      throw new Error(
        'No valid Upstox candles available.'
      );
    }


    /*
      SESSION OPEN REFERENCE:
      history now contains yesterday/previous trading
      session as well, so use the first candle from the
      latest trading date.
    */

    const latestSessionDate =
      formatTradingDate(
        state.data.at(-1).time
      );

    const latestSessionFirst =
      state.data.find(
        candle =>
          formatTradingDate(
            candle.time
          ) ===
          latestSessionDate
      ) ||
      state.data[0];

    state.sessionOpen[
      state.symbol
    ] =
      latestSessionFirst.open;


    state.quotes[
      state.symbol
    ] =
      state.data.at(-1).close;


    state.offset =
      0;


    state.hover =
      null;


    /*
      DATE NOW COMES FROM
      THE ACTUAL FIRST
      UPSTOX CANDLE
    */

    updateTradingDate();


    activateAllIndicators();


    draw();

    summary();

    // Load previous trading session in the background so it never
    // blocks today's live chart or quote.
    market.previousHistory(
      state.symbol,
      state.tf
    ).then(
      previousCandles => {

        if (
          id !== request ||
          !Array.isArray(
            previousCandles
          ) ||
          !previousCandles.length
        ) {
          return;
        }

        const merged =
          [
            ...previousCandles,
            ...state.data
          ]
            .sort(
              (x, y) =>
                x.time - y.time
            );

        const unique = [];

        for (
          const candle of merged
        ) {
          const last =
            unique.at(-1);

          if (
            last &&
            last.time ===
              candle.time
          ) {
            unique[
              unique.length - 1
            ] =
              candle;
          } else {
            unique.push(
              candle
            );
          }
        }

        state.data =
          unique.slice(
            -500
          );

        lastAnalysisKey =
          null;

        updateTradingDate();

        scheduleLiveRender(
          true
        );

        refreshMTF().catch(
          () => {}
        );
      }
    ).catch(
      () => {}
    );

    // The optional futures VWAP request must not hold up the first chart.
    refreshFuturesVWAP().then(() => {
      if (id === request) {
        lastAnalysisKey =
          null;

        scheduleLiveRender(
          true
        );
      }
    });


    signalTracker.baseline(
      state.signals || []
    );


    scalpTracker.baseline(
      state.scalps || []
    );


    momentumTracker.baseline(
      state.momentum || []
    );


    reconnectAttempts =
      0;

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      null;


    setFeedStatus(
      'LIVE'
    );


    refreshMTF().catch(
      () => {}
    );


    unsubscribe =
      market.subscribe(
        state.symbol,
        state.tf,

        tick => {

          if (
            !tick ||
            !Number.isFinite(
              Number(
                tick.price
              )
            )
          ) {
            return;
          }


          const price =
            Number(
              tick.price
            );


          const tickTime =
            Number.isFinite(
              Number(
                tick.time
              )
            )
              ? Number(
                  tick.time
                )
              : Math.floor(
                  Date.now() /
                  1000
                );


          const seconds =
            intervals[
              state.tf
            ];


          if (
            !Number.isFinite(
              seconds
            ) ||
            seconds <= 0
          ) {
            return;
          }


          const bucket =
            Math.floor(
              tickTime /
              seconds
            ) *
            seconds;


          let last =
            state.data.at(-1);


          if (!last) {
            return;
          }


          const isNewCandle =
            bucket >
            last.time;


          if (
            isNewCandle
          ) {

            const previousClose =
              last.close;


            state.data.push({
              time:
                bucket,

              open:
                previousClose,

              high:
                Math.max(
                  previousClose,
                  price
                ),

              low:
                Math.min(
                  previousClose,
                  price
                ),

              close:
                price,

              volume:
                Number(
                  tick.volume
                ) || 0
            });

          } else if (
            bucket ===
            last.time
          ) {

            last.close =
              price;


            last.high =
              Math.max(
                last.high,
                price
              );


            last.low =
              Math.min(
                last.low,
                price
              );


            if (
              Number.isFinite(
                Number(
                  tick.volume
                )
              ) &&
              Number(
                tick.volume
              ) > 0
            ) {

              last.volume =
                Number(
                  tick.volume
                );
            }
          }


          state.quotes[
            state.symbol
          ] =
            price;


          if (
            Number.isFinite(
              Number(
                tick.changePercent
              )
            )
          ) {
            state.officialChange[
              state.symbol
            ] =
              Number(
                tick.changePercent
              );
          }


          if (
            Number.isFinite(
              Number(
                tick.previousClose
              )
            )
          ) {
            state.previousClose[
              state.symbol
            ] =
              Number(
                tick.previousClose
              );
          }


          state.lastUpdate =
            Date.now();


          if (
            state.data.length >
            500
          ) {

            state.data =
              state.data.slice(
                -500
              );
          }


          updateTradingDate();

          scheduleLiveRender();

          if (
            isNewCandle
          ) {

            processSignalAlerts();

            processScalpAlerts();

            processMomentumAlerts();

            refreshMTF().catch(
              () => {}
            );
          }

          checkAlerts();


          setFeedStatus(
            'LIVE'
          );
        },

        error => {

          console.error(
            'Upstox live feed:',
            error
          );


          setFeedStatus(
            'RECONNECTING',
            'Live quote retrying · chart preserved'
          );
        }
      );

  } catch (
    error
  ) {

    console.error(
      'Upstox history error:',
      error
    );


    state.data =
      [];


    updateTradingDate();


    setFeedStatus(
      'DATA UNAVAILABLE',
      error?.message ||
      'Upstox connection failed'
    );


    toast(
      error?.message ||
      'Upstox market data unavailable.'
    );


    scheduleReconnect();
  }
}


function activateAllIndicators() {

  state.overlays =
    new Set(
      Object.keys(
        colors
      )
    );

  $$('#indicators [data-indicator]')
    .forEach(
      button => {

        button.classList.add(
          'on'
        );

        button.setAttribute(
          'aria-pressed',
          'true'
        );
      }
    );
}


/* ======================================================
   INDICATOR BUTTONS
====================================================== */


if (
  $('#indicators')
) {

  $('#indicators').innerHTML =
    Object.entries(
      colors
    )
      .map(
        (
          [
            name,
            color
          ]
        ) => `
          <button
            class="${
              state.overlays.has(
                name
              )
                ? 'on'
                : ''
            }"
            data-indicator="${name}"
            style="--color:${color}"
            aria-pressed="${
              state.overlays.has(
                name
              )
            }"
          >
            ${name}
          </button>
        `
      )
      .join('');
}


let checkAlerts =
  () => {};


loadData();


if (
  $('.canvas-area')
) {

  new ResizeObserver(
    () => draw()
  ).observe(
    $('.canvas-area')
  );
}


/* ======================================================
   INSTRUMENT SELECTION
====================================================== */


function selectInstrument(
  symbol
) {

  if (
    !instruments.some(
      i =>
        i.id ===
        symbol
    )
  ) {

    throw Error(
      'Unknown instrument'
    );
  }


  state.symbol =
    symbol;


  startPoint =
    null;


  return loadData();
}


if (
  $('#watch-rows')
) {

  $('#watch-rows')
    .addEventListener(
      'click',
      event => {

        const button =
          event.target.closest(
            '[data-symbol]'
          );


        if (button) {

          selectInstrument(
            button.dataset.symbol
          );
        }
      }
    );
}


$$('[data-filter]')
  .forEach(
    button => {

      button.onclick =
        () => {

          state.filter =
            button.dataset.filter;


          $$('[data-filter]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          renderWatch();
        };
    }
  );


/* ======================================================
   TIMEFRAMES
====================================================== */


$$('[data-tf]')
  .forEach(
    button => {

      button.onclick =
        () => {

          const tf =
            button.dataset.tf;


          if (
            ![
              '1m',
              '3m',
              '5m',
              '15m'
            ].includes(tf)
          ) {

            toast(
              'This timeframe is not enabled for the live intraday feed.'
            );

            return;
          }


          if (
            state.replay.active
          ) {

            exitReplay(
              false
            );
          }


          state.tf =
            tf;


          startPoint =
            null;


          $$('[data-tf]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          loadData();
        };
    }
  );


/* ======================================================
   REPLAY CONTROLS
====================================================== */


if (
  $('#replay-toggle')
) {

  $('#replay-toggle').onclick =
    () => {

      if (
        state.replay.active
      ) {

        exitReplay(
          true
        );

      } else {

        startReplay();
      }
    };
}


if (
  $('#replay-play')
) {

  $('#replay-play').onclick =
    () => {

      toggleReplayPlay();
    };
}


if (
  $('#replay-step')
) {

  $('#replay-step').onclick =
    () => {

      stepReplay();
    };
}


if (
  $('#replay-live')
) {

  $('#replay-live').onclick =
    () => {

      exitReplay(
        true
      );
    };
}


if (
  $('#replay-speed')
) {

  $('#replay-speed').onchange =
    event => {

      const value =
        Number(
          event.target.value
        );


      state.replay.speed =
        Number.isFinite(
          value
        )
          ? value
          : 700;


      if (
        state.replay.playing
      ) {

        clearReplayTimer();

        toggleReplayPlay();
      }
    };
}


updateReplayControls();

renderMTF();


/* ======================================================
   INDICATOR CONTROLS
====================================================== */


if (
  $('#indicators')
) {

  $('#indicators').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-indicator]'
        );


      if (!button) {
        return;
      }


      const name =
        button.dataset.indicator;


      if (
        state.overlays.has(
          name
        )
      ) {

        state.overlays.delete(
          name
        );

      } else {

        state.overlays.add(
          name
        );
      }


      button.classList.toggle(
        'on',
        state.overlays.has(
          name
        )
      );


      button.setAttribute(
        'aria-pressed',
        state.overlays.has(
          name
        )
      );


      draw();
      summary();
    };
}


if (
  $('#indicators-toggle')
) {

  $('#indicators-toggle').onclick =
    () => {

      $('#indicators')
        ?.classList.toggle(
          'hidden'
        );
    };
}


if (
  $('#theme')
) {

  $('#theme').onclick =
    () => {

      document.body
        .classList.toggle(
          'light'
        );


      save(
        'stride-theme',

        document.body
          .classList.contains(
            'light'
          )
          ? 'light'
          : 'dark'
      );


      draw();
    };
}


if (
  $('#reset-view')
) {

  $('#reset-view').onclick =
    () => {

      state.count =
        90;


      state.offset =
        0;


      state.hover =
        null;


      draw();
    };
}


/* ======================================================
   DRAWING TOOLS
====================================================== */


$$('[data-tool]')
  .forEach(
    button => {

      button.onclick =
        () => {

          state.tool =
            button.dataset.tool;


          startPoint =
            null;


          $$('[data-tool]')
            .forEach(
              x =>
                x.classList.toggle(
                  'active',
                  x === button
                )
            );


          if (
            $('#chart-tip')
          ) {

            $('#chart-tip').textContent =
              state.tool === 'cursor'
                ? 'Scroll to zoom · drag to pan'
                : state.tool === 'trend'
                  ? 'Select the first point, then the second point'
                  : 'Tap the chart to place ' +
                    state.tool;
          }
        };
    }
  );


function persistDrawings() {

  save(
    'stride-drawings',
    state.drawings
  );
}


if (
  $('#undo')
) {

  $('#undo').onclick =
    () => {

      (
        state.drawings[
          state.symbol +
          state.tf
        ] || []
      ).pop();


      startPoint =
        null;


      persistDrawings();

      draw();
    };
}


const chart =
  $('#chart');


function point(
  event
) {

  if (!geometry) {
    return null;
  }


  const rect =
    chart.getBoundingClientRect();


  const px =
    event.clientX -
    rect.left;


  const py =
    event.clientY -
    rect.top;


  const g =
    geometry;


  if (
    px < 0 ||
    px > g.plot ||
    py < g.top ||
    py > g.bottom
  ) {

    return null;
  }


  const idx =
    Math.max(
      0,
      Math.min(
        g.rows.length - 1,

        Math.floor(
          px /
          g.plot *
          g.rows.length
        )
      )
    );


  return {

    time:
      g.rows[idx].time,

    price:
      g.max -
      (
        py -
        g.top
      ) /
      (
        g.bottom -
        g.top
      ) *
      (
        g.max -
        g.min
      ),

    index:
      idx
  };
}


if (chart) {

  chart.addEventListener(
    'pointerdown',
    event => {

      chart.setPointerCapture(
        event.pointerId
      );


      const p =
        point(event);


      if (!p) {
        return;
      }


      if (
        state.tool === 'cursor'
      ) {

        drag = {
          x:
            event.clientX,

          offset:
            state.offset
        };

        return;
      }


      const key =
        state.symbol +
        state.tf;


      state.drawings[key] ??=
        [];


      if (
        state.tool === 'trend'
      ) {

        if (!startPoint) {

          startPoint =
            p;


          if (
            $('#chart-tip')
          ) {

            $('#chart-tip').textContent =
              'Select the second point';
          }

          return;
        }


        state.drawings[key].push({
          type:
            'trend',

          a:
            startPoint,

          b:
            p
        });


        startPoint =
          null;


        if (
          $('#chart-tip')
        ) {

          $('#chart-tip').textContent =
            'Trend line saved · select two more points';
        }

      } else {

        state.drawings[key].push({
          type:
            state.tool,

          a:
            p
        });
      }


      persistDrawings();

      draw();
    }
  );


  chart.addEventListener(
    'pointermove',
    event => {

      const p =
        point(event);


      state.hover =
        p?.index ??
        null;


      if (
        drag &&
        geometry
      ) {

        state.offset =
          Math.max(
            0,
            Math.min(
              Math.max(
                0,
                state.data.length -
                state.count
              ),

              drag.offset +
              Math.round(
                (
                  event.clientX -
                  drag.x
                ) /
                geometry.plot *
                state.count
              )
            )
          );
      }


      draw();
    }
  );


  chart.addEventListener(
    'pointerup',
    () =>
      drag = null
  );


  chart.addEventListener(
    'pointercancel',
    () =>
      drag = null
  );


  chart.addEventListener(
    'pointerleave',
    () => {

      if (!drag) {

        state.hover =
          null;

        draw();
      }
    }
  );


  chart.addEventListener(
    'wheel',
    event => {

      event.preventDefault();


      state.count =
        Math.max(
          25,
          Math.min(
            state.data.length,

            state.count +
            Math.sign(
              event.deltaY
            ) *
            10
          )
        );


      state.offset =
        Math.min(
          state.offset,

          Math.max(
            0,
            state.data.length -
            state.count
          )
        );


      draw();
    },

    {
      passive: false
    }
  );
}


/* ======================================================
   ZOOM
====================================================== */


if (
  $('.canvas-area')
) {

  const zoom =
    document.createElement(
      'div'
    );


  zoom.className =
    'zoom-controls';


  zoom.innerHTML =
    '<button aria-label="Zoom in">+</button>' +
    '<button aria-label="Zoom out">−</button>';


  $('.canvas-area')
    .append(
      zoom
    );


  zoom.children[0].onclick =
    () => {

      state.count =
        Math.max(
          25,
          state.count - 15
        );


      draw();
    };


  zoom.children[1].onclick =
    () => {

      state.count =
        Math.min(
          state.data.length,
          state.count + 15
        );


      state.offset =
        Math.min(
          state.offset,

          Math.max(
            0,
            state.data.length -
            state.count
          )
        );


      draw();
    };
}


/* ======================================================
   PRICE ALERTS
====================================================== */


function openAlert() {

  if (
    !state.data.length
  ) {
    return;
  }


  if (
    $('#alert-symbol')
  ) {

    $('#alert-symbol').textContent =
      current().name +
      ' · LIVE price ' +
      fmt(
        quote()
      );
  }


  if (
    $('#alert-price')
  ) {

    $('#alert-price').value =
      (
        quote() *
        1.001
      ).toFixed(2);
  }


  $('#alert-dialog')
    ?.showModal();
}


if (
  $('#add-alert')
) {

  $('#add-alert').onclick =
    openAlert;
}


if (
  $('#new-alert')
) {

  $('#new-alert').onclick =
    openAlert;
}


if (
  $('#close-dialog')
) {

  $('#close-dialog').onclick =
    () =>
      $('#alert-dialog')
        ?.close();
}


function renderAlerts() {

  const active =
    state.alerts.filter(
      a =>
        !a.triggered
    ).length;


  if (
    $('#alert-count')
  ) {

    $('#alert-count').textContent =
      active;
  }


  if (
    $('#alert-total')
  ) {

    $('#alert-total').textContent =
      state.alerts.length;
  }


  if (
    $('#alert-list')
  ) {

    $('#alert-list').innerHTML =
      state.alerts.length
        ? state.alerts.map(
            a => `
              <div class="alert-row">

                <span>

                  ${
                    instruments.find(
                      i =>
                        i.id ===
                        a.symbol
                    )?.name ??
                    'Instrument'
                  }

                  ${
                    a.direction ===
                    'above'
                      ? '≥'
                      : '≤'
                  }

                  ₹${fmt(a.price)}

                  <br>

                  <small class="${
                    a.triggered
                      ? 'up'
                      : 'muted'
                  }">

                    ${
                      a.triggered
                        ? 'Triggered · ' +
                          new Date(
                            a.triggered
                          ).toLocaleTimeString(
                            'en-IN'
                          )
                        : 'Active · monitoring LIVE Upstox price'
                    }

                  </small>

                </span>


                <button
                  data-delete-alert="${a.id}"
                  aria-label="Delete alert"
                >
                  ✕
                </button>

              </div>
            `
          ).join('')
        : 'No alerts yet. Set a price to keep an eye on.';
  }


  save(
    'stride-alerts',
    state.alerts
  );
}


function createAlert(
  symbol,
  direction,
  price
) {

  if (
    !instruments.some(
      i =>
        i.id ===
        symbol
    ) ||
    ![
      'above',
      'below'
    ].includes(
      direction
    ) ||
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {

    throw Error(
      'Enter a valid instrument, direction and positive price'
    );
  }


  const alert = {

    id:
      crypto.randomUUID(),

    symbol,

    direction,

    price,

    triggered:
      null
  };


  state.alerts.push(
    alert
  );


  renderAlerts();


  return alert;
}


if (
  $('#alert-form')
) {

  $('#alert-form').onsubmit =
    event => {

      event.preventDefault();


      try {

        createAlert(
          state.symbol,

          $('#alert-direction').value,

          Number(
            $('#alert-price').value
          )
        );


        $('#alert-dialog')
          ?.close();


        toast(
          'LIVE price alert created on this device'
        );


        checkAlerts();

      } catch (
        error
      ) {

        toast(
          error.message
        );
      }
    };
}


if (
  $('#alert-list')
) {

  $('#alert-list').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-delete-alert]'
        );


      if (!button) {
        return;
      }


      state.alerts =
        state.alerts.filter(
          a =>
            a.id !==
            button.dataset.deleteAlert
        );


      renderAlerts();
    };
}


checkAlerts =
  () => {

    let changed =
      false;


    for (
      const alert of
      state.alerts
    ) {

      if (
        alert.triggered
      ) {
        continue;
      }


      const price =
        state.quotes[
          alert.symbol
        ];


      if (
        !Number.isFinite(
          price
        )
      ) {
        continue;
      }


      const triggered =
        alert.direction ===
        'above'
          ? price >=
            alert.price
          : price <=
            alert.price;


      if (triggered) {

        alert.triggered =
          Date.now();


        changed =
          true;


        toast(
          (
            instruments.find(
              i =>
                i.id ===
                alert.symbol
            )?.name ||
            alert.symbol
          ) +
          ' crossed ' +
          fmt(
            alert.price
          )
        );
      }
    }


    if (changed) {

      renderAlerts();
    }
  };


renderAlerts();


/* ======================================================
   INSTALL APP
====================================================== */


window.addEventListener(
  'beforeinstallprompt',
  event => {

    event.preventDefault();

    installPrompt =
      event;
  }
);


if (
  $('#install')
) {

  $('#install').onclick =
    async () => {

      if (
        installPrompt
      ) {

        await installPrompt.prompt();

        installPrompt =
          null;

      } else {

        toast(
          matchMedia(
            '(display-mode: standalone)'
          ).matches
            ? 'Pro Scalper is already running as an app.'
            : 'Open in Chrome on Android: menu → Install app. On iPhone: Share → Add to Home Screen.'
        );
      }
    };
}


/* ======================================================
   SERVICE WORKER
====================================================== */


if (
  'serviceWorker' in navigator &&
  !window.Capacitor
    ?.isNativePlatform()
) {

  navigator.serviceWorker
    .register(
      './sw.js?v=50',
      {
        updateViaCache: 'none'
      }
    )
    .then(
      registration =>
        registration.update()
    )
    .catch(
      () =>
        toast(
          'Offline mode is unavailable in this browser.'
        )
    );
}


/* ======================================================
   WATCHLIST LIVE SUBSCRIPTIONS
====================================================== */


const watchSubscriptions =
  instruments.filter(i => i.id !== state.symbol).map(
    i =>
      market.subscribe(
        i.id,
        '1m',

        tick => {

          if (
            !tick ||
            !Number.isFinite(
              Number(
                tick.price
              )
            )
          ) {
            return;
          }


          if (
            i.id ===
            state.symbol
          ) {
            return;
          }


          state.quotes[
            i.id
          ] =
            Number(
              tick.price
            );


          renderWatch();

          checkAlerts();
        },

        () => {}
      )
  );


window.addEventListener(
  'pagehide',
  () => {

    unsubscribe?.();


    watchSubscriptions
      .forEach(
        stop =>
          stop?.()
      );
  }
);


window.addEventListener(
  'pageshow',
  event => {

    if (
      event.persisted
    ) {

      location.reload();
    }
  }
);


/* ======================================================
   STRIDE SIGNAL STATUS
====================================================== */


function renderSignalStatus() {

  const enabled =
    state.overlays.has(
      'Stride Signals'
    );


  const last =
    state.signals
      ?.filter(Boolean)
      .at(-1);


  const event =
    state.signals
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#stride-status')
  ) {

    $('#stride-status').textContent =
      !enabled
        ? 'Indicator hidden'
        : !last
          ? 'Warming up'
          : last.direction === 1
            ? 'Bullish trend'
            : 'Bearish trend';


    $('#stride-status').className =
      !enabled
        ? 'muted'
        : last?.direction === 1
          ? 'up'
          : 'down';
  }


  if (
    $('#stride-stop')
  ) {

    $('#stride-stop').textContent =
      enabled &&
      last
        ? 'ATR trail ₹' +
          fmt(
            last.stop
          )
        : '—';
  }


  if (
    $('#stride-last')
  ) {

    $('#stride-last').textContent =
      event
        ? 'Last ' +
          event.signal.toLowerCase() +
          ' · ' +
          new Date(
            event.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No reversal in today’s loaded history';
  }


  if (
    $('#stride-settings')
  ) {

    $('#stride-settings')
      .dataset.enabled =
        String(
          enabled
        );
  }


  renderSignalAlerts();
}


if (
  $('#signal-sensitivity')
) {

  $('#signal-sensitivity').value =
    state.signalSensitivity;


  $('#signal-sensitivity').onchange =
    event => {

      state.signalSensitivity =
        event.target.value;


      save(
        'stride-sensitivity',
        state.signalSensitivity
      );


      draw();


      signalTracker.baseline(
        state.signals ||
        []
      );
    };
}


/* ======================================================
   PRICE ACTION
====================================================== */


function drawPriceAction(
  ctx,
  g
) {

  if (
    !state.pa
  ) {
    return;
  }


  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down,
    muted
  } = g;


  const pa =
    state.pa;


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  ctx.font =
    '10px system-ui';


  for (
    const kind of [
      'OB',
      'FVG'
    ]
  ) {

    const enabled =
      state.paOverlays.has(
        kind === 'OB'
          ? 'Order blocks'
          : 'Fair-value gaps'
      );


    if (!enabled) {
      continue;
    }


    const visible =
      pa.zones
        .filter(
          z =>
            z.kind ===
            kind &&
            z.endedAt ==
            null &&
            z.index <
            end
        )
        .slice(-4);


    for (
      const z of visible
    ) {

      const left =
        Math.max(
          0,
          x(
            z.index -
            start
          )
        );


      const width =
        plot -
        left;


      if (
        width <= 0
      ) {
        continue;
      }


      const color =
        z.direction === 1
          ? up
          : down;


      ctx.fillStyle =
        color;


      ctx.globalAlpha =
        kind === 'OB'
          ? 0.10
          : 0.05;


      ctx.fillRect(
        left,
        y(z.high),
        width,
        Math.max(
          1,
          y(z.low) -
          y(z.high)
        )
      );


      ctx.globalAlpha =
        0.7;


      ctx.strokeStyle =
        color;


      ctx.setLineDash(
        kind === 'FVG'
          ? [2, 4]
          : []
      );


      ctx.strokeRect(
        left,
        y(z.high),
        width,
        Math.max(
          1,
          y(z.low) -
          y(z.high)
        )
      );


      ctx.globalAlpha =
        1;


      ctx.setLineDash(
        []
      );


      ctx.fillText(
        kind +
        (
          z.direction === 1
            ? ' +'
            : ' −'
        ),

        Math.max(
          left + 4,
          plot - 47
        ),

        Math.max(
          top + 12,

          Math.min(
            bottom - 3,
            y(z.high) +
            12
          )
        )
      );
    }
  }


  if (
    state.paOverlays.has(
      'Structure'
    )
  ) {

    for (
      const b of
      pa.breaks.filter(
        b =>
          b.index >=
          start &&
          b.index <
          end
      )
    ) {

      ctx.strokeStyle =
        ctx.fillStyle =
          b.direction === 1
            ? up
            : down;


      ctx.setLineDash(
        [3, 3]
      );


      ctx.beginPath();


      ctx.moveTo(
        Math.max(
          0,
          x(
            b.from -
            start
          )
        ),

        y(
          b.price
        )
      );


      ctx.lineTo(
        x(
          b.index -
          start
        ),

        y(
          b.price
        )
      );


      ctx.stroke();


      ctx.setLineDash(
        []
      );


      ctx.fillText(
        b.type,

        Math.max(
          0,
          Math.min(
            plot - 43,
            x(
              b.index -
              start
            ) -
            20
          )
        ),

        y(
          b.price
        ) -
        5
      );
    }
  }


  if (
    state.paOverlays.has(
      'Swings'
    )
  ) {

    for (
      const p of
      pa.pivots.filter(
        p =>
          p.confirmedAt >=
          start &&
          p.confirmedAt <
          end
      )
    ) {

      ctx.fillStyle =
        muted;


      ctx.fillText(
        p.type,

        Math.max(
          0,
          Math.min(
            plot - 25,

            x(
              p.confirmedAt -
              start
            ) -
            8
          )
        ),

        y(
          p.price
        ) +
        (
          p.type.endsWith(
            'H'
          )
            ? -10
            : 14
        )
      );
    }
  }


  ctx.restore();


  const active =
    pa.zones.filter(
      z =>
        z.endedAt ==
        null
    );


  const last =
    pa.breaks.at(-1);


  if (
    $('#pa-summary')
  ) {

    $('#pa-summary').textContent =
      (
        pa.trend === 1
          ? 'Bullish structure'
          : pa.trend === -1
            ? 'Bearish structure'
            : 'Structure forming'
      ) +
      ' · ' +
      active.filter(
        z =>
          z.kind ===
          'OB'
      ).length +
      ' active OB · ' +
      active.filter(
        z =>
          z.kind ===
          'FVG'
      ).length +
      ' open FVG';
  }


  if (
    $('#pa-last')
  ) {

    $('#pa-last').textContent =
      last
        ? 'Last confirmed ' +
          last.type +
          ' · ' +
          new Date(
            state.data[
              last.index
            ].time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No confirmed structure break';
  }
}


if (
  $('#pa-toggles')
) {

  $('#pa-toggles').innerHTML =
    paNames.map(
      name => `
        <button
          data-pa="${name}"
          aria-pressed="${
            state.paOverlays.has(
              name
            )
          }"
          class="${
            state.paOverlays.has(
              name
            )
              ? 'active'
              : ''
          }"
        >
          ${name}
        </button>
      `
    ).join('');


  $('#pa-toggles').onclick =
    event => {

      const button =
        event.target.closest(
          '[data-pa]'
        );


      if (!button) {
        return;
      }


      const name =
        button.dataset.pa;


      if (
        state.paOverlays.has(
          name
        )
      ) {

        state.paOverlays.delete(
          name
        );

      } else {

        state.paOverlays.add(
          name
        );
      }


      button.classList.toggle(
        'active',
        state.paOverlays.has(
          name
        )
      );


      button.setAttribute(
        'aria-pressed',
        state.paOverlays.has(
          name
        )
      );


      save(
        'stride-pa',
        [
          ...state.paOverlays
        ]
      );


      draw();
    };
}


async function ensureNotificationPermission() {

  if (!('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}


async function showSignalNotification(title, body) {

  const allowed =
    await ensureNotificationPermission();

  if (!allowed) {
    return;
  }

  const options = {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'stride-signal-' + Date.now(),
    renotify: false
  };

  try {
    const registration =
      await navigator.serviceWorker?.ready;

    if (registration?.showNotification) {
      await registration.showNotification(
        title,
        options
      );
      return;
    }
  } catch {}

  try {
    new Notification(
      title,
      options
    );
  } catch {}
}


/* ======================================================
   SIGNAL ALERTS
====================================================== */


function renderSignalAlerts() {

  if (
    $('#signal-alert-switch')
  ) {

    $('#signal-alert-switch').checked =
      signalAlertsEnabled;
  }


  if (
    $('#signal-alert-status')
  ) {

    $('#signal-alert-status').textContent =
      signalAlertsEnabled
        ? 'On · ' +
          current().name +
          ' · ' +
          state.tf +
          ' · ' +
          state.signalSensitivity
        : 'Off';
  }


  const list =
    $('#signal-alert-history');


  if (!list) {
    return;
  }


  list.replaceChildren();


  if (
    !Array.isArray(
      signalHistory
    ) ||
    !signalHistory.length
  ) {

    list.textContent =
      'No new signal alerts yet.';

    return;
  }


  for (
    const alert of
    signalHistory.slice(
      0,
      20
    )
  ) {

    const row =
      document.createElement(
        'div'
      );


    row.className =
      'alert-row';


    const text =
      document.createElement(
        'span'
      );


    text.textContent =
      (
        alert.source ||
        'Stride Signals'
      ) +
      ' · ' +
      alert.side.toUpperCase() +
      ' · ' +
      alert.name +
      ' · ' +
      alert.tf +
      ' · ₹' +
      fmt(
        alert.price
      );


    text.className =
      alert.side === 'Buy'
        ? 'up'
        : 'down';


    const time =
      document.createElement(
        'small'
      );


    time.textContent =
      new Date(
        alert.time *
        1000
      ).toLocaleString(
        'en-IN',
        {
          timeZone:
            'Asia/Kolkata',

          day:
            '2-digit',

          month:
            'short',

          hour:
            '2-digit',

          minute:
            '2-digit',

          hour12:
            false
        }
      ) +
      ' IST';


    row.append(
      text,
      time
    );


    list.append(
      row
    );
  }
}


function processSignalAlerts() {

  const fresh =
    signalTracker.collect(
      state.signals || [],
      signalAlertsEnabled
    );


  for (
    const event of fresh
  ) {

    const candle =
      state.data.find(
        c =>
          c.time ===
          event.time
      );


    if (!candle) {
      continue;
    }


    const alert = {

      source:
        'Stride Signals',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        candle.close
    };


    signalHistory.unshift(
      alert
    );


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      alert.side.toUpperCase() +
      ' signal · ' +
      alert.name +
      ' · ' +
      alert.tf +
      ' · ₹' +
      fmt(alert.price)
    );

    showSignalNotification(
      'Stride ' +
      alert.side.toUpperCase() +
      ' · ' +
      alert.name,
      alert.tf +
      ' · ₹' +
      fmt(alert.price) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#signal-alert-switch')
) {

  $('#signal-alert-switch').onchange =
    event => {

      signalAlertsEnabled =
        event.target.checked;

      if (signalAlertsEnabled) {
        ensureNotificationPermission();
      }

      save(
        'stride-signal-alerts-enabled',
        signalAlertsEnabled
      );


      signalTracker.baseline(
        state.signals ||
        []
      );


      renderSignalAlerts();
    };
}


$$('[data-test-signal]')
  .forEach(
    button => {

      button.onclick =
        async () => {

          const side =
            button.dataset.testSignal;

          const message =
            'TEST ' +
            side +
            ' signal · ' +
            current().name +
            ' · ' +
            state.tf +
            ' · live alert test';

          toast(
            message
          );

          await showSignalNotification(
            'Stride TEST ' +
            side +
            ' · ' +
            current().name,
            state.tf +
            ' · Browser notification test'
          );
        };
    }
  );


renderSignalAlerts();


/* ======================================================
   PRO SCALPER
====================================================== */


function renderGainzSSL(
  ctx,
  g
) {

  const combo =
    state.gainzSSL;

  if (!combo) {
    return;
  }

  const latest =
    combo.latest;

  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;


  const drawSeries =
    (
      arr,
      color,
      width = 1.2
    ) => {

      if (
        !Array.isArray(
          arr
        )
      ) {
        return;
      }

      ctx.strokeStyle =
        color;

      ctx.lineWidth =
        width;

      ctx.beginPath();

      let began =
        false;

      arr
        .slice(
          start,
          end
        )
        .forEach(
          (
            value,
            i
          ) => {

            if (
              !Number.isFinite(
                Number(value)
              )
            ) {

              began =
                false;

              return;
            }

            if (began) {

              ctx.lineTo(
                x(i),
                y(value)
              );

            } else {

              ctx.moveTo(
                x(i),
                y(value)
              );

              began =
                true;
            }
          }
        );

      ctx.stroke();
    };


  ctx.save();

  ctx.beginPath();
  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );
  ctx.clip();


  drawSeries(
    combo.ssl1,
    up,
    1.4
  );

  drawSeries(
    combo.ssl2,
    down,
    1.4
  );


  if (
    latest &&
    latest.signal !==
      'NO TRADE'
  ) {

    const plan =
      latest.plan;

    const color =
      latest.side === 1
        ? up
        : down;


    const labelX =
      Math.max(
        8,
        plot - 160
      );


    const labelY =
      plan &&
      Number.isFinite(
        Number(
          plan.entry
        )
      )
        ? Math.max(
            top + 14,
            Math.min(
              bottom - 24,
              y(
                plan.entry
              ) -
              11
            )
          )
        : top + 12;


    ctx.fillStyle =
      color;

    ctx.fillRect(
      labelX,
      labelY,
      74,
      22
    );


    ctx.fillStyle =
      '#ffffff';

    ctx.font =
      'bold 11px system-ui';

    ctx.fillText(
      latest.signal,
      labelX + 8,
      labelY + 15
    );


    if (plan) {

      const levels = [
        [
          'SL',
          plan.stop,
          down
        ],
        [
          'ENTRY',
          plan.entry,
          '#7f8794'
        ],
        [
          'TP1',
          plan.target1,
          up
        ],
        [
          'TP2',
          plan.target2,
          up
        ],
        [
          'TP3',
          plan.target3,
          up
        ]
      ];


      for (
        const [
          label,
          value,
          levelColor
        ] of levels
      ) {

        if (
          !Number.isFinite(
            Number(value)
          )
        ) {
          continue;
        }

        const py =
          y(value);

        if (
          py < top ||
          py > bottom
        ) {
          continue;
        }


        ctx.strokeStyle =
          levelColor;

        ctx.globalAlpha =
          0.72;

        ctx.setLineDash(
          [6, 4]
        );

        ctx.beginPath();
        ctx.moveTo(
          Math.max(
            0,
            plot - 240
          ),
          py
        );
        ctx.lineTo(
          plot - 82,
          py
        );
        ctx.stroke();

        ctx.setLineDash(
          []
        );

        ctx.globalAlpha =
          1;

        ctx.fillStyle =
          levelColor;

        ctx.fillRect(
          plot - 80,
          py - 9,
          78,
          18
        );

        ctx.fillStyle =
          '#ffffff';

        ctx.font =
          'bold 10px system-ui';

        ctx.fillText(
          label +
          ' ' +
          fmt(value),
          plot - 76,
          py + 3
        );
      }
    }
  }


  ctx.restore();
}


function renderGainzSSLPanel() {

  const combo =
    state.gainzSSL;

  const latest =
    combo?.latest;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !== undefined
      ) {
        el.className =
          className;
      }
    };


  if (!latest) {

    set(
      '#gainz-ssl-signal',
      'NO TRADE',
      'muted'
    );

    set(
      '#gainz-baseline-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-ssl-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-qqe-state',
      'WARMING UP',
      'muted'
    );

    set(
      '#gainz-qqe-value',
      '—'
    );

    return;
  }


  set(
    '#gainz-ssl-signal',
    latest.signal,
    latest.signal.startsWith(
      'LONG'
    )
      ? 'up'
      : latest.signal.startsWith(
          'SHORT'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-baseline-state',
    latest.baselineSide === 1
      ? 'BULLISH'
      : latest.baselineSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.baselineSide === 1
      ? 'up'
      : latest.baselineSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-ssl-state',
    latest.sslSide === 1
      ? 'BULLISH'
      : latest.sslSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.sslSide === 1
      ? 'up'
      : latest.sslSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-qqe-state',
    latest.qqeSide === 1
      ? 'BULLISH'
      : latest.qqeSide === -1
        ? 'BEARISH'
        : 'NEUTRAL',
    latest.qqeSide === 1
      ? 'up'
      : latest.qqeSide === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#gainz-qqe-value',
    Number.isFinite(
      Number(
        latest.qqeValue
      )
    )
      ? Number(
          latest.qqeValue
        ).toFixed(
          1
        )
      : '—'
  );


  set(
    '#gainz-risk',
    latest.riskLevel +
    (
      Number.isFinite(
        Number(
          latest.riskPercentile
        )
      )
        ? ' · ' +
          Number(
            latest.riskPercentile
          ).toFixed(
            0
          ) +
          '%'
        : ''
    )
  );


  set(
    '#gainz-entry-distance',
    latest.entryDistance +
    ' · ' +
    latest.score +
    ' pts'
  );


  set(
    '#gainz-reasons',
    latest.reasons?.length
      ? latest.reasons.join(
          ' · '
        )
      : 'Waiting for SSL and QQE alignment'
  );
}

function renderTradeFinalizer() {

  const f =
    state.tradeFinalizer;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className !== undefined
      ) {
        el.className =
          className;
      }
    };


  if (!f) {

    set(
      '#finalizer-state',
      'NO TRADE',
      'muted'
    );

    set(
      '#finalizer-score',
      '0 / 100'
    );

    return;
  }


  set(
    '#finalizer-state',
    f.state,
    f.state.includes(
      'BUY'
    )
      ? 'up'
      : f.state.includes(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#finalizer-score',
    f.score +
    ' / 100'
  );


  set(
    '#finalizer-bull',
    'Bull ' +
    f.bullScore
  );


  set(
    '#finalizer-bear',
    'Bear ' +
    f.bearScore
  );


  set(
    '#finalizer-invalidation',
    f.invalidation
  );


  set(
    '#finalizer-entry',
    f.plan
      ? '₹' +
        fmt(
          f.plan.entry
        )
      : '—'
  );


  set(
    '#finalizer-stop',
    f.plan
      ? '₹' +
        fmt(
          f.plan.stop
        )
      : '—'
  );


  set(
    '#finalizer-tp1',
    f.plan
      ? '₹' +
        fmt(
          f.plan.target1
        )
      : '—'
  );


  set(
    '#finalizer-tp2',
    f.plan
      ? '₹' +
        fmt(
          f.plan.target2
        )
      : '—'
  );


  set(
    '#finalizer-tp3',
    f.plan
      ? '₹' +
        fmt(
          f.plan.target3
        )
      : '—'
  );


  set(
    '#finalizer-reasons',
    f.reasons?.length
      ? f.reasons.join(
          ' · '
        )
      : 'Waiting for confirmed closed-candle confluence'
  );
}


function renderCandleScanner() {

  const scanner =
    state.candleScanner;

  const setup =
    state.candleSetup;


  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className
      ) {
        el.className =
          className;
      }
    };


  const latest =
    scanner?.latest;


  const strongest =
    latest
      ?.patterns
      ?.[0];


  set(
    '#candle-pattern',
    strongest?.name ??
    'NONE'
  );


  set(
    '#candle-pattern-side',
    strongest?.side === 1
      ? 'BULLISH'
      : strongest?.side === -1
        ? 'BEARISH'
        : strongest
          ? 'NEUTRAL'
          : '—',
    strongest?.side === 1
      ? 'up'
      : strongest?.side === -1
        ? 'down'
        : 'muted'
  );


  set(
    '#candle-pattern-strength',
    strongest
      ? strongest.strength +
        ' / 4'
      : '0 / 4'
  );


  set(
    '#candle-trade-state',
    setup?.action ??
    'NO TRADE',
    setup?.action?.startsWith(
      'BUY'
    )
      ? 'up'
      : setup?.action?.startsWith(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#candle-confluence-score',
    Number.isFinite(
      Number(
        setup?.score
      )
    )
      ? setup.score +
        ' pts'
      : '0 pts'
  );


  set(
    '#candle-pattern-list',
    latest?.patterns?.length
      ? latest.patterns
          .slice(
            0,
            4
          )
          .map(
            p =>
              p.name
          )
          .join(
            ' · '
          )
      : 'No confirmed closed-candle pattern'
  );
}


function renderMarketMap(
  ctx,
  g
) {

  const map =
    state.marketMap;

  if (!map) {
    return;
  }

  const {
    plot,
    top,
    bottom,
    y,
    up,
    down
  } = g;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, plot, bottom - top);
  ctx.clip();

  const drawLevel = (
    value,
    label,
    color
  ) => {

    if (
      !Number.isFinite(
        Number(value)
      )
    ) {
      return;
    }

    const py =
      y(value);

    if (
      py < top ||
      py > bottom
    ) {
      return;
    }

    ctx.strokeStyle =
      color;

    ctx.globalAlpha =
      0.62;

    ctx.setLineDash(
      [7, 5]
    );

    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(plot, py);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.fillStyle =
      color;

    ctx.font =
      'bold 10px system-ui';

    ctx.fillText(
      label +
      ' ' +
      fmt(value),
      8,
      Math.max(
        top + 11,
        py - 4
      )
    );
  };


  drawLevel(
    map.nearestResistance
      ?.price,
    'R',
    down
  );


  drawLevel(
    map.nearestSupport
      ?.price,
    'S',
    up
  );


  ctx.restore();
}


function updateMarketMapPanel() {

  const map =
    state.marketMap;

  const set =
    (
      selector,
      value,
      className
    ) => {

      const el =
        $(selector);

      if (!el) {
        return;
      }

      el.textContent =
        value;

      if (
        className
      ) {
        el.className =
          className;
      }
    };


  if (!map) {

    set(
      '#market-map-support',
      '—'
    );

    set(
      '#market-map-resistance',
      '—'
    );

    set(
      '#market-map-trend',
      'WARMING UP',
      'muted'
    );

    set(
      '#market-map-reversal',
      'NONE',
      'muted'
    );

    set(
      '#market-map-breakout',
      'NONE',
      'muted'
    );

    set(
      '#market-map-action',
      'NO TRADE',
      'muted'
    );

    set(
      '#market-map-score',
      '0 / 10'
    );

    return;
  }


  set(
    '#market-map-support',
    map.nearestSupport
      ? '₹' +
        fmt(
          map.nearestSupport
            .price
        )
      : '—'
  );


  set(
    '#market-map-resistance',
    map.nearestResistance
      ? '₹' +
        fmt(
          map.nearestResistance
            .price
        )
      : '—'
  );


  const bullish =
    map.trend.includes(
      'BULLISH'
    );

  const bearish =
    map.trend.includes(
      'BEARISH'
    );


  set(
    '#market-map-trend',
    map.trend,
    bullish
      ? 'up'
      : bearish
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-reversal',
    map.reversal,
    map.reversal.startsWith(
      'BULLISH'
    )
      ? 'up'
      : map.reversal.startsWith(
          'BEARISH'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-breakout',
    map.breakout,
    map.breakout ===
      'BREAKOUT UP'
      ? 'up'
      : map.breakout ===
          'BREAKDOWN'
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-action',
    map.action,
    map.action.startsWith(
      'BUY'
    )
      ? 'up'
      : map.action.startsWith(
          'SELL'
        )
        ? 'down'
        : 'muted'
  );


  set(
    '#market-map-score',
    map.confluence +
    ' / 10'
  );
}


function renderNiftyEdge(
  ctx,
  g
) {

  const analysis =
    state.niftyEdge;

  if (!analysis) {
    return;
  }

  const latest =
    analysis.latest;

  if (!latest) {
    return;
  }

  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;

  const rows =
    analysis.rows
      .slice(
        start,
        end
      );

  ctx.save();

  ctx.beginPath();
  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );
  ctx.clip();

  ctx.font =
    'bold 11px system-ui';

  rows.forEach(
    (
      row,
      i
    ) => {

      if (
        !row ||
        ![
          'BUY+',
          'SELL+'
        ].includes(
          row.signal
        )
      ) {
        return;
      }

      const candle =
        state.data[
          start + i
        ];

      if (!candle) {
        return;
      }

      const buy =
        row.side === 1;

      const label =
        row.signal;

      const width =
        48;

      const height =
        21;

      const px =
        Math.max(
          0,
          Math.min(
            plot - width,
            x(i) -
            width / 2
          )
        );

      const py =
        Math.max(
          top + 3,
          Math.min(
            bottom -
            height -
            2,
            y(
              buy
                ? candle.low
                : candle.high
            ) +
            (
              buy
                ? 20
                : -31
            )
          )
        );

      ctx.fillStyle =
        buy
          ? up
          : down;

      ctx.fillRect(
        px,
        py,
        width,
        height
      );

      ctx.fillStyle =
        getComputedStyle(
          document.body
        ).getPropertyValue(
          '--bg'
        );

      ctx.fillText(
        label,
        px + 7,
        py + 14
      );
    }
  );

  const currentActionable =
    [
      'BUY+',
      'SELL+',
      'BUY',
      'SELL'
    ].includes(
      latest.signal
    );

  const plan =
    currentActionable
      ? latest.plan
      : null;

  if (
    plan &&
    latest.time >=
      state.data[
        start
      ]?.time
  ) {

    const levelBoxes = [
      [
        'ENTRY',
        plan.entry,
        '#777f8c'
      ],
      [
        'SL',
        plan.stop,
        down
      ],
      [
        'TP1',
        plan.target1,
        up
      ],
      [
        'TP2',
        plan.target2,
        up
      ],
      [
        'TP3',
        plan.target3,
        up
      ]
    ];

    for (
      const [
        label,
        value,
        color
      ] of levelBoxes
    ) {

      if (
        !Number.isFinite(
          Number(value)
        )
      ) {
        continue;
      }

      const py =
        Math.max(
          top + 2,
          Math.min(
            bottom - 20,
            y(value) - 9
          )
        );

      ctx.strokeStyle =
        color;

      ctx.setLineDash(
        [5, 4]
      );

      ctx.beginPath();
      ctx.moveTo(
        Math.max(
          0,
          plot - 165
        ),
        py + 9
      );
      ctx.lineTo(
        plot - 82,
        py + 9
      );
      ctx.stroke();

      ctx.setLineDash(
        []
      );

      ctx.fillStyle =
        color;

      ctx.fillRect(
        plot - 80,
        py,
        78,
        18
      );

      ctx.fillStyle =
        '#ffffff';

      ctx.font =
        'bold 10px system-ui';

      ctx.fillText(
        label +
        ' ' +
        fmt(value),
        plot - 76,
        py + 12
      );
    }
  }

  ctx.restore();
}


function renderScalper(
  ctx,
  g
) {

  const supported =
    [
      '1m',
      '3m',
      '5m'
    ].includes(
      state.tf
    );


  const enabled =
    scalpEnabled &&
    supported;


  const last =
    state.scalps
      ?.filter(Boolean)
      .at(-1);


  const setup =
    state.scalps
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#scalp-enable')
  ) {

    $('#scalp-enable').checked =
      scalpEnabled;
  }


  if (
    $('#scalp-alerts')
  ) {

    $('#scalp-alerts').checked =
      scalpAlerts;
  }


  if (
    $('#scalp-state')
  ) {

    $('#scalp-state').textContent =
      !scalpEnabled
        ? 'Mode off'
        : !supported
          ? 'Paused · choose 1m, 3m or 5m'
          : !last
            ? 'Warming up'
            : last.direction === 1
              ? 'BUY conditions aligned'
              : last.direction === -1
                ? 'SELL conditions aligned'
                : 'WAIT · mixed conditions';


    $('#scalp-state').className =
      enabled &&
      last?.direction === 1
        ? 'up'
        : enabled &&
          last?.direction === -1
          ? 'down'
          : 'muted';
  }


  if (
    $('#scalp-confirmations')
  ) {

    if (
      enabled &&
      last
    ) {

      const vwapText =
        last.vwapAvailable
          ? last.vwap > 0
            ? 'above'
            : last.vwap < 0
              ? 'below'
              : 'at VWAP'
          : 'N/A (index volume unavailable)';


      $('#scalp-confirmations').textContent =
        'EMA 9/21: ' +
        (
          last.ema > 0
            ? 'bullish'
            : last.ema < 0
              ? 'bearish'
              : 'flat'
        ) +
        ' · VWAP: ' +
        vwapText +
        ' · RSI 14: ' +
        (
          Number.isFinite(
            last.rsi
          )
            ? last.rsi.toFixed(1)
            : '—'
        );

    } else {

      $('#scalp-confirmations').textContent =
        'Uses EMA 9/21, RSI 14 and genuine session VWAP when volume is available';
    }
  }


  if (
    $('#scalp-setup')
  ) {

    $('#scalp-setup').textContent =
      enabled &&
      setup
        ? 'Latest ' +
          setup.signal.toUpperCase() +
          ' setup · ' +
          new Date(
            setup.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST · live-session levels'
        : 'No setup displayed';
  }


  for (
    const key of [
      'entry',
      'stop',
      'target'
    ]
  ) {

    if (
      $('#scalp-' + key)
    ) {

      $('#scalp-' + key).textContent =
        enabled &&
        setup
          ? fmt(
              setup[key]
            )
          : '—';
    }
  }


  if (!enabled) {
    return;
  }


  const {
    start,
    end,
    plot,
    top,
    bottom,
    x,
    y,
    up,
    down
  } = g;


  ctx.save();


  ctx.beginPath();

  ctx.rect(
    0,
    top,
    plot,
    bottom - top
  );

  ctx.clip();


  ctx.font =
    'bold 10px system-ui';


  state.scalps
    .slice(
      start,
      end
    )
    .forEach(
      (
        s,
        i
      ) => {

        if (
          !s?.signal
        ) {
          return;
        }

        const buy =
          s.signal === 'Buy';

        const label =
          buy
            ? 'BUY'
            : 'SELL';

        const markerW =
          42;

        const markerH =
          20;

        const px =
          Math.max(
            0,
            Math.min(
              plot - markerW,
              x(i) -
              markerW / 2
            )
          );

        const py =
          Math.max(
            top + 3,
            Math.min(
              bottom - markerH - 2,

              y(
                s.entry
              ) +
              (
                buy
                  ? 24
                  : -34
              )
            )
          );

        ctx.fillStyle =
          buy
            ? up
            : down;

        ctx.fillRect(
          px,
          py,
          markerW,
          markerH
        );

        ctx.fillStyle =
          getComputedStyle(
            document.body
          ).getPropertyValue(
            '--bg'
          );

        ctx.font =
          'bold 11px system-ui';

        ctx.fillText(
          label,
          px + 8,
          py + 14
        );
      }
    );


  ctx.restore();
}


function processScalpAlerts() {

  const fresh =
    scalpTracker.collect(
      state.scalps || [],

      scalpEnabled &&
      scalpAlerts &&
      [
        '1m',
        '3m',
        '5m'
      ].includes(
        state.tf
      )
    );


  for (
    const event of fresh
  ) {

    const alert = {

      source:
        'Pro Scalper',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        event.entry
    };


    signalHistory.unshift(
      alert
    );


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      'Pro Scalper ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name +
      ' · ' +
      state.tf +
      ' · ₹' +
      fmt(event.entry)
    );

    showSignalNotification(
      'Pro Scalper ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name,
      state.tf +
      ' · ₹' +
      fmt(event.entry) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#scalp-enable')
) {

  $('#scalp-enable').onchange =
    event => {

      scalpEnabled =
        event.target.checked;


      save(
        'stride-scalper',
        scalpEnabled
      );


      scalpTracker.baseline(
        state.scalps ||
        []
      );


      momentumTracker.baseline(
        state.momentum ||
        []
      );


      draw();
    };
}


if (
  $('#scalp-alerts')
) {

  $('#scalp-alerts').onchange =
    event => {

      scalpAlerts =
        event.target.checked;


      save(
        'stride-scalper-alerts',
        scalpAlerts
      );


      scalpTracker.baseline(
        state.scalps ||
        []
      );
    };
}


$$('[data-scalp-tf]')
  .forEach(
    button => {

      button.onclick =
        () => {

          const target =
            document.querySelector(
              '[data-tf="' +
              button.dataset.scalpTf +
              '"]'
            );


          target?.click();
        };
    }
  );


/* ======================================================
   NATIVE APP
====================================================== */


if (
  window.Capacitor
    ?.isNativePlatform()
) {

  document.body.classList.add(
    'native-app'
  );


  if (
    $('#install')
  ) {

    $('#install').hidden =
      true;
  }
}


/* ======================================================
   MOMENTUM
====================================================== */


function renderMomentum(
  ctx,
  g
) {

  const last =
    state.momentum
      ?.filter(
        s =>
          s?.signal
      )
      .at(-1);


  if (
    $('#momentum-alerts')
  ) {

    $('#momentum-alerts').checked =
      momentumAlerts;
  }


  if (
    $('#momentum-status')
  ) {

    $('#momentum-status').textContent =
      last
        ? 'Last ' +
          last.signal.toUpperCase() +
          ' · ' +
          new Date(
            last.time *
            1000
          ).toLocaleString(
            'en-IN',
            {
              timeZone:
                'Asia/Kolkata',

              day:
                '2-digit',

              month:
                'short',

              hour:
                '2-digit',

              minute:
                '2-digit',

              hour12:
                false
            }
          ) +
          ' IST'
        : 'No confirmed momentum crossing';
  }


  /*
    Momentum calculations and alerts remain active.
    Chart labels are intentionally hidden to keep the
    primary BUY / SELL view clean.
  */
}


function processMomentumAlerts() {

  const fresh =
    momentumTracker.collect(
      state.momentum || [],
      momentumAlerts
    );


  for (
    const event of fresh
  ) {

    signalHistory.unshift({
      source:
        'Stride Momentum',

      side:
        event.signal,

      name:
        current().name,

      tf:
        state.tf,

      time:
        event.time,

      price:
        event.price
    });


    signalHistory.splice(
      20
    );


    save(
      'stride-signal-history',
      signalHistory
    );


    toast(
      'Momentum ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name +
      ' · ' +
      state.tf +
      ' · ₹' +
      fmt(event.price)
    );

    showSignalNotification(
      'Stride Momentum ' +
      event.signal.toUpperCase() +
      ' · ' +
      current().name,
      state.tf +
      ' · ₹' +
      fmt(event.price) +
      ' · Live Upstox'
    );
  }


  renderSignalAlerts();
}


if (
  $('#momentum-alerts')
) {

  $('#momentum-alerts').onchange =
    event => {

      momentumAlerts =
        event.target.checked;


      save(
        'stride-momentum-alerts',
        momentumAlerts
      );


      momentumTracker.baseline(
        state.momentum ||
        []
      );
    };
}


/* ======================================================
   INITIAL WATCHLIST
====================================================== */


renderWatch();


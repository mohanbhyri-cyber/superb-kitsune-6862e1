// tradingview-datafeed.js
// ============================================================
// TradingView Advanced Charts Datafeed API adapter for SMRT Algo Pro.
// Uses the app's existing Upstox-backed Cloudflare Worker endpoints.
// This file is ready for the official private Advanced Charts library.
// ============================================================

const RESOLUTION_TO_TF = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '1D': '1D',
  D: '1D'
};

const TF_SECONDS = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1D': 86400
};

const asyncCall = fn =>
  setTimeout(fn, 0);

function normalizeBase(base) {
  return String(base || '')
    .replace(/\/$/, '');
}

function toBars(candles, from, to) {
  return (Array.isArray(candles) ? candles : [])
    .map(c => ({
      time: Number(c.time) * 1000,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume) || 0
    }))
    .filter(bar => {
      if (
        ![
          bar.time,
          bar.open,
          bar.high,
          bar.low,
          bar.close
        ].every(Number.isFinite)
      ) {
        return false;
      }

      const seconds =
        bar.time / 1000;

      if (
        Number.isFinite(from) &&
        seconds < from
      ) {
        return false;
      }

      if (
        Number.isFinite(to) &&
        seconds > to
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => a.time - b.time);
}

async function fetchJson(url) {
  const response =
    await fetch(url, {
      cache: 'no-store'
    });

  if (!response.ok) {
    throw new Error(
      'HTTP ' + response.status
    );
  }

  return response.json();
}

export function createTradingViewDatafeed(
  apiBase = ''
) {
  const base =
    normalizeBase(apiBase);

  const subscriptions =
    new Map();

  const datafeed = {

    onReady(callback) {
      asyncCall(
        () =>
          callback({
            supported_resolutions: [
              '1',
              '3',
              '5',
              '15',
              '60',
              '1D'
            ],
            exchanges: [
              {
                value: 'NSE',
                name: 'NSE',
                desc: 'National Stock Exchange of India'
              }
            ],
            symbols_types: [
              {
                name: 'index',
                value: 'index'
              }
            ],
            supports_marks: false,
            supports_timescale_marks: false,
            supports_time: true
          })
      );
    },


    searchSymbols(
      userInput,
      exchange,
      symbolType,
      onResult
    ) {
      const q =
        String(userInput || '')
          .trim()
          .toUpperCase();

      const matches =
        !q ||
        'NIFTY 50'.includes(q) ||
        'NIFTY'.includes(q);

      asyncCall(
        () =>
          onResult(
            matches
              ? [
                  {
                    symbol: 'NIFTY',
                    full_name: 'NSE:NIFTY',
                    description: 'NIFTY 50',
                    exchange: 'NSE',
                    ticker: 'NIFTY',
                    type: 'index'
                  }
                ]
              : []
          )
      );
    },


    resolveSymbol(
      symbolName,
      onResolve,
      onError
    ) {
      const name =
        String(symbolName || '')
          .toUpperCase();

      if (
        !name.includes('NIFTY')
      ) {
        asyncCall(
          () =>
            onError(
              'Only NIFTY 50 is enabled'
            )
        );

        return;
      }

      asyncCall(
        () =>
          onResolve({
            ticker: 'NIFTY',
            name: 'NIFTY',
            full_name: 'NSE:NIFTY',
            description: 'NIFTY 50',
            type: 'index',
            session: '0915-1530',
            exchange: 'NSE',
            listed_exchange: 'NSE',
            timezone: 'Asia/Kolkata',
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: false,
            supported_resolutions: [
              '1',
              '3',
              '5',
              '15',
              '60',
              '1D'
            ],
            volume_precision: 0,
            data_status: 'streaming',
            currency_code: 'INR'
          })
      );
    },


    async getBars(
      symbolInfo,
      resolution,
      periodParams,
      onResult,
      onError
    ) {
      try {
        const tf =
          RESOLUTION_TO_TF[
            resolution
          ];

        if (!tf) {
          throw new Error(
            'Unsupported resolution ' +
            resolution
          );
        }

        let payload;

        if (tf === '1D') {
          payload =
            await fetchJson(
              base +
              '/api/nifty-daily-history?days=180'
            );
        } else if (
          tf === '1h'
        ) {
          payload =
            await fetchJson(
              base +
              '/api/upstox-mtf-history?symbol=NIFTY&timeframe=1h'
            );
        } else {
          payload =
            await fetchJson(
              base +
              '/api/upstox-history?symbol=NIFTY&timeframe=' +
              encodeURIComponent(tf)
            );
        }

        const bars =
          toBars(
            payload?.candles,
            periodParams?.from,
            periodParams?.to
          );

        asyncCall(
          () =>
            onResult(
              bars,
              {
                noData:
                  bars.length === 0
              }
            )
        );

      } catch (error) {
        asyncCall(
          () =>
            onError(
              error?.message ||
              'Unable to load NIFTY bars'
            )
        );
      }
    },


    subscribeBars(
      symbolInfo,
      resolution,
      onRealtimeCallback,
      subscriberUID,
      onResetCacheNeededCallback
    ) {
      const tf =
        RESOLUTION_TO_TF[
          resolution
        ] ||
        '5m';

      const bucketSeconds =
        TF_SECONDS[tf] ||
        300;

      let stopped = false;
      let timer = null;
      let currentBar = null;


      const poll =
        async () => {
          if (stopped) {
            return;
          }

          try {
            const q =
              await fetchJson(
                base +
                '/api/live-quote?symbol=NIFTY'
              );

            const price =
              Number(q?.price);

            if (
              Number.isFinite(price)
            ) {
              const nowSeconds =
                Number(
                  q?.time
                ) ||
                Math.floor(
                  Date.now() / 1000
                );

              const bucket =
                Math.floor(
                  nowSeconds /
                  bucketSeconds
                ) *
                bucketSeconds;

              if (
                !currentBar ||
                currentBar.time !==
                  bucket * 1000
              ) {
                currentBar = {
                  time:
                    bucket * 1000,
                  open: price,
                  high: price,
                  low: price,
                  close: price,
                  volume:
                    Number(
                      q?.volume
                    ) || 0
                };
              } else {
                currentBar = {
                  ...currentBar,
                  high:
                    Math.max(
                      currentBar.high,
                      price
                    ),
                  low:
                    Math.min(
                      currentBar.low,
                      price
                    ),
                  close: price,
                  volume:
                    Number(
                      q?.volume
                    ) ||
                    currentBar.volume ||
                    0
                };
              }

              onRealtimeCallback({
                ...currentBar
              });
            }

          } catch (error) {
            console.warn(
              'TradingView realtime poll failed:',
              error
            );
          }

          if (!stopped) {
            timer =
              setTimeout(
                poll,
                1500
              );
          }
        };


      poll();

      subscriptions.set(
        subscriberUID,
        () => {
          stopped = true;

          if (timer) {
            clearTimeout(
              timer
            );
          }
        }
      );
    },


    unsubscribeBars(
      subscriberUID
    ) {
      const stop =
        subscriptions.get(
          subscriberUID
        );

      stop?.();

      subscriptions.delete(
        subscriberUID
      );
    },


    async getServerTime(
      callback
    ) {
      asyncCall(
        () =>
          callback(
            Math.floor(
              Date.now() / 1000
            )
          )
      );
    }
  };

  return datafeed;
}

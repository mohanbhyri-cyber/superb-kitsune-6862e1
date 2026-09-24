// smrt-chart-consensus.js
// ============================================================
// SMRT CHART CONSENSUS
// Historical, closed-candle, non-repainting BUY/SELL markers.
// Uses only data that exists at each candle: EMA, Supertrend,
// ADX/DMI, RSI, MACD, VWAP, NIFTY EDGE and SSL+QQE.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

export function analyseChartConsensus({
  candles,
  calc,
  trend,
  edge,
  gainz
} = {}) {

  if (
    !Array.isArray(candles) ||
    !calc ||
    !trend
  ) {
    return {
      rows: [],
      latest: null
    };
  }

  const rows =
    Array(
      candles.length
    ).fill(
      null
    );

  let lastSignalSide = 0;
  let lastSignalIndex = -99;

  const lastClosed =
    Math.max(
      0,
      candles.length - 2
    );

  for (
    let i = 50;
    i <= lastClosed;
    i++
  ) {
    const candle =
      candles[i];

    if (!candle) {
      continue;
    }

    const e9 =
      calc.e9?.[i];

    const e21 =
      calc.e21?.[i];

    const e50 =
      calc.e50?.[i];

    const rsi =
      calc.rsi?.[i];

    const hist =
      calc.hist?.[i];

    const vwap =
      calc.vwap?.[i];

    const st =
      trend.direction?.[i] || 0;

    const adx =
      trend.adx?.[i];

    const plus =
      trend.plusDI?.[i];

    const minus =
      trend.minusDI?.[i];

    const close =
      Number(
        candle.close
      );

    let bull = 0;
    let bear = 0;
    const reasons = [];

    if (
      [e9,e21,e50]
        .every(finite)
    ) {
      if (
        e9 > e21 &&
        e21 > e50
      ) {
        bull += 2;
        reasons.push(
          'EMA bullish'
        );
      } else if (
        e9 < e21 &&
        e21 < e50
      ) {
        bear += 2;
        reasons.push(
          'EMA bearish'
        );
      }
    }

    if (st === 1) {
      bull += 2;
      reasons.push(
        'Supertrend bullish'
      );
    } else if (
      st === -1
    ) {
      bear += 2;
      reasons.push(
        'Supertrend bearish'
      );
    }

    if (
      [adx,plus,minus]
        .every(finite) &&
      adx >= 20
    ) {
      if (
        plus > minus
      ) {
        bull += 2;
        reasons.push(
          'ADX/DMI bullish'
        );
      } else if (
        minus > plus
      ) {
        bear += 2;
        reasons.push(
          'ADX/DMI bearish'
        );
      }
    }

    if (finite(rsi)) {
      if (rsi >= 52) {
        bull += 1;
        reasons.push(
          'RSI bullish'
        );
      } else if (
        rsi <= 48
      ) {
        bear += 1;
        reasons.push(
          'RSI bearish'
        );
      }
    }

    if (finite(hist)) {
      if (hist > 0) {
        bull += 1;
        reasons.push(
          'MACD positive'
        );
      } else if (
        hist < 0
      ) {
        bear += 1;
        reasons.push(
          'MACD negative'
        );
      }
    }

    if (
      finite(vwap) &&
      finite(close)
    ) {
      if (close > vwap) {
        bull += 1;
        reasons.push(
          'Above VWAP'
        );
      } else if (
        close < vwap
      ) {
        bear += 1;
        reasons.push(
          'Below VWAP'
        );
      }
    }

    const edgeRow =
      edge?.rows?.[i];

    if (
      edgeRow &&
      ['BUY','BUY+']
        .includes(
          edgeRow.signal
        )
    ) {
      bull += 3;
      reasons.push(
        'NIFTY EDGE buy'
      );
    } else if (
      edgeRow &&
      ['SELL','SELL+']
        .includes(
          edgeRow.signal
        )
    ) {
      bear += 3;
      reasons.push(
        'NIFTY EDGE sell'
      );
    }

    const gainzRow =
      gainz?.rows?.[i];

    if (
      gainzRow?.side === 1
    ) {
      bull += 2;
      reasons.push(
        'SSL+QQE long'
      );
    } else if (
      gainzRow?.side === -1
    ) {
      bear += 2;
      reasons.push(
        'SSL+QQE short'
      );
    }

    const side =
      bull > bear
        ? 1
        : bear > bull
          ? -1
          : 0;

    const leader =
      Math.max(
        bull,
        bear
      );

    const gap =
      Math.abs(
        bull - bear
      );

    let state =
      'NO TRADE';

    if (
      side === 1 &&
      leader >= 9 &&
      gap >= 5
    ) {
      state =
        'STRONG BUY';
    } else if (
      side === -1 &&
      leader >= 9 &&
      gap >= 5
    ) {
      state =
        'STRONG SELL';
    } else if (
      side === 1 &&
      leader >= 7 &&
      gap >= 3
    ) {
      state =
        'BUY';
    } else if (
      side === -1 &&
      leader >= 7 &&
      gap >= 3
    ) {
      state =
        'SELL';
    }

    const actionable =
      state !==
      'NO TRADE';

    let signal =
      null;

    if (
      actionable &&
      (
        side !==
          lastSignalSide ||
        i -
          lastSignalIndex >=
          6
      )
    ) {
      signal =
        state;

      lastSignalSide =
        side;

      lastSignalIndex =
        i;
    }

    rows[i] = {
      time:
        candle.time,
      state,
      signal,
      side:
        actionable
          ? side
          : 0,
      bull,
      bear,
      score:
        leader,
      gap,
      reasons:
        reasons.slice(
          0,
          8
        )
    };
  }

  return {
    rows,
    latest:
      rows[lastClosed] ||
      null
  };
}

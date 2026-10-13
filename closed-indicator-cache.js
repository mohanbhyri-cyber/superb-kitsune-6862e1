// Memoize deterministic completed-candle calculations only. Freshness,
// session, supporting-feed and trade/risk gates still run on every check.
const fields = ['time', 'open', 'high', 'low', 'close', 'volume'];

export function createClosedIndicatorCache(calculate) {
  let previousContext;
  let previousRows = null;
  let value;
  const reset = () => {
    previousContext = undefined;
    previousRows = null;
    value = undefined;
  };
  return {
    reset,
    read(candles, context = '') {
      const rows = Array.isArray(candles) ? candles : [];
      const unchanged = previousRows !== null && context === previousContext &&
        rows.length === previousRows.length && rows.every((row, index) =>
          fields.every((field, column) =>
            Object.is(row?.[field], previousRows[index][column])));
      if (unchanged) return { value, changed: false };
      // Copy scalars to detect in-place provider corrections to ANY candle.
      const snapshot = rows.map(row => fields.map(field => row?.[field]));
      reset(); // Exceptions must never leave an earlier valid result available.
      const next = calculate(rows);
      previousContext = context;
      previousRows = snapshot;
      value = next;
      return { value, changed: true };
    }
  };
}

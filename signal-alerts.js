// A baseline prevents old history from firing on load or settings changes.
export class SignalAlertTracker {
  baseline(signals) { this.through = signals.filter(Boolean).at(-1)?.time ?? -Infinity; }
  collect(signals, enabled) {
    const fresh = signals.filter(s => s && s.time > (this.through ?? Infinity));
    this.baseline(signals);
    return enabled ? fresh.filter(s => s.signal === 'Buy' || s.signal === 'Sell') : [];
  }
}

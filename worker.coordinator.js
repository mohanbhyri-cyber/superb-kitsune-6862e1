// Opt-in entrypoint only. Production wrangler.jsonc still uses worker.js.
import { DurableObject } from 'cloudflare:workers';
import app, { upstoxCoordinatorPolicies } from './worker.js';
import { UpstoxCoordinator } from './upstox-coordinator.js';

export class UpstoxRequestCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.controller = new UpstoxCoordinator(ctx, env, upstoxCoordinatorPolicies);
  }
  fetch(request) { return this.controller.fetch(request); }
}

export default app;

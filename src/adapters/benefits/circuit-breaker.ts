export type CircuitState = 'closed' | 'open' | 'half_open';

export const DEFAULT_FAILURE_LIMIT = 3;
export const DEFAULT_COOLDOWN_MS = 5000;

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private trialInFlight: boolean = false;
  private openedAtMs: number = 0;

  readonly failureLimit: number;
  readonly cooldownMs: number;

  constructor(failureLimit = DEFAULT_FAILURE_LIMIT, cooldownMs = DEFAULT_COOLDOWN_MS) {
    this.failureLimit = failureLimit > 0 ? failureLimit : DEFAULT_FAILURE_LIMIT;
    this.cooldownMs = cooldownMs > 0 ? cooldownMs : DEFAULT_COOLDOWN_MS;
  }

  allow(): { allowed: boolean; isTrial: boolean } {
    const now = Date.now();

    switch (this.state) {
      case 'closed':
        return { allowed: true, isTrial: false };

      case 'open':
        if (now - this.openedAtMs >= this.cooldownMs) {
          this.state = 'half_open';
          this.trialInFlight = true;
          return { allowed: true, isTrial: true };
        }
        return { allowed: false, isTrial: false };

      case 'half_open':
        // Only one trial probe in flight at a time
        return { allowed: false, isTrial: false };
    }
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;

    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAtMs = Date.now();
      this.failures = 0;
      return;
    }

    if (this.state === 'closed') {
      this.failures++;
      if (this.failures >= this.failureLimit) {
        this.state = 'open';
        this.openedAtMs = Date.now();
        this.failures = 0;
      }
    }
  }

  stateString(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.trialInFlight = false;
    this.openedAtMs = 0;
  }

  trip(): void {
    this.state = 'open';
    this.openedAtMs = Date.now();
    this.failures = 0;
    this.trialInFlight = false;
  }
}

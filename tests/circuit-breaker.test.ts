import { describe, test, expect } from 'bun:test';
import { CircuitBreaker } from '../src/adapters/benefits/circuit-breaker.ts';

describe('Circuit Breaker State Transitions', () => {
  test('stays closed on successful operations', () => {
    const cb = new CircuitBreaker(3, 100);
    expect(cb.stateString()).toBe('closed');

    for (let i = 0; i < 10; i++) {
      const { allowed } = cb.allow();
      expect(allowed).toBe(true);
      cb.recordSuccess();
    }
    expect(cb.stateString()).toBe('closed');
  });

  test('trips to open after 3 consecutive failed operations', () => {
    const cb = new CircuitBreaker(3, 100);

    cb.recordFailure();
    expect(cb.stateString()).toBe('closed');
    cb.recordFailure();
    expect(cb.stateString()).toBe('closed');

    cb.recordFailure();
    expect(cb.stateString()).toBe('open');

    const { allowed } = cb.allow();
    expect(allowed).toBe(false);
  });

  test('transitions to half-open after cooldown and executes trial probe', async () => {
    const cb = new CircuitBreaker(2, 50); // 50ms cooldown

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.stateString()).toBe('open');

    // Before cooldown
    expect(cb.allow().allowed).toBe(false);

    // Wait for cooldown
    await Bun.sleep(60);

    // First trial probe allowed
    const probe1 = cb.allow();
    expect(probe1.allowed).toBe(true);
    expect(probe1.isTrial).toBe(true);
    expect(cb.stateString()).toBe('half_open');

    // Subsequent concurrent calls in half_open rejected
    const probe2 = cb.allow();
    expect(probe2.allowed).toBe(false);

    // Success in trial probe closes circuit
    cb.recordSuccess();
    expect(cb.stateString()).toBe('closed');
  });

  test('trial failure in half-open reopens circuit', async () => {
    const cb = new CircuitBreaker(2, 40);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.stateString()).toBe('open');

    await Bun.sleep(50);
    expect(cb.allow().allowed).toBe(true);
    expect(cb.stateString()).toBe('half_open');

    cb.recordFailure();
    expect(cb.stateString()).toBe('open');
  });

  test('manual trip and reset work deterministically', () => {
    const cb = new CircuitBreaker();
    cb.trip();
    expect(cb.stateString()).toBe('open');
    cb.reset();
    expect(cb.stateString()).toBe('closed');
  });
});

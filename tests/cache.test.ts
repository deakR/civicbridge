import { describe, test, expect } from 'bun:test';
import { Cache } from '../src/adapters/benefits/cache.ts';
import type { BenefitRecord } from '../src/domain/models.ts';

describe('Benefits In-Memory TTL Cache', () => {
  const dummy: BenefitRecord = {
    ref: 'CA/2016/4001',
    name: 'Vance, Ashley',
    born: '1984-03-12',
    addr: '14 Elm Road',
    town: 'Calder',
    benefit_code: 'HSP-A',
    review_due: '2026-10-01',
  };

  test('serves fresh reads from cache', () => {
    const cache = new Cache(1000);
    cache.set(dummy.ref, dummy);

    const { record, found, stale } = cache.get(dummy.ref);
    expect(found).toBe(true);
    expect(stale).toBe(false);
    expect(record?.name).toBe('Vance, Ashley');
  });

  test('detects expired entries as stale', async () => {
    const cache = new Cache(30); // 30ms TTL
    cache.set(dummy.ref, dummy);

    await Bun.sleep(45);

    const { record, found, stale } = cache.get(dummy.ref);
    expect(found).toBe(true);
    expect(stale).toBe(true);
    expect(record).toBeDefined();
  });

  test('drop explicitly removes cached records on 404', () => {
    const cache = new Cache();
    cache.set(dummy.ref, dummy);
    expect(cache.size()).toBe(1);

    cache.drop(dummy.ref);
    expect(cache.get(dummy.ref).found).toBe(false);
    expect(cache.size()).toBe(0);
  });
});

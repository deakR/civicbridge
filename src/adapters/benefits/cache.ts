import type { BenefitRecord } from '../../domain/models.ts';

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  record: BenefitRecord;
  fetchedAtMs: number;
}

export class Cache {
  private readonly entries = new Map<string, CacheEntry>();
  readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs > 0 ? ttlMs : DEFAULT_CACHE_TTL_MS;
  }

  get(ref: string): { record: BenefitRecord | null; found: boolean; stale: boolean } {
    const entry = this.entries.get(ref);
    if (!entry) {
      return { record: null, found: false, stale: false };
    }

    const isStale = Date.now() - entry.fetchedAtMs > this.ttlMs;
    return { record: entry.record, found: true, stale: isStale };
  }

  set(ref: string, record: BenefitRecord): void {
    this.entries.set(ref, {
      record,
      fetchedAtMs: Date.now(),
    });
  }

  drop(ref: string): void {
    this.entries.delete(ref);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

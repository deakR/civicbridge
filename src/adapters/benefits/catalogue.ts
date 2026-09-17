import type { BenefitRecord } from '../../domain/models.ts';
import { BenefitsClient } from './client.ts';
import { DEFAULT_CACHE_TTL_MS } from './cache.ts';

export class Catalogue {
  private readonly client: BenefitsClient;
  readonly ttlMs: number;
  private snapshot: BenefitRecord[] = [];
  private fetchedAtMs: number = 0;
  private hasData: boolean = false;
  private inFlightPromise: Promise<{ records: BenefitRecord[]; fresh: boolean; fetchedAtMs: number }> | null = null;

  constructor(client: BenefitsClient, ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.client = client;
    this.ttlMs = ttlMs > 0 ? ttlMs : DEFAULT_CACHE_TTL_MS;
  }

  async get(
    signal?: AbortSignal
  ): Promise<{ records: BenefitRecord[] | null; fresh: boolean; fetchedAtMs: number }> {
    const now = Date.now();

    // 1. Fresh cache hit
    if (this.hasData && now - this.fetchedAtMs <= this.ttlMs) {
      return { records: this.snapshot, fresh: true, fetchedAtMs: this.fetchedAtMs };
    }

    // 2. Single-flight deduplication: coalesce multiple concurrent fetches into one
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = (async () => {
      try {
        const { records, status } = await this.client.getAllBenefits(signal);

        if (status.status === 'ok' && records.length > 0) {
          this.snapshot = records;
          this.fetchedAtMs = Date.now();
          this.hasData = true;
          return { records: this.snapshot, fresh: true, fetchedAtMs: this.fetchedAtMs };
        }

        // Upstream failure fallback to stale cached snapshot
        if (this.hasData) {
          return { records: this.snapshot, fresh: false, fetchedAtMs: this.fetchedAtMs };
        }

        return { records: null, fresh: false, fetchedAtMs: 0 };
      } finally {
        this.inFlightPromise = null;
      }
    })();

    return this.inFlightPromise;
  }

  hasSnapshot(): boolean {
    return this.hasData;
  }

  snapshotLength(): number {
    return this.snapshot.length;
  }
}

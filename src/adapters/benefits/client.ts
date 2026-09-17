import { XMLParser } from 'fast-xml-parser';
import type { BenefitRecord, SourceStatus } from '../../domain/models.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { Cache } from './cache.ts';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 50;

export interface BenefitsClientOptions {
  baseURL: string;
  maxAttempts?: number;
  retryBackoffMs?: number;
  breaker?: CircuitBreaker;
  cache?: Cache;
}

export class BenefitsClient {
  readonly baseURL: string;
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly breaker: CircuitBreaker;
  readonly cache: Cache;
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
  });

  constructor(options: BenefitsClientOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, '');
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.cache = options.cache ?? new Cache();
  }

  async getHealth(signal?: AbortSignal): Promise<SourceStatus> {
    const start = Date.now();
    const status: SourceStatus = {
      status: 'unavailable',
      latency_ms: 0,
      circuit: this.breaker.stateString(),
    };

    try {
      const res = await fetch(`${this.baseURL}/health`, { signal });
      status.http_code = res.status;
      status.latency_ms = Date.now() - start;

      if (res.ok) {
        status.status = 'ok';
      } else {
        status.status = 'unavailable';
        status.error_message = `upstream returned HTTP ${res.status}`;
      }
    } catch (err: any) {
      status.latency_ms = Date.now() - start;
      status.status = 'unavailable';
      status.error_message = err.message || 'connection failed';
    }

    return status;
  }

  async getBenefit(
    ref: string,
    signal?: AbortSignal
  ): Promise<{ record: BenefitRecord | null; status: SourceStatus }> {
    const start = Date.now();

    if (!ref) {
      return {
        record: null,
        status: {
          status: 'unavailable',
          error_message: 'benefit reference is empty',
          latency_ms: 0,
        },
      };
    }

    // 1. Check fresh cache
    const { record: cachedRecord, found, stale } = this.cache.get(ref);
    if (found && !stale && cachedRecord) {
      return {
        record: cachedRecord,
        status: {
          status: 'ok',
          latency_ms: Date.now() - start,
        },
      };
    }

    // 2. Check circuit breaker
    const { allowed } = this.breaker.allow();
    if (!allowed) {
      if (found && cachedRecord) {
        return {
          record: cachedRecord,
          status: {
            status: 'stale',
            error_message: 'benefits register circuit open; serving cached record',
            latency_ms: Date.now() - start,
            circuit: 'open',
          },
        };
      }

      return {
        record: null,
        status: {
          status: 'circuit_open',
          error_message: 'benefits register circuit open',
          latency_ms: Date.now() - start,
          circuit: 'open',
        },
      };
    }

    // 3. Fetch with bounded retries
    const { record, status } = await this.fetchBenefitWithRetry(ref, signal);

    switch (status.status) {
      case 'ok':
        if (record) {
          this.cache.set(ref, record);
        }
        this.breaker.recordSuccess();
        break;

      case 'not_found':
        this.cache.drop(ref);
        // 404 is authoritative and does NOT trip the circuit breaker
        break;

      default:
        this.breaker.recordFailure();
        if (found && cachedRecord) {
          return {
            record: cachedRecord,
            status: {
              status: 'stale',
              error_message: 'benefits register unavailable; serving cached record',
              latency_ms: Date.now() - start,
              circuit: this.breaker.stateString(),
            },
          };
        }
    }

    status.latency_ms = Date.now() - start;
    return { record, status };
  }

  private async fetchBenefitWithRetry(
    ref: string,
    signal?: AbortSignal
  ): Promise<{ record: BenefitRecord | null; status: SourceStatus }> {
    const start = Date.now();
    const upstreamURL = `${this.baseURL}/records/${encodeURIComponent(ref)}`;

    let lastError = '';
    let lastCode = 0;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) {
        return {
          record: null,
          status: {
            status: 'unavailable',
            error_message: 'request canceled',
            latency_ms: Date.now() - start,
          },
        };
      }

      try {
        const res = await fetch(upstreamURL, { signal });
        lastCode = res.status;

        if (res.status === 404) {
          return {
            record: null,
            status: {
              status: 'not_found',
              http_code: 404,
              latency_ms: Date.now() - start,
            },
          };
        }

        if (!res.ok) {
          lastError = `attempt ${attempt}/${this.maxAttempts}: upstream returned HTTP ${res.status}`;
          if (attempt < this.maxAttempts) {
            await Bun.sleep(this.retryBackoffMs);
            continue;
          }
          break;
        }

        const xmlText = await res.text();
        const parsed = this.xmlParser.parse(xmlText);

        const raw = parsed?.BenefitsRegister?.Record ?? parsed?.Record;
        if (!raw) {
          return {
            record: null,
            status: {
              status: 'unavailable',
              error_message: 'invalid XML record format',
              latency_ms: Date.now() - start,
            },
          };
        }

        const record: BenefitRecord = {
          ref: String(raw.Ref || ref),
          name: String(raw.Name || ''),
          born: String(raw.Born || ''),
          addr: String(raw.Addr || ''),
          town: String(raw.Town || ''),
          benefit_code: String(raw.BenefitCode || ''),
          review_due: String(raw.ReviewDue || ''),
        };

        return {
          record,
          status: {
            status: 'ok',
            http_code: res.status,
            latency_ms: Date.now() - start,
          },
        };
      } catch (err: any) {
        lastError = `attempt ${attempt}/${this.maxAttempts}: ${err.message || 'fetch error'}`;
        if (attempt < this.maxAttempts) {
          await Bun.sleep(this.retryBackoffMs);
          continue;
        }
      }
    }

    return {
      record: null,
      status: {
        status: 'unavailable',
        http_code: lastCode || undefined,
        error_message: lastError,
        latency_ms: Date.now() - start,
      },
    };
  }

  async getAllBenefits(
    signal?: AbortSignal
  ): Promise<{ records: BenefitRecord[]; status: SourceStatus }> {
    const start = Date.now();
    const status: SourceStatus = {
      status: 'unavailable',
      latency_ms: 0,
      circuit: this.breaker.stateString(),
    };

    const { allowed } = this.breaker.allow();
    if (!allowed) {
      status.status = 'circuit_open';
      status.error_message = 'benefits register circuit open';
      status.latency_ms = Date.now() - start;
      return { records: [], status };
    }

    let lastError = '';
    let lastCode = 0;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) {
        status.error_message = 'request canceled';
        status.latency_ms = Date.now() - start;
        this.breaker.recordFailure();
        return { records: [], status };
      }

      try {
        const res = await fetch(`${this.baseURL}/records`, { signal });
        lastCode = res.status;
        status.http_code = res.status;

        if (!res.ok) {
          lastError = `attempt ${attempt}/${this.maxAttempts}: upstream returned HTTP ${res.status}`;
          if (attempt < this.maxAttempts) {
            await Bun.sleep(this.retryBackoffMs);
            continue;
          }
          break;
        }

        const xmlText = await res.text();
        const parsed = this.xmlParser.parse(xmlText);

        let list = parsed?.BenefitsRegister?.Record;
        if (!list) list = [];
        if (!Array.isArray(list)) list = [list];

        const records: BenefitRecord[] = list.map((raw: any) => ({
          ref: String(raw.Ref || ''),
          name: String(raw.Name || ''),
          born: String(raw.Born || ''),
          addr: String(raw.Addr || ''),
          town: String(raw.Town || ''),
          benefit_code: String(raw.BenefitCode || ''),
          review_due: String(raw.ReviewDue || ''),
        }));

        this.breaker.recordSuccess();
        status.status = 'ok';
        status.error_message = undefined;
        status.latency_ms = Date.now() - start;
        return { records, status };
      } catch (err: any) {
        lastError = `attempt ${attempt}/${this.maxAttempts}: ${err.message || 'fetch error'}`;
        if (attempt < this.maxAttempts) {
          await Bun.sleep(this.retryBackoffMs);
          continue;
        }
      }
    }

    this.breaker.recordFailure();
    status.status = 'unavailable';
    status.http_code = lastCode || undefined;
    status.error_message = lastError;
    status.latency_ms = Date.now() - start;
    return { records: [], status };
  }
}

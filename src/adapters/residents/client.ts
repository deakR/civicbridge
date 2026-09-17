import type { Resident, ResidentPage, PaginationStatus, SourceStatus } from '../../domain/models.ts';

export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_MAX_PAGES = 100;

export interface ResidentClientOptions {
  baseURL: string;
  maxPages?: number;
}

export class ResidentClient {
  readonly baseURL: string;
  readonly maxPages: number;

  constructor(options: ResidentClientOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, '');
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  }

  async getHealth(signal?: AbortSignal): Promise<SourceStatus> {
    const start = Date.now();
    const status: SourceStatus = {
      status: 'unavailable',
      latency_ms: 0,
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

  async getResident(
    id: string,
    signal?: AbortSignal
  ): Promise<{ resident: Resident | null; status: SourceStatus }> {
    const start = Date.now();

    if (!id) {
      return {
        resident: null,
        status: {
          status: 'unavailable',
          error_message: 'resident id is empty',
          latency_ms: 0,
        },
      };
    }

    const upstreamURL = `${this.baseURL}/residents/${encodeURIComponent(id)}`;

    try {
      const res = await fetch(upstreamURL, { signal });
      const latencyMs = Date.now() - start;

      if (res.status === 404) {
        return {
          resident: null,
          status: {
            status: 'not_found',
            http_code: 404,
            latency_ms: latencyMs,
          },
        };
      }

      if (!res.ok) {
        return {
          resident: null,
          status: {
            status: 'unavailable',
            http_code: res.status,
            error_message: `upstream returned HTTP ${res.status}`,
            latency_ms: latencyMs,
          },
        };
      }

      const resident: Resident = await res.json();
      return {
        resident,
        status: {
          status: 'ok',
          http_code: res.status,
          latency_ms: latencyMs,
        },
      };
    } catch (err: any) {
      return {
        resident: null,
        status: {
          status: 'unavailable',
          error_message: err.message || 'fetch failed',
          latency_ms: Date.now() - start,
        },
      };
    }
  }

  async getResidents(
    signal?: AbortSignal
  ): Promise<{ residents: Resident[]; pagination: PaginationStatus; status: SourceStatus }> {
    const start = Date.now();
    const status: SourceStatus = { status: 'ok', latency_ms: 0 };
    const pagination: PaginationStatus = {
      pages_fetched: 0,
      records_seen: 0,
      duplicates: 0,
      conflicts: 0,
      unique: 0,
      reported_total: 0,
      complete: false,
    };

    const residents: Resident[] = [];
    const byID = new Map<string, Resident>();
    let failReason: string | undefined;
    let finished = false;

    for (let page = 1; page <= this.maxPages; page++) {
      if (signal?.aborted) {
        status.status = 'unavailable';
        status.error_message = 'request canceled';
        failReason = 'context_canceled';
        break;
      }

      const upstreamURL = `${this.baseURL}/residents?page=${page}&page_size=${DEFAULT_PAGE_SIZE}`;

      try {
        const res = await fetch(upstreamURL, { signal });
        status.http_code = res.status;

        if (!res.ok) {
          status.status = 'unavailable';
          status.error_message = `upstream returned HTTP ${res.status} on page ${page}`;
          failReason = 'upstream_failure';
          break;
        }

        const result: ResidentPage = await res.json();

        pagination.pages_fetched++;
        pagination.records_seen += result.results?.length ?? 0;
        pagination.reported_total = result.total;

        if ((!result.results || result.results.length === 0) && result.has_more) {
          status.status = 'unavailable';
          status.error_message = `empty page ${page} while has_more is true`;
          failReason = 'pagination_anomaly';
          break;
        }

        for (const resident of result.results || []) {
          const existing = byID.get(resident.id);
          if (existing) {
            pagination.duplicates++;
            if (JSON.stringify(existing) !== JSON.stringify(resident)) {
              pagination.conflicts++;
            }
            continue;
          }

          byID.set(resident.id, resident);
          residents.push(resident);
        }

        if (!result.has_more) {
          finished = true;
          break;
        }
      } catch (err: any) {
        status.status = 'unavailable';
        status.error_message = `fetch page ${page}: ${err.message || 'error'}`;
        failReason = signal?.aborted ? 'context_canceled' : 'upstream_failure';
        break;
      }
    }

    pagination.unique = residents.length;

    if (failReason) {
      pagination.complete = false;
      pagination.reason = failReason;
    } else if (!finished) {
      status.status = 'unavailable';
      status.error_message = `maximum pagination limit of ${this.maxPages} pages reached`;
      pagination.complete = false;
      pagination.reason = 'max_pages_reached';
    } else {
      pagination.complete = pagination.unique === pagination.reported_total;
      if (!pagination.complete) {
        pagination.reason = 'total_mismatch';
      }
    }

    status.latency_ms = Date.now() - start;
    return { residents, pagination, status };
  }
}

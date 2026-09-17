import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Automatically spin up Bun-native municipal upstreams (Zero Python required!)
import './upstream/resident-service.ts';
import './upstream/benefits-service.ts';

import { ResidentClient } from './adapters/residents/client.ts';
import { BenefitsClient } from './adapters/benefits/client.ts';
import { CircuitBreaker } from './adapters/benefits/circuit-breaker.ts';
import { Cache } from './adapters/benefits/cache.ts';
import { Catalogue } from './adapters/benefits/catalogue.ts';
import { matchResidentToCatalogue } from './domain/identity.ts';
import { computeVulnerability, detectBenefitGaps, buildHouseholdClusters } from './domain/analytics.ts';
import { generateProvenanceHash } from './domain/provenance.ts';
import { runDirtyDataBenchmark } from './domain/benchmark.ts';
import { MunicipalAIAdvisor } from './ai/advisor.ts';
import { GroqClient } from './ai/client.ts';
import type { AutoUnifiedResponse, UnifiedResponse, SourceStatus } from './domain/models.ts';

const app = new Hono();
const startTime = Date.now();

// Configuration
const residentIndexURL = process.env.RESIDENT_INDEX_URL || 'http://127.0.0.1:8081';
const benefitsURL = process.env.BENEFITS_URL || 'http://127.0.0.1:8082';
const port = parseInt(process.env.PORT || '8080');

// Shared Singletons & Adapters
export const breaker = new CircuitBreaker(3, 5000);
export const cache = new Cache(5 * 60 * 1000);
export const residentClient = new ResidentClient({ baseURL: residentIndexURL });
export const benefitsClient = new BenefitsClient({
  baseURL: benefitsURL,
  breaker,
  cache,
});
export const catalogue = new Catalogue(benefitsClient, 5 * 60 * 1000);
export const aiAdvisor = new MunicipalAIAdvisor(new GroqClient());

// Middleware
app.use('*', cors());

// 1. Health Check
app.get('/health', async (c) => {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 3000);

  try {
    const [resStatus, benStatus] = await Promise.all([
      residentClient.getHealth(timeoutCtrl.signal),
      benefitsClient.getHealth(timeoutCtrl.signal),
    ]);

    clearTimeout(timer);

    const sources: Record<string, SourceStatus> = {
      resident_index: resStatus,
      benefits_register: benStatus,
    };

    const overall =
      resStatus.status === 'ok' && benStatus.status === 'ok' ? 'ok' : 'degraded';

    return c.json({
      status: overall,
      sources,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch (err: any) {
    clearTimeout(timer);
    return c.json(
      {
        status: 'unhealthy',
        error: err.message,
      },
      500
    );
  }
});

// 2. Single Resident Lookup
app.get('/residents/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.text('resident ID is required', 400);
  }

  const { resident, status } = await residentClient.getResident(id);

  if (status.status === 'not_found') {
    return c.text('resident not found', 404);
  }

  if (status.status !== 'ok' || !resident) {
    return c.text('resident index unavailable', 502);
  }

  return c.json(resident);
});

// 3. Full Resident Catalogue with Deduplication
app.get('/residents', async (c) => {
  const { residents, pagination, status } = await residentClient.getResidents();

  return c.json({
    residents,
    pagination,
    _meta: {
      sources: {
        resident_index: status,
      },
      partial: status.status !== 'ok' || !pagination.complete,
    },
  });
});

// 4. Single Benefit Record Lookup
app.get('/benefits/*', async (c) => {
  const fullPath = c.req.path;
  const ref = decodeURIComponent(fullPath.replace(/^\/benefits\//, ''));

  if (!ref) {
    return c.text('benefit reference is required', 400);
  }

  const { record, status } = await benefitsClient.getBenefit(ref);

  if (status.status === 'not_found') {
    return c.text('benefit record not found', 404);
  }

  if (status.status !== 'ok' && status.status !== 'stale') {
    return c.text('benefits register unavailable', 502);
  }

  return c.json(record);
});

// 5. Concurrent Fan-Out Unified Lookup
app.get('/unified', async (c) => {
  const residentID = c.req.query('resident_id');
  const benefitRef = c.req.query('benefit_ref');

  if (!residentID && !benefitRef) {
    return c.text('resident_id or benefit_ref is required', 400);
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 10000);

  const response: UnifiedResponse = {
    resident: null,
    benefits: null,
    _meta: {
      sources: {},
      partial: false,
    },
  };

  const tasks: Promise<void>[] = [];

  if (residentID) {
    tasks.push(
      residentClient
        .getResident(residentID, timeoutCtrl.signal)
        .then(({ resident, status }) => {
          response.resident = resident;
          response._meta.sources['resident_index'] = status;
          if (status.status !== 'ok') {
            response._meta.partial = true;
          }
        })
    );
  }

  if (benefitRef) {
    tasks.push(
      benefitsClient
        .getBenefit(benefitRef, timeoutCtrl.signal)
        .then(({ record, status }) => {
          response.benefits = record;
          response._meta.sources['benefits_register'] = status;
          if (status.status !== 'ok') {
            response._meta.partial = true;
          }
        })
    );
  }

  await Promise.all(tasks);
  clearTimeout(timer);

  return c.json(response);
});

// 6. Auto-Unified Resident with Deterministic Identity Matching & Analytics
app.get('/residents/:id/unified', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.text('resident ID is required', 400);
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 10000);

  try {
    const { resident, status: resStatus } = await residentClient.getResident(
      id,
      timeoutCtrl.signal
    );

    if (resStatus.status === 'not_found') {
      clearTimeout(timer);
      return c.text('resident not found', 404);
    }

    const response: AutoUnifiedResponse = {
      resident,
      benefits: null,
      identity_match: {
        outcome: 'unavailable',
        candidate_refs: [],
        evidence: [],
        catalogue_fetched_at_ms: 0,
      },
      _meta: {
        sources: {
          resident_index: resStatus,
        },
        partial: false,
      },
    };

    const { records, fresh, fetchedAtMs } = await catalogue.get(timeoutCtrl.signal);

    if (!records) {
      response._meta.sources['benefits_register'] = {
        status: 'unavailable',
        error_message: 'benefits catalogue unavailable',
        latency_ms: 0,
        circuit: breaker.stateString(),
      };
    } else {
      const benStatus: SourceStatus = {
        status: fresh ? 'ok' : 'stale',
        latency_ms: 0,
        circuit: breaker.stateString(),
      };
      if (!fresh) {
        benStatus.error_message = 'serving cached catalogue snapshot';
      }
      response._meta.sources['benefits_register'] = benStatus;

      // Deterministic 4-tier match
      const { matched, meta: matchMeta } = matchResidentToCatalogue(
        resident,
        records,
        fetchedAtMs
      );
      response.benefits = matched;
      response.identity_match = matchMeta;

      // Compute Advanced Analytics
      if (resident) {
        response.vulnerability = computeVulnerability(resident, matched);
        response.benefit_gaps = detectBenefitGaps(resident, matched);
        response.provenance_hash = generateProvenanceHash(
          resident.id,
          matched?.ref,
          matchMeta.evidence[0]?.rule,
          fetchedAtMs
        );
      }
    }

    const benefitsSource = response._meta.sources['benefits_register'];
    response._meta.partial =
      resStatus.status !== 'ok' || benefitsSource?.status !== 'ok';

    clearTimeout(timer);
    return c.json(response);
  } catch (err: any) {
    clearTimeout(timer);
    return c.text(`internal error: ${err.message}`, 500);
  }
});

// 7. Municipal Analytics Overview
app.get('/analytics/overview', async (c) => {
  const [resData, catData] = await Promise.all([
    residentClient.getResidents(),
    catalogue.get(),
  ]);

  const residents = resData.residents || [];
  const benefits = catData.records || [];

  let matchedCount = 0;
  let criticalCount = 0;
  let gapsCount = 0;

  for (const r of residents) {
    const { matched } = matchResidentToCatalogue(r, benefits, catData.fetchedAtMs);
    if (matched) matchedCount++;
    const vuln = computeVulnerability(r, matched);
    if (vuln.tier === 'critical') criticalCount++;
    const gaps = detectBenefitGaps(r, matched);
    if (gaps.length > 0) gapsCount++;
  }

  const households = buildHouseholdClusters(residents);

  return c.json({
    residents_total: residents.length,
    benefits_total: benefits.length,
    matches_count: matchedCount,
    match_rate_pct: residents.length ? Math.round((matchedCount / residents.length) * 100) : 0,
    critical_vulnerability_count: criticalCount,
    benefit_gap_count: gapsCount,
    household_clusters_count: households.size,
    circuit_state: breaker.stateString(),
    cache_entries_count: cache.size(),
  });
});

// 8. Household Clusters
app.get('/analytics/households', async (c) => {
  const { residents } = await residentClient.getResidents();
  const clusters = buildHouseholdClusters(residents);
  return c.json(Array.from(clusters.values()));
});

// 9. Dirty Data Benchmark & Success Rate
app.get('/api/benchmark', (c) => {
  const report = runDirtyDataBenchmark();
  return c.json(report);
});

// 10. AI Dossier Endpoints
app.post('/api/ai/dossier', async (c) => {
  const body: AutoUnifiedResponse = await c.req.json();
  const briefing = await aiAdvisor.generateDossier(body);
  return c.json({ briefing });
});

app.get('/api/ai/dossier/stream', async (c) => {
  const id = c.req.query('resident_id');
  if (!id) {
    return c.text('resident_id required', 400);
  }

  const { resident } = await residentClient.getResident(id);
  if (!resident) {
    return c.text('resident not found', 404);
  }

  const { records, fetchedAtMs } = await catalogue.get();
  const { matched, meta: matchMeta } = matchResidentToCatalogue(resident, records || [], fetchedAtMs);

  const autoUnified: AutoUnifiedResponse = {
    resident,
    benefits: matched,
    identity_match: matchMeta,
    vulnerability: computeVulnerability(resident, matched),
    benefit_gaps: detectBenefitGaps(resident, matched),
    _meta: { sources: {}, partial: false },
  };

  return streamSSE(c, async (stream) => {
    for await (const chunk of aiAdvisor.streamDossier(autoUnified)) {
      await stream.writeSSE({ data: chunk });
    }
    await stream.writeSSE({ data: '[DONE]' });
  });
});

// 11. AI Ambiguity Investigator
app.post('/api/ai/investigate', async (c) => {
  const body = await c.req.json();
  const { resident, candidates } = body;
  if (!resident || !candidates) {
    return c.text('resident and candidates are required', 400);
  }
  const explanation = await aiAdvisor.investigateAmbiguity(resident, candidates);
  return c.json({ explanation });
});

// 12. Circuit Breaker Admin Controls
app.get('/api/circuit', (c) => {
  return c.json({
    state: breaker.stateString(),
    failure_limit: breaker.failureLimit,
    cooldown_ms: breaker.cooldownMs,
  });
});

app.post('/api/circuit/trip', (c) => {
  breaker.trip();
  return c.json({ state: breaker.stateString(), message: 'Circuit manually tripped to OPEN' });
});

app.post('/api/circuit/reset', (c) => {
  breaker.reset();
  return c.json({ state: breaker.stateString(), message: 'Circuit manually reset to CLOSED' });
});

// 13. Frontend Static Assets
const webDir = join(import.meta.dir, 'web');

app.get('/', (c) => {
  const htmlPath = join(webDir, 'index.html');
  if (existsSync(htmlPath)) {
    return c.html(readFileSync(htmlPath, 'utf-8'));
  }
  return c.text('CivicBridge API running.');
});

app.get('/styles.css', (c) => {
  const cssPath = join(webDir, 'styles.css');
  if (existsSync(cssPath)) {
    c.header('Content-Type', 'text/css');
    return c.body(readFileSync(cssPath, 'utf-8'));
  }
  return c.notFound();
});

app.get('/app.js', async (c) => {
  const tsPath = join(webDir, 'app.ts');
  if (existsSync(tsPath)) {
    const build = await Bun.build({
      entrypoints: [tsPath],
      minify: false,
    });
    if (build.outputs[0]) {
      const code = await build.outputs[0].text();
      c.header('Content-Type', 'application/javascript');
      return c.body(code);
    }
  }
  return c.notFound();
});

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(`CivicBridge Unified System running on http://127.0.0.1:${port}`);
}

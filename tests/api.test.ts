import { describe, test, expect } from 'bun:test';
import server from '../src/server.ts';

describe('CivicBridge API Server Live Integration', () => {
  test('GET /health returns aggregate service health', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/health'));
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.status).toBeDefined();
    expect(body.sources.resident_index).toBeDefined();
    expect(body.sources.benefits_register).toBeDefined();
  });

  test('GET /residents/:id returns single resident', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/residents/R-10001'));
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.id).toBe('R-10001');
    expect(body.first_name).toBe('Ashley');
  });

  test('GET /residents/:id returns 404 when not found', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/residents/R-999999'));
    expect(res.status).toBe(404);
  });

  test('GET /benefits/* returns benefit record', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/benefits/CA/2016/4001'));
    // Might be 200 or 502 if upstream 40% failure rate exhausted retries
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      const body: any = await res.json();
      expect(body.ref).toBe('CA/2016/4001');
    }
  });

  test('GET /unified performs concurrent fan-out', async () => {
    const res = await server.fetch(
      new Request('http://localhost:8080/unified?resident_id=R-10001&benefit_ref=CA/2016/4001')
    );
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body._meta.sources.resident_index).toBeDefined();
    expect(body._meta.sources.benefits_register).toBeDefined();
  });

  test('GET /residents/:id/unified auto-resolves identity and computes analytics', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/residents/R-10001/unified'));
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.resident.id).toBe('R-10001');
    expect(body.identity_match).toBeDefined();
    expect(body.vulnerability).toBeDefined();
    expect(body._meta).toBeDefined();
  });

  test('circuit breaker admin endpoints trip and reset correctly', async () => {
    const tripRes = await server.fetch(
      new Request('http://localhost:8080/api/circuit/trip', { method: 'POST' })
    );
    expect(tripRes.status).toBe(200);
    const tripBody: any = await tripRes.json();
    expect(tripBody.state).toBe('open');

    const resetRes = await server.fetch(
      new Request('http://localhost:8080/api/circuit/reset', { method: 'POST' })
    );
    expect(resetRes.status).toBe(200);
    const resetBody: any = await resetRes.json();
    expect(resetBody.state).toBe('closed');
  });

  test('GET /analytics/overview returns municipal metrics', async () => {
    const res = await server.fetch(new Request('http://localhost:8080/analytics/overview'));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.residents_total).toBe(620);
    expect(body.household_clusters_count).toBeGreaterThan(0);
  });
});

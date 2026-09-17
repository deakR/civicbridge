import { describe, test, expect } from 'bun:test';
import { ResidentClient } from '../src/adapters/residents/client.ts';
import type { ResidentPage } from '../src/domain/models.ts';

describe('Dynamic Pagination & Deduplication Engine', () => {
  test('deduplicates across overlapping pages and counts duplicates', async () => {
    // Mock server returning overlapping pages
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');

        if (page === 1) {
          const body: ResidentPage = {
            page: 1,
            page_size: 2,
            total: 3,
            has_more: true,
            results: [
              {
                id: 'R-1',
                first_name: 'Ashley',
                last_name: 'Vance',
                date_of_birth: '1984-03-12',
                address_line: '14 Elm Rd',
                city: 'Calder',
                phone: '555-0100',
                program_status: 'Active',
                last_contact: '2026-01-01',
              },
              {
                id: 'R-2',
                first_name: 'Bob',
                last_name: 'Smith',
                date_of_birth: '1985-04-14',
                address_line: '22 Oak St',
                city: 'Calder',
                phone: '555-0101',
                program_status: 'Active',
                last_contact: '2026-01-01',
              },
            ],
          };
          return Response.json(body);
        }

        if (page === 2) {
          // Boundary slip: R-2 is returned again!
          const body: ResidentPage = {
            page: 2,
            page_size: 2,
            total: 3,
            has_more: false,
            results: [
              {
                id: 'R-2', // Duplicate from page 1!
                first_name: 'Bob',
                last_name: 'Smith',
                date_of_birth: '1985-04-14',
                address_line: '22 Oak St',
                city: 'Calder',
                phone: '555-0101',
                program_status: 'Active',
                last_contact: '2026-01-01',
              },
              {
                id: 'R-3',
                first_name: 'Charlie',
                last_name: 'Jones',
                date_of_birth: '1986-05-16',
                address_line: '33 Pine Ave',
                city: 'Calder',
                phone: '555-0102',
                program_status: 'Active',
                last_contact: '2026-01-01',
              },
            ],
          };
          return Response.json(body);
        }

        return Response.json({ page, page_size: 2, total: 3, has_more: false, results: [] });
      },
    });

    try {
      const client = new ResidentClient({ baseURL: `http://localhost:${server.port}` });
      const { residents, pagination, status } = await client.getResidents();

      expect(status.status).toBe('ok');
      expect(pagination.complete).toBe(true);
      expect(pagination.unique).toBe(3);
      expect(pagination.duplicates).toBe(1);
      expect(pagination.records_seen).toBe(4);
      expect(residents.map((r) => r.id)).toEqual(['R-1', 'R-2', 'R-3']);
    } finally {
      server.stop();
    }
  });

  test('aborts on pagination anomaly (empty page with has_more: true)', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        const body: ResidentPage = {
          page: 1,
          page_size: 25,
          total: 50,
          has_more: true,
          results: [], // Anomaly!
        };
        return Response.json(body);
      },
    });

    try {
      const client = new ResidentClient({ baseURL: `http://localhost:${server.port}` });
      const { pagination, status } = await client.getResidents();

      expect(status.status).toBe('unavailable');
      expect(pagination.complete).toBe(false);
      expect(pagination.reason).toBe('pagination_anomaly');
    } finally {
      server.stop();
    }
  });
});

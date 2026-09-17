import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = parseInt(process.env.RESIDENT_PORT || '8081');
const dataPath = join(import.meta.dir, '..', '..', 'services', '_rest_data.json');

interface ResidentRaw {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address_line: string;
  city: string;
  phone: string;
  program_status: string;
  last_contact: string;
  _pid?: number;
}

const rawData: ResidentRaw[] = existsSync(dataPath)
  ? JSON.parse(readFileSync(dataPath, 'utf-8')).map((r: any) => {
      const { _pid, ...rest } = r;
      return rest;
    })
  : [];

// Build pagination with realistic boundary slip anomalies
function buildUnstablePages(records: ResidentRaw[], size = 25): ResidentRaw[][] {
  const pages: ResidentRaw[][] = [];
  let i = 0;
  // Deterministic PRNG seed for reproducible test suites
  let seed = 97531;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  while (i < records.length) {
    const page = records.slice(i, i + size);
    pages.push(page);
    let step = size;
    if (i + size < records.length && rand() < 0.6) {
      step = size - (1 + Math.floor(rand() * 3)); // Boundary slips back by 1-3 records
    }
    i += step;
  }
  return pages;
}

const PAGES = buildUnstablePages(rawData, 25);

export const residentServer = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'resident-index',
        runtime: 'bun',
        records_loaded: rawData.length,
      });
    }

    if (url.pathname.startsWith('/residents/')) {
      const id = decodeURIComponent(url.pathname.slice('/residents/'.length));
      const found = rawData.find((r) => r.id === id);
      if (found) {
        return Response.json(found);
      }
      return Response.json({ error: 'not_found', id }, { status: 404 });
    }

    if (url.pathname === '/residents') {
      const page = parseInt(url.searchParams.get('page') || '1');
      if (isNaN(page) || page < 1) {
        return Response.json({ error: 'bad_page' }, { status: 400 });
      }

      if (page > PAGES.length) {
        return Response.json({
          page,
          page_size: 25,
          total: rawData.length,
          has_more: false,
          results: [],
        });
      }

      return Response.json({
        page,
        page_size: 25,
        total: rawData.length,
        has_more: page < PAGES.length,
        results: PAGES[page - 1] || [],
      });
    }

    return Response.json({ error: 'no_such_endpoint' }, { status: 404 });
  },
});

if (import.meta.main) {
  console.log(`[Bun] Resident Index Upstream running on http://127.0.0.1:${PORT}`);
  console.log(`  ${rawData.length} records across ${PAGES.length} paginated boundaries with dynamic slips`);
}

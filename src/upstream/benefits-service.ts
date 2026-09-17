import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = parseInt(process.env.BENEFITS_PORT || '8082');
const FAILURE_RATE = parseFloat(process.env.BENEFITS_FAILURE_RATE || '0.40');
const dataPath = join(import.meta.dir, '..', '..', 'services', '_xml_data.json');

interface BenefitRaw {
  ref: string;
  name: string;
  born: string;
  addr: string;
  town: string;
  benefit_code: string;
  review_due: string;
  _pid?: number;
}

const rawData: BenefitRaw[] = existsSync(dataPath)
  ? JSON.parse(readFileSync(dataPath, 'utf-8')).map((r: any) => {
      const { _pid, ...rest } = r;
      return rest;
    })
  : [];

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function recordsToXml(records: BenefitRaw[]): string {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<BenefitsRegister>'];
  for (const r of records) {
    parts.push('  <Record>');
    parts.push(`    <Ref>${escapeXml(r.ref)}</Ref>`);
    parts.push(`    <Name>${escapeXml(r.name)}</Name>`);
    parts.push(`    <Born>${escapeXml(r.born)}</Born>`);
    parts.push(`    <Addr>${escapeXml(r.addr)}</Addr>`);
    parts.push(`    <Town>${escapeXml(r.town)}</Town>`);
    parts.push(`    <BenefitCode>${escapeXml(r.benefit_code)}</BenefitCode>`);
    parts.push(`    <ReviewDue>${escapeXml(r.review_due)}</ReviewDue>`);
    parts.push('  </Record>');
  }
  parts.push('</BenefitsRegister>');
  return parts.join('\n');
}

const FAULT_500_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Fault><Code>SRV-500</Code><Message>Register temporarily unavailable. Retry.</Message></Fault>`;

const FAULT_404_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Fault><Code>SRV-404</Code><Message>No such record</Message></Fault>`;

export const benefitsServer = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return new Response('<?xml version="1.0"?><Health><Status>ok</Status></Health>', {
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    // Realistic legacy municipal latency (200ms - 800ms)
    const delay = 200 + Math.random() * 600;
    await Bun.sleep(delay);

    // Realistic 40% transient failure rate
    if (Math.random() < FAILURE_RATE) {
      return new Response(FAULT_500_XML, {
        status: 500,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (url.pathname.startsWith('/records/')) {
      const ref = decodeURIComponent(url.pathname.slice('/records/'.length));
      const found = rawData.find((r) => r.ref === ref);
      if (found) {
        return new Response(recordsToXml([found]), {
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return new Response(FAULT_404_XML, {
        status: 404,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (url.pathname === '/records') {
      return new Response(recordsToXml(rawData), {
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    return new Response(FAULT_404_XML, {
      status: 404,
      headers: { 'Content-Type': 'application/xml' },
    });
  },
});

if (import.meta.main) {
  console.log(`[Bun] Benefits Register Upstream (XML) running on http://127.0.0.1:${PORT}`);
  console.log(`  ${rawData.length} records | Failure rate: ${(FAILURE_RATE * 100).toFixed(0)}%`);
}

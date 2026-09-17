import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Resident, BenefitRecord } from '../src/domain/models.ts';
import { matchResidentToCatalogue } from '../src/domain/identity.ts';

interface RestRow extends Resident {
  _pid: number;
}

interface XmlRow extends BenefitRecord {
  _pid: number;
}

describe('Identity Matching Ground Truth Benchmark', () => {
  const restPath = join(import.meta.dir, '..', 'services', '_rest_data.json');
  const xmlPath = join(import.meta.dir, '..', 'services', '_xml_data.json');

  const restRows: RestRow[] = JSON.parse(readFileSync(restPath, 'utf-8'));
  const xmlRows: XmlRow[] = JSON.parse(readFileSync(xmlPath, 'utf-8'));

  const pidByRef = new Map<string, number>();
  const catalogue: BenefitRecord[] = xmlRows.map((r) => {
    pidByRef.set(r.ref, r._pid);
    return {
      ref: r.ref,
      name: r.name,
      born: r.born,
      addr: r.addr,
      town: r.town,
      benefit_code: r.benefit_code,
      review_due: r.review_due,
    };
  });

  const xmlPids = new Set(xmlRows.map((r) => r._pid));
  const overlap = restRows.filter((r) => xmlPids.has(r._pid)).length;

  test('dataset has overlapping ground truth records', () => {
    expect(overlap).toBe(340);
    expect(restRows.length).toBe(620);
    expect(catalogue.length).toBe(540);
  });

  test('achieves 100% precision with 0 wrong merges and 100% recall', () => {
    let matchedCorrect = 0;
    let matchedWrong = 0;
    let ambiguous = 0;
    let noMatch = 0;

    for (const row of restRows) {
      const resident: Resident = {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        date_of_birth: row.date_of_birth,
        address_line: row.address_line,
        city: row.city,
        phone: row.phone,
        program_status: row.program_status,
        last_contact: row.last_contact,
      };

      const { meta } = matchResidentToCatalogue(resident, catalogue, Date.now());

      switch (meta.outcome) {
        case 'matched': {
          const truePid = pidByRef.get(meta.matched_ref!);
          if (truePid === row._pid) {
            matchedCorrect++;
          } else {
            matchedWrong++;
          }
          break;
        }
        case 'ambiguous':
          ambiguous++;
          break;
        case 'no_match':
          noMatch++;
          break;
        default:
          throw new Error(`Unexpected outcome: ${meta.outcome}`);
      }
    }

    expect(matchedWrong).toBe(0); // Zero wrong merges!
    expect(matchedCorrect).toBe(340); // 100% recall of true pairs!
    expect(noMatch).toBe(280);
    expect(ambiguous).toBe(0);
  });
});

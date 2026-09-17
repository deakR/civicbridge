import { describe, test, expect } from 'bun:test';
import type { Resident, BenefitRecord } from '../src/domain/models.ts';
import { matchResidentToCatalogue } from '../src/domain/identity.ts';
import { normalizeName, normalizeStreet, normalizeTown, parseLegacyName, soundex } from '../src/domain/normalizers.ts';

describe('Identity Tier Verification & Guardrails', () => {
  const catalogue: BenefitRecord[] = [
    {
      ref: 'CA/2016/4001',
      name: 'Vance, Ashley',
      born: '1984-03-12',
      addr: '14 Elm Road',
      town: 'Calder',
      benefit_code: 'HSP-A',
      review_due: '2026-10-01',
    },
    {
      ref: 'CA/2018/9002',
      name: 'Vance, Ashley',
      born: '1990-07-22',
      addr: '14 Elm Rd',
      town: 'Calder',
      benefit_code: 'DIS-1',
      review_due: '2026-11-15',
    },
    {
      ref: 'CA/2020/5555',
      name: 'Vance, Ashley',
      born: '1990-07-22',
      addr: '14 Elm Rd',
      town: 'Calder',
      benefit_code: 'DIS-2',
      review_due: '2026-11-15',
    },
  ];

  test('Tier 1 matches exact DOB and name', () => {
    const resident: Resident = {
      id: 'R-1',
      first_name: 'Ashley',
      last_name: 'Vance',
      date_of_birth: '1984-03-12',
      address_line: '99 Other St',
      city: 'Elsewhere',
      phone: '555-0100',
      program_status: 'Active',
      last_contact: '2026-01-01',
    };

    const { matched, meta } = matchResidentToCatalogue(resident, catalogue, Date.now());
    expect(meta.outcome).toBe('matched');
    expect(matched?.ref).toBe('CA/2016/4001');
    expect(meta.evidence[0].rule).toBe('exact_dob_and_name');
  });

  test('Tier 2 matches name, town, and street when DOB differs', () => {
    const resident: Resident = {
      id: 'R-2',
      first_name: 'Ashley',
      last_name: 'Vance',
      date_of_birth: '1984-01-01', // Different DOB from CA/2016/4001
      address_line: '14 Elm Avenue', // Normalized matches 14 Elm Rd? No, let's test exact street
      city: 'Calder',
      phone: '555-0101',
      program_status: 'Active',
      last_contact: '2026-01-01',
    };

    // CA/2016/4001 has addr: '14 Elm Road' which normalizes to '14elmrd'
    // resident with '14 Elm Rd' matches Tier 2
    resident.address_line = '14 Elm Rd';
    const { matched, meta } = matchResidentToCatalogue(resident, catalogue.slice(0, 1), Date.now());
    expect(meta.outcome).toBe('matched');
    expect(matched?.ref).toBe('CA/2016/4001');
    expect(meta.evidence.some((e) => e.rule === 'name_town_street')).toBe(true);
  });

  test('Ambiguous tie declines to merge', () => {
    const resident: Resident = {
      id: 'R-3',
      first_name: 'Ashley',
      last_name: 'Vance',
      date_of_birth: '1990-07-22',
      address_line: '14 Elm Rd',
      city: 'Calder',
      phone: '555-0102',
      program_status: 'Active',
      last_contact: '2026-01-01',
    };

    // Two candidates match identically on Tier 1 (CA/2018/9002 & CA/2020/5555)
    const { matched, meta } = matchResidentToCatalogue(resident, catalogue, Date.now());
    expect(meta.outcome).toBe('ambiguous');
    expect(matched).toBeNull();
    expect(meta.candidateRefs).toEqual(['CA/2018/9002', 'CA/2020/5555']);
  });

  test('No match reports all tried tiers in evidence', () => {
    const resident: Resident = {
      id: 'R-4',
      first_name: 'Nonexistent',
      last_name: 'Person',
      date_of_birth: '1970-01-01',
      address_line: '1 Unknown Lane',
      city: 'Nowhere',
      phone: '555-0103',
      program_status: 'Active',
      last_contact: '2026-01-01',
    };

    const { matched, meta } = matchResidentToCatalogue(resident, catalogue, Date.now());
    expect(meta.outcome).toBe('no_match');
    expect(matched).toBeNull();
    expect(meta.evidence.length).toBeGreaterThanOrEqual(2);
  });

  test('Empty catalogue returns unavailable', () => {
    const resident: Resident = {
      id: 'R-5',
      first_name: 'Ashley',
      last_name: 'Vance',
      date_of_birth: '1984-03-12',
      address_line: '14 Elm Rd',
      city: 'Calder',
      phone: '555-0100',
      program_status: 'Active',
      last_contact: '2026-01-01',
    };

    const { matched, meta } = matchResidentToCatalogue(resident, [], Date.now());
    expect(meta.outcome).toBe('unavailable');
    expect(matched).toBeNull();
  });

  test('Normalizers handle casing, punctuation, and suffixes', () => {
    expect(normalizeName("  O'Connor-Smith  ")).toBe('oconnorsmith');
    expect(normalizeTown('  Calder County! ')).toBe('caldercounty');
    expect(normalizeStreet('123 High Street, Apt 4')).toBe('123highstapt4');
    expect(parseLegacyName('Vance, Ashley')).toEqual({ last: 'vance', first: 'ashley' });
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
  });
});

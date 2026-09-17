import { describe, test, expect } from 'bun:test';
import type { Resident, BenefitRecord } from '../src/domain/models.ts';
import { computeVulnerability, detectBenefitGaps, buildHouseholdClusters } from '../src/domain/analytics.ts';
import { generateProvenanceHash } from '../src/domain/provenance.ts';

describe('Municipal Analytics & Intelligence', () => {
  test('computes vulnerability profile with risk tiers and drivers', () => {
    const resident: Resident = {
      id: 'R-100',
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '1960-05-15',
      address_line: '12 Main St',
      city: 'Calder',
      phone: '555-0199',
      program_status: 'Urgent Intervention Needed',
      last_contact: '2024-01-01',
    };

    const benefit: BenefitRecord = {
      ref: 'CA/2017/1000',
      name: 'Doe, John',
      born: '1960-05-15',
      addr: '12 Main St',
      town: 'Calder',
      benefit_code: 'HSP-A',
      review_due: '2024-05-01', // Past due
    };

    const profile = computeVulnerability(resident, benefit);
    expect(profile.score).toBeGreaterThanOrEqual(75);
    expect(profile.tier).toBe('critical');
    expect(profile.review_urgent).toBe(true);
    expect(profile.contact_stale).toBe(true);
    expect(profile.factors.length).toBeGreaterThanOrEqual(3);
  });

  test('detects benefit gaps for assisted residents without active benefits', () => {
    const resident: Resident = {
      id: 'R-101',
      first_name: 'Jane',
      last_name: 'Smith',
      date_of_birth: '1995-10-10',
      address_line: '45 Park Ave',
      city: 'Calder',
      phone: '555-0200',
      program_status: 'Housing Support',
      last_contact: '2026-08-01',
    };

    const gaps = detectBenefitGaps(resident, null);
    expect(gaps.length).toBe(1);
    expect(gaps[0].missing_entitlement).toContain('Benefit Claim');
  });

  test('clusters residents into households by canonical dwelling key', () => {
    const residents: Resident[] = [
      {
        id: 'R-201',
        first_name: 'Alice',
        last_name: 'Green',
        date_of_birth: '1980-01-01',
        address_line: '100 Maple Road',
        city: 'Calder',
        phone: '555-1111',
        program_status: 'Active',
        last_contact: '2026-01-01',
      },
      {
        id: 'R-202',
        first_name: 'Bob',
        last_name: 'Green',
        date_of_birth: '1982-02-02',
        address_line: '100 Maple Rd', // Suffix variant
        city: 'Calder',
        phone: '555-2222',
        program_status: 'Active',
        last_contact: '2026-01-01',
      },
      {
        id: 'R-203',
        first_name: 'Charlie',
        last_name: 'Brown',
        date_of_birth: '1990-03-03',
        address_line: '200 Oak St',
        city: 'Calder',
        phone: '555-3333',
        program_status: 'Active',
        last_contact: '2026-01-01',
      },
    ];

    const clusters = buildHouseholdClusters(residents);
    const mapleCluster = clusters.get('calder::100maplerd');
    expect(mapleCluster).toBeDefined();
    expect(mapleCluster?.occupant_count).toBe(2);
    expect(mapleCluster?.occupant_ids).toContain('R-201');
    expect(mapleCluster?.occupant_ids).toContain('R-202');
  });

  test('generates deterministic SHA-256 provenance hash', () => {
    const hash1 = generateProvenanceHash('R-1', 'CA/1', 'tierA', 1700000000);
    const hash2 = generateProvenanceHash('R-1', 'CA/1', 'tierA', 1700000000);
    const hash3 = generateProvenanceHash('R-2', 'CA/1', 'tierA', 1700000000);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64);
  });
});

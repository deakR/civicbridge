import { describe, test, expect } from 'bun:test';
import { MunicipalAIAdvisor } from '../src/ai/advisor.ts';
import { GroqClient } from '../src/ai/client.ts';
import type { AutoUnifiedResponse } from '../src/domain/models.ts';

describe('Municipal AI Advisor & Offline Fallback', () => {
  const dummyUnified: AutoUnifiedResponse = {
    resident: {
      id: 'R-999',
      first_name: 'Elena',
      last_name: 'Rostova',
      date_of_birth: '1975-08-20',
      address_line: '88 River Rd',
      city: 'Calder',
      phone: '555-9988',
      program_status: 'Housing Support',
      last_contact: '2025-01-10',
    },
    benefits: {
      ref: 'CA/2021/8800',
      name: 'Rostova, Elena',
      born: '1975-08-20',
      addr: '88 River Rd',
      town: 'Calder',
      benefit_code: 'HSP-A',
      review_due: '2026-09-01',
    },
    identity_match: {
      outcome: 'matched',
      matched_ref: 'CA/2021/8800',
      candidate_refs: ['CA/2021/8800'],
      evidence: [{ rule: 'exact_dob_and_name' }],
      catalogue_fetched_at_ms: Date.now(),
    },
    vulnerability: {
      score: 85,
      tier: 'critical',
      factors: ['Imminent or past-due benefit review', 'Contact stale'],
      review_urgent: true,
      contact_stale: true,
    },
    benefit_gaps: [
      {
        program_status: 'Housing Support',
        missing_entitlement: 'Overdue Benefit Renewal (HSP-A)',
        description: 'Active benefit has past-due review.',
        action_recommended: 'Send renewal notice.',
      },
    ],
    _meta: {
      sources: {
        resident_index: { status: 'ok', latency_ms: 10 },
        benefits_register: { status: 'ok', latency_ms: 50 },
      },
      partial: false,
    },
  };

  test('generates structured heuristic caseworker dossier offline', async () => {
    // Client with no API key -> tests offline heuristic fallback
    const client = new GroqClient('disabled_key');
    const advisor = new MunicipalAIAdvisor(client);

    const dossier = await advisor.generateDossier(dummyUnified);
    expect(dossier).toContain('Elena Rostova');
    expect(dossier).toContain('CRITICAL');
    expect(dossier).toContain('85/100');
    expect(dossier).toContain('HSP-A');
    expect(dossier).toContain('Recommended Caseworker Action');
  });

  test('investigates tied candidates offline with clear resolution steps', async () => {
    const advisor = new MunicipalAIAdvisor(new GroqClient('disabled_key'));
    const resident = dummyUnified.resident!;
    const candidates = [
      dummyUnified.benefits!,
      {
        ...dummyUnified.benefits!,
        ref: 'CA/2021/8801',
      },
    ];

    const result = await advisor.investigateAmbiguity(resident, candidates);
    expect(result).toContain('2 identical candidates');
    expect(result).toContain('CA/2021/8800');
    expect(result).toContain('CA/2021/8801');
    expect(result).toContain('Caseworker Action');
  });

  test('groq client accurately detects whether an active key is present', () => {
    const emptyClient = new GroqClient('');
    expect(emptyClient.hasApiKey()).toBe(false);

    const placeholderClient = new GroqClient('your_groq_api_key_here');
    expect(placeholderClient.hasApiKey()).toBe(false);

    const activeClient = new GroqClient('gsk_test_123');
    expect(activeClient.hasApiKey()).toBe(true);
  });
});

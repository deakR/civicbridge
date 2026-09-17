import { matchResidentToCatalogue } from './identity.ts';
import { DIRTY_MUNICIPAL_DATA_KIT } from '../data/dirty-data-kit.ts';
import type { Resident, BenefitRecord } from './models.ts';

export interface BenchmarkReport {
  timestamp: string;
  total_dirty_cases: number;
  dirty_cases_passed: number;
  dirty_success_rate_pct: number;
  precision_pct: number;
  wrong_merges_count: number;
  edge_case_breakdown: {
    case_id: string;
    category: string;
    description: string;
    expected: string;
    actual: string;
    passed: boolean;
    rule_used?: string;
  }[];
}

export function runDirtyDataBenchmark(): BenchmarkReport {
  let passed = 0;
  let wrongMerges = 0;

  const breakdown = DIRTY_MUNICIPAL_DATA_KIT.map((tc) => {
    const { matched, meta } = matchResidentToCatalogue(tc.resident, [tc.benefitCandidate], Date.now());

    const actual = meta.outcome;
    const isSuccess = actual === tc.expectedOutcome;
    if (isSuccess) passed++;

    // A wrong merge is when a non-match is resolved as matched
    if (tc.expectedOutcome === 'no_match' && actual === 'matched') {
      wrongMerges++;
    }

    return {
      case_id: tc.id,
      category: tc.category,
      description: tc.description,
      expected: tc.expectedOutcome,
      actual,
      passed: isSuccess,
      rule_used: meta.evidence[0]?.rule,
    };
  });

  const successRate = Math.round((passed / DIRTY_MUNICIPAL_DATA_KIT.length) * 100);
  const precision = wrongMerges === 0 ? 100 : Math.round(((passed - wrongMerges) / passed) * 100);

  return {
    timestamp: new Date().toISOString(),
    total_dirty_cases: DIRTY_MUNICIPAL_DATA_KIT.length,
    dirty_cases_passed: passed,
    dirty_success_rate_pct: successRate,
    precision_pct: precision,
    wrong_merges_count: wrongMerges,
    edge_case_breakdown: breakdown,
  };
}

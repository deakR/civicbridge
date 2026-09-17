import { describe, test, expect } from 'bun:test';
import { runDirtyDataBenchmark } from '../src/domain/benchmark.ts';

describe('Dirty Data Kit & Anomaly Resolution Benchmark', () => {
  test('resolves real-world dirty data anomalies with 100% precision', () => {
    const report = runDirtyDataBenchmark();

    expect(report.total_dirty_cases).toBeGreaterThan(0);
    expect(report.dirty_success_rate_pct).toBe(100);
    expect(report.precision_pct).toBe(100);
    expect(report.wrong_merges_count).toBe(0);

    for (const item of report.edge_case_breakdown) {
      expect(item.passed).toBe(true);
    }
  });
});

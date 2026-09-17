import { createHash } from 'node:crypto';

export function generateProvenanceHash(
  residentId: string,
  benefitRef: string | undefined,
  ruleUsed: string | undefined,
  timestampMs: number
): string {
  const payload = `${residentId}|${benefitRef || 'none'}|${ruleUsed || 'none'}|${timestampMs}`;
  return createHash('sha256').update(payload).digest('hex');
}

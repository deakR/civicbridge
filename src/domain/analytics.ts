import type { Resident, BenefitRecord, VulnerabilityProfile, BenefitGap, HouseholdCluster } from './models.ts';
import { normalizeStreet, normalizeTown } from './normalizers.ts';

export function computeVulnerability(
  resident: Resident,
  benefit: BenefitRecord | null
): VulnerabilityProfile {
  let score = 10;
  const factors: string[] = [];
  let reviewUrgent = false;
  let contactStale = false;

  const status = (resident.program_status || '').toLowerCase();
  if (status.includes('risk') || status.includes('pending') || status.includes('urgent')) {
    score += 30;
    factors.push(`Critical program status: ${resident.program_status}`);
  } else if (status.includes('assisted') || status.includes('support')) {
    score += 15;
    factors.push(`Assisted program status: ${resident.program_status}`);
  }

  if (resident.last_contact) {
    const contactDate = new Date(resident.last_contact);
    const now = new Date();
    const daysSinceContact = Math.floor((now.getTime() - contactDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceContact > 180 || isNaN(daysSinceContact)) {
      score += 20;
      contactStale = true;
      factors.push(`Contact stale (>180 days since last contact: ${resident.last_contact})`);
    }
  } else {
    score += 25;
    contactStale = true;
    factors.push('No documented municipal contact timestamp');
  }

  if (benefit) {
    if (benefit.review_due) {
      const reviewDate = new Date(benefit.review_due);
      const now = new Date();
      const daysUntilReview = Math.floor((reviewDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilReview < 30 || isNaN(daysUntilReview)) {
        score += 30;
        reviewUrgent = true;
        factors.push(`Imminent or past-due benefit review: ${benefit.review_due}`);
      }
    }
  } else if (status.includes('risk') || status.includes('support')) {
    score += 20;
    factors.push('High-need program status without active benefits register record');
  }

  score = Math.min(100, Math.max(0, score));

  let tier: VulnerabilityProfile['tier'] = 'low';
  if (score >= 75) tier = 'critical';
  else if (score >= 50) tier = 'high';
  else if (score >= 25) tier = 'moderate';

  return {
    score,
    tier,
    factors,
    review_urgent: reviewUrgent,
    contact_stale: contactStale,
  };
}

export function detectBenefitGaps(
  resident: Resident,
  benefit: BenefitRecord | null
): BenefitGap[] {
  const gaps: BenefitGap[] = [];
  const status = (resident.program_status || '').toLowerCase();

  if (!benefit) {
    if (status.includes('risk') || status.includes('support') || status.includes('assisted')) {
      gaps.push({
        program_status: resident.program_status,
        missing_entitlement: 'Unregistered Municipal Benefit Claim',
        description: `Resident is enrolled in municipal ${resident.program_status} but has no matched claims in the Benefits Register.`,
        action_recommended: 'Initiate benefits intake review and verify entitlement eligibility.',
      });
    }
  } else if (benefit.review_due) {
    const reviewDate = new Date(benefit.review_due);
    const now = new Date();
    if (reviewDate < now) {
      gaps.push({
        program_status: resident.program_status,
        missing_entitlement: `Overdue Benefit Renewal (${benefit.benefit_code})`,
        description: `Active benefit code ${benefit.benefit_code} had review due on ${benefit.review_due} and is at risk of lapse.`,
        action_recommended: 'Dispatch urgent renewal notice to resident address.',
      });
    }
  }

  return gaps;
}

export function buildHouseholdClusters(residents: Resident[]): Map<string, HouseholdCluster> {
  const clusters = new Map<string, HouseholdCluster>();

  for (const r of residents) {
    const street = normalizeStreet(r.address_line);
    const town = normalizeTown(r.city);
    if (!street || !town) continue;

    const key = `${town}::${street}`;
    const existing = clusters.get(key);

    if (existing) {
      existing.occupant_ids.push(r.id);
      existing.occupant_count = existing.occupant_ids.length;
    } else {
      clusters.set(key, {
        dwelling_key: key,
        address: r.address_line,
        town: r.city,
        occupant_ids: [r.id],
        occupant_count: 1,
      });
    }
  }

  return clusters;
}

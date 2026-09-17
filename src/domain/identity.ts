import type { Resident, BenefitRecord, IdentityMatchMeta, IdentityEvidence, IdentityOutcome } from './models.ts';
import { normalizeName, normalizeTown, normalizeStreet, parseLegacyName, soundex } from './normalizers.ts';

interface MatchCandidate {
  record: BenefitRecord;
  dob: string;
  last: string;
  first: string;
  town: string;
  street: string;
  firstSoundex: string;
  lastSoundex: string;
}

function resolveTier(
  rule: string,
  tier: MatchCandidate[],
  residentValue: string,
  benefitValue: (c: MatchCandidate) => string
): { outcome: IdentityOutcome; matched: MatchCandidate | null; evidence: IdentityEvidence[] } {
  if (tier.length === 1) {
    return {
      outcome: 'matched',
      matched: tier[0],
      evidence: [
        {
          rule,
          residentValue,
          benefitValue: benefitValue(tier[0]),
        },
      ],
    };
  }

  if (tier.length > 1) {
    return {
      outcome: 'ambiguous',
      matched: null,
      evidence: [
        {
          rule,
          residentValue,
          result: `${tier.length} candidates matched identically; declining to merge`,
        },
      ],
    };
  }

  return {
    outcome: 'no_match',
    matched: null,
    evidence: [
      {
        rule,
        residentValue,
        result: '0 candidates',
      },
    ],
  };
}

export function matchResidentToCatalogue(
  resident: Resident | null,
  catalogue: BenefitRecord[],
  catalogueFetchedAtMs: number
): { matched: BenefitRecord | null; meta: IdentityMatchMeta } {
  const meta: IdentityMatchMeta = {
    outcome: 'unavailable',
    candidateRefs: [],
    evidence: [],
    catalogueFetchedAtMs,
  };

  if (!catalogue || catalogue.length === 0) {
    return { matched: null, meta };
  }

  meta.outcome = 'no_match';

  if (!resident) {
    return { matched: null, meta };
  }

  const rLast = normalizeName(resident.last_name);
  const rFirst = normalizeName(resident.first_name);
  const rDOB = (resident.date_of_birth || '').trim();
  const rTown = normalizeTown(resident.city);
  const rStreet = normalizeStreet(resident.address_line);

  const nameUsable = rFirst !== '' || rLast !== '';

  const candidates: MatchCandidate[] = catalogue.map((b) => {
    const { last, first } = parseLegacyName(b.name);
    return {
      record: b,
      dob: (b.born || '').trim(),
      last,
      first,
      town: normalizeTown(b.town),
      street: normalizeStreet(b.addr),
      firstSoundex: soundex(first),
      lastSoundex: soundex(last),
    };
  });

  // Tier 1: Exact DOB and Full Name
  if (nameUsable && rDOB !== '') {
    const tierA = candidates.filter(
      (c) => c.dob === rDOB && c.first === rFirst && c.last === rLast
    );

    const { outcome, matched, evidence } = resolveTier(
      'exact_dob_and_name',
      tierA,
      `${rDOB} | ${rFirst} ${rLast}`,
      (c) => `${c.dob} | ${c.first} ${c.last}`
    );

    meta.evidence.push(...evidence);

    if (outcome === 'matched' && matched) {
      meta.outcome = 'matched';
      meta.matched_ref = matched.record.ref;
      meta.candidateRefs = [matched.record.ref];
      return { matched: matched.record, meta };
    }

    if (outcome === 'ambiguous') {
      meta.outcome = 'ambiguous';
      meta.candidateRefs = tierA.map((c) => c.record.ref);
      return { matched: null, meta };
    }
  }

  // Tier 2: Full Name, Town, and Normalized Street
  if (nameUsable && rFirst !== '' && rLast !== '' && rTown !== '' && rStreet !== '') {
    const tierB = candidates.filter(
      (c) => c.first === rFirst && c.last === rLast && c.town === rTown && c.street === rStreet
    );

    const { outcome, matched, evidence } = resolveTier(
      'name_town_street',
      tierB,
      `${rFirst} ${rLast} | ${rTown} | ${rStreet}`,
      (c) => `${c.first} ${c.last} | ${c.town} | ${c.street}`
    );

    meta.evidence.push(...evidence);

    if (outcome === 'matched' && matched) {
      meta.outcome = 'matched';
      meta.matched_ref = matched.record.ref;
      meta.candidateRefs = [matched.record.ref];
      return { matched: matched.record, meta };
    }

    if (outcome === 'ambiguous') {
      meta.outcome = 'ambiguous';
      meta.candidateRefs = tierB.map((c) => c.record.ref);
      return { matched: null, meta };
    }
  }

  // Tier 3: High-Confidence DOB + Phonetic Name + Town (Disambiguated)
  if (rDOB !== '' && rTown !== '' && rFirst !== '' && rLast !== '') {
    const rFirstSdx = soundex(rFirst);
    const rLastSdx = soundex(rLast);

    const tierC = candidates.filter(
      (c) =>
        c.dob === rDOB &&
        c.town === rTown &&
        c.firstSoundex === rFirstSdx &&
        c.lastSoundex === rLastSdx
    );

    if (tierC.length > 0) {
      const { outcome, matched, evidence } = resolveTier(
        'phonetic_name_dob_town',
        tierC,
        `${rDOB} | Sdx(${rFirstSdx}, ${rLastSdx}) | ${rTown}`,
        (c) => `${c.dob} | Sdx(${c.firstSoundex}, ${c.lastSoundex}) | ${c.town}`
      );

      meta.evidence.push(...evidence);

      if (outcome === 'matched' && matched) {
        meta.outcome = 'matched';
        meta.matched_ref = matched.record.ref;
        meta.candidateRefs = [matched.record.ref];
        return { matched: matched.record, meta };
      }

      if (outcome === 'ambiguous') {
        meta.outcome = 'ambiguous';
        meta.candidateRefs = tierC.map((c) => c.record.ref);
        return { matched: null, meta };
      }
    }
  }

  return { matched: null, meta };
}

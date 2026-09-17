export interface Resident {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address_line: string;
  city: string;
  phone: string;
  program_status: string;
  last_contact: string;
}

export interface BenefitRecord {
  ref: string;
  name: string;
  born: string;
  addr: string;
  town: string;
  benefit_code: string;
  review_due: string;
}

export type SourceStatusCode = 'ok' | 'unavailable' | 'not_found' | 'circuit_open' | 'stale';

export interface SourceStatus {
  status: SourceStatusCode;
  http_code?: number;
  latency_ms: number;
  error_message?: string;
  circuit?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  sources: Record<string, SourceStatus>;
  uptime_seconds: number;
  timestamp: string;
  version: string;
}

export interface UnifiedMeta {
  sources: Record<string, SourceStatus>;
  partial: boolean;
  provenance_hash?: string;
}

export interface UnifiedResponse {
  resident: Resident | null;
  benefits: BenefitRecord | null;
  _meta: UnifiedMeta;
}

export interface ResidentPage {
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  results: Resident[];
}

export interface PaginationStatus {
  pages_fetched: number;
  records_seen: number;
  duplicates: number;
  conflicts: number;
  unique: number;
  reported_total: number;
  complete: boolean;
  reason?: string;
}

export interface ResidentListResponse {
  residents: Resident[];
  pagination: PaginationStatus;
  _meta: UnifiedMeta;
}

export type IdentityOutcome = 'matched' | 'ambiguous' | 'no_match' | 'unavailable';

export interface IdentityEvidence {
  rule: string;
  resident_value?: string;
  benefit_value?: string;
  result?: string;
}

export interface IdentityMatchMeta {
  outcome: IdentityOutcome;
  matched_ref?: string;
  candidate_refs: string[];
  evidence: IdentityEvidence[];
  catalogue_fetched_at_ms: number;
}

export interface VulnerabilityProfile {
  score: number;
  tier: 'low' | 'moderate' | 'high' | 'critical';
  factors: string[];
  review_urgent: boolean;
  contact_stale: boolean;
}

export interface BenefitGap {
  program_status: string;
  missing_entitlement: string;
  description: string;
  action_recommended: string;
}

export interface HouseholdCluster {
  dwelling_key: string;
  address: string;
  town: string;
  occupant_ids: string[];
  occupant_count: number;
}

export interface AutoUnifiedResponse {
  resident: Resident | null;
  benefits: BenefitRecord | null;
  identity_match: IdentityMatchMeta;
  vulnerability?: VulnerabilityProfile;
  benefit_gaps?: BenefitGap[];
  household?: HouseholdCluster;
  provenance_hash?: string;
  _meta: UnifiedMeta;
}

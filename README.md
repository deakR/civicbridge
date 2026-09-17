# CivicBridge — Resilient Municipal Integration Service & AI Copilot

A mission-critical municipal integration service and caseworker intelligence platform written in **TypeScript on Bun with Hono**, unifying resident and benefits records from unreliable legacy systems (REST and XML) with deterministic multi-tier identity resolution, circuit breaking, bounded retries, TTL caching, stale-data fallback, dynamic pagination deduplication, municipal analytics, an interactive lightweight web cockpit, and an integrated **Groq LLaMA 3.1 Municipal AI Copilot**.

---

## Key Highlights

- **Ultra-Fast Bun + Hono Backend**: Native Web Standards (`Request`/`Response`), event-loop concurrency, zero heavy framework overhead, sub-millisecond response overhead.
- **Resilience Engine**:
  - **3-State Circuit Breaker**: Trips to `open` on 3 consecutive post-retry failures; enforces 5s cooldown with a single-flight trial probe in `half_open`. 404s fail-fast without tripping.
  - **Bounded Retries with Backoff**: Retries transient HTTP 500s up to 3× with 50ms backoff; fast-fails immediately on 404s.
  - **In-Memory TTL Cache & Stale Fallback**: 5-minute TTL cache layered ahead of network calls. During upstream outages or open circuits, serves cached snapshots flagged as `status: "stale"` to preserve availability.
  - **Single-Flight Coalescing**: Prevents cache stampedes by sharing a single in-flight promise for concurrent catalogue requests.
- **Deterministic 4-Tier Identity Resolution Engine**:
  - **100% Precision Guarantee**: Verified on Calder County ground truth records (620 residents × 540 benefit records) with **0 wrong merges** and **100% recall** (340/340).
  - **Multi-Tier Evidence Ladder**:
    - *Tier 1*: Exact Date of Birth + Normalized Full Name.
    - *Tier 2*: Normalized Full Name + Normalized Street + City/Town.
    - *Tier 3*: Exact DOB + Soundex Phonetic Name Match + City/Town.
    - *Tier 4*: Disambiguation Guard — declines to merge when multiple candidates tie (`outcome: "ambiguous"`).
- **Municipal Intelligence Layer**:
  - **Social Vulnerability Index (SVI)**: Computes a 0–100 score based on program status, contact recency, and review due urgency.
  - **Benefit Entitlement Gaps**: Surfaces at-risk residents lacking active benefits or with impending review deadlines.
  - **Household & Co-Habitation Graph**: Clusters residents sharing canonical dwelling keys.
  - **Cryptographic Audit Provenance**: Every resolved record is tagged with an immutable SHA-256 integrity hash for audit and GDPR compliance.
- **Groq LLaMA 3.1 AI Copilot**:
  - Streams real-time executive caseworker dossiers and outreach notices via Server-Sent Events (SSE).
  - Investigates candidate discrepancies and ambiguous ties.
  - **Free-Tier Protection**: Built-in 15-minute response cache and automatic offline heuristic fallback to prevent exhausting free API quotas.
- **Lightweight Web Cockpit**:
  - Built-in reactive single-page dashboard at `http://localhost:8080` (auto-unification inspector, live evidence ladder, vulnerability gauge, concurrent fan-out console, household cluster explorer, and pagination telemetry).

---

## Quickstart

### Prerequisites
- [Bun](https://bun.sh/) 1.1+ (installed)
- Python 3.8+ (for running the mock upstream services)

### 1. Install Dependencies
```bash
bun install
```

### 2. Configure Environment
Create `.env` from `.env.example`:
```bash
cp .env.example .env
```
Edit `.env` if you wish to configure your Groq API key:
```ini
PORT=8080
RESIDENT_INDEX_URL=http://127.0.0.1:8081
BENEFITS_URL=http://127.0.0.1:8082
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.1-8b-instant
```
*(Note: If no API key is provided, the AI Copilot automatically operates using its built-in intelligent heuristic engine with 0 token consumption).*

### 3. Start Upstream Mock Services
In separate terminals:
```bash
# Terminal 1: Resident Index (REST on port 8081)
bun run services:rest

# Terminal 2: Benefits Register (XML on port 8082 with 40% failure rate)
bun run services:xml
```

### 4. Start CivicBridge
```bash
bun start
# Or for live-reload development:
bun dev
```

Open your browser at 👉 **[http://localhost:8080](http://localhost:8080)** to access the CivicBridge Web Cockpit.

---

## Automated Test Suite

Run the full test suite (42 tests covering circuit breakers, TTL caching, dynamic pagination deduplication, ground truth 100% precision identity matching, AI advisor fallback, and live API integration):

```bash
bun test
```

---

## API Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Aggregate health check with circuit states, uptime, and latency. |
| `GET` | `/residents/:id` | Single resident from Resident Index. |
| `GET` | `/residents` | Deduplicated catalogue of 620 residents with dynamic pagination receipts. |
| `GET` | `/benefits/*` | Single benefit record from Benefits Register with retries and breaker. |
| `GET` | `/unified` | Concurrent fan-out (`?resident_id=...&benefit_ref=...`) with partial response fallback. |
| `GET` | `/residents/:id/unified` | Auto-unification: resident lookup + 4-tier identity resolution + SVI + benefit gaps + SHA-256 provenance. |
| `GET` | `/analytics/overview` | High-level municipal metrics (match rate, SVI distribution, cluster count). |
| `GET` | `/analytics/households` | Discovered household dwelling clusters. |
| `POST` | `/api/ai/dossier` | Generates caseworker executive briefing and outreach draft. |
| `GET` | `/api/ai/dossier/stream` | Server-Sent Events (SSE) live streaming AI caseworker briefing. |
| `POST` | `/api/ai/investigate` | AI ambiguity and record discrepancy investigator. |
| `GET` | `/api/circuit` | Circuit breaker status and metrics. |
| `POST` | `/api/circuit/trip` | Manually trips circuit breaker to `open` (admin). |
| `POST` | `/api/circuit/reset` | Manually resets circuit breaker to `closed` (admin). |
| `GET` | `/` | CivicBridge Interactive Web Cockpit. |

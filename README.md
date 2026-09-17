# CivicBridge — Resilient Municipal Integration Service & AI Copilot

A resilient municipal integration service and intelligence platform written in **TypeScript on Bun with Hono**, unifying resident and benefits data across unreliable REST and XML legacy systems with 100% precision identity matching, circuit breaking, and an embedded Groq AI Copilot.

---

## Architecture & Features

- **100% Bun & TypeScript**: Zero Python required. Native Web Standards (`Request`/`Response`) and Server-Sent Events (SSE).
- **Resilience Engine**: 3-state Circuit Breaker (Closed/Open/Half-Open), bounded retries with 50ms backoff on 500s, 5m TTL cache with stale fallback, and single-flight request coalescing.
- **Deterministic 4-Tier Identity Ladder**: 100% precision (0 wrong merges) and 100% recall on 620-resident ground truth records.
- **Real-World Dirty Data Kit**: Resolves phonetic alias drift (Soundex), street abbreviation shifts (Boulevard/Blvd, Ave, Apt), date format anomalies, and sibling disambiguation.
- **Municipal Intelligence**: Social Vulnerability Index (0–100 SVI), benefit coverage gap detection, household dwelling graphs, and SHA-256 audit provenance.
- **Groq LLaMA 3.1 AI Copilot**: Streaming caseworker briefings with 15-minute response caching and local heuristic fallback.
- **Interactive Web Cockpit**: Live dashboard at `http://localhost:8080`.

---

## Quickstart

### Prerequisites
- [Bun](https://bun.sh/) 1.1+

### 1. Install Dependencies
```bash
bun install
```

### 2. Configure Environment (Optional)
```bash
cp .env.example .env
```
*(Runs completely offline out of the box; set `GROQ_API_KEY` for live AI streaming).*

### 3. Start CivicBridge (All-in-One)
```bash
bun start
```
Starts the API, embedded mock upstreams (REST on 8081, XML on 8082), and Web Cockpit on **[http://localhost:8080](http://localhost:8080)**.

### 4. Run Automated Test Suite
```bash
bun test
```
Runs 43 unit, integration, and ground-truth tests.

---

## Core Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | Interactive Web Cockpit |
| `/health` | `GET` | Health status and circuit states |
| `/residents/:id/unified` | `GET` | Auto-unification: 4-tier match + SVI + benefit gaps + SHA-256 hash |
| `/unified` | `GET` | Concurrent fan-out (`?resident_id=...&benefit_ref=...`) with partial degradation |
| `/residents` | `GET` | Deduplicated catalogue of 620 residents with pagination receipts |
| `/benefits/*` | `GET` | Single benefit record from XML upstream with retries and breaker |
| `/analytics/overview` | `GET` | High-level municipal metrics and cluster counts |
| `/api/benchmark` | `GET` | Dirty data kit benchmark report (precision, success rate) |
| `/api/ai/dossier/stream` | `GET` | Real-time SSE streaming caseworker dossier |
| `/api/circuit/trip` | `POST` | Manually trips circuit breaker (admin) |
| `/api/circuit/reset` | `POST` | Manually resets circuit breaker (admin) |

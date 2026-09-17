// CivicBridge Web Client (Vanilla TypeScript compiled on the fly by Bun)

let currentUnifiedData: any = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCircuitControls();
  initUnifiedSearch();
  initFanoutSearch();
  initAnalytics();
  initCatalogue();
  pollStatus();
  setInterval(pollStatus, 4000);

  // Auto-search default resident
  searchResident('R-10001');
});

// 1. Tab Switching
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      if (targetId) {
        document.getElementById(targetId)?.classList.add('active');
        if (targetId === 'tab-analytics') loadAnalytics();
      }
    });
  });
}

// 2. Telemetry & Breaker Polling
async function pollStatus() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const sysVal = document.getElementById('sys-status-val');
    const dot = document.querySelector('.status-dot') as HTMLElement;

    if (sysVal) sysVal.textContent = data.status.toUpperCase();
    if (dot) {
      dot.style.backgroundColor =
        data.status === 'ok' ? 'var(--accent-success)' : 'var(--accent-warning)';
    }

    const benSource = data.sources?.benefits_register;
    const circuitVal = document.getElementById('circuit-status-val');
    if (circuitVal && benSource?.circuit) {
      circuitVal.textContent = benSource.circuit.toUpperCase();
      circuitVal.style.color =
        benSource.circuit === 'closed'
          ? 'var(--accent-success)'
          : benSource.circuit === 'half_open'
          ? 'var(--accent-warning)'
          : 'var(--accent-danger)';
    }
  } catch (err) {
    console.warn('Status poll error', err);
  }
}

function initCircuitControls() {
  document.getElementById('btn-circuit-trip')?.addEventListener('click', async () => {
    await fetch('/api/circuit/trip', { method: 'POST' });
    pollStatus();
  });

  document.getElementById('btn-circuit-reset')?.addEventListener('click', async () => {
    await fetch('/api/circuit/reset', { method: 'POST' });
    pollStatus();
  });
}

// 3. Auto-Unified Resident Search
function initUnifiedSearch() {
  const input = document.getElementById('input-resident-id') as HTMLInputElement;
  const btn = document.getElementById('btn-search-resident');

  btn?.addEventListener('click', () => {
    const id = input.value.trim();
    if (id) searchResident(id);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const id = input.value.trim();
      if (id) searchResident(id);
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.getAttribute('data-id');
      if (id && input) {
        input.value = id;
        searchResident(id);
      }
    });
  });

  document.getElementById('btn-generate-ai')?.addEventListener('click', () => {
    const inputId = input.value.trim();
    if (inputId) streamAIDossier(inputId);
  });
}

async function searchResident(id: string) {
  const resultsArea = document.getElementById('unified-results');
  resultsArea?.classList.remove('hidden');

  try {
    const res = await fetch(`/residents/${encodeURIComponent(id)}/unified`);
    if (!res.ok) {
      alert(`Resident ${id} could not be unified (HTTP ${res.status})`);
      return;
    }

    const data = await res.json();
    currentUnifiedData = data;
    renderUnifiedView(data);
    streamAIDossier(id);
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  }
}

function renderUnifiedView(data: any) {
  const r = data.resident;
  const b = data.benefits;
  const match = data.identity_match;
  const vuln = data.vulnerability;
  const gaps = data.benefit_gaps || [];

  // 1. Resident Card
  const rBox = document.getElementById('resident-details');
  if (rBox) {
    rBox.innerHTML = `
      <p><strong>Name:</strong> ${r.first_name} ${r.last_name}</p>
      <p><strong>DOB:</strong> ${r.date_of_birth}</p>
      <p><strong>Dwelling:</strong> ${r.address_line}, ${r.city}</p>
      <p><strong>Phone:</strong> ${r.phone || 'None'}</p>
      <p><strong>Program Status:</strong> <span class="badge badge-warning">${r.program_status}</span></p>
      <p><strong>Last Contact:</strong> ${r.last_contact || 'None'}</p>
    `;
  }

  // 2. Benefit Card
  const bBox = document.getElementById('benefit-details');
  const bStatus = document.getElementById('ben-source-status');
  if (bStatus) {
    bStatus.textContent = data._meta?.sources?.benefits_register?.status || 'unknown';
  }

  if (bBox) {
    if (b) {
      bBox.innerHTML = `
        <p><strong>Reference:</strong> <code>${b.ref}</code></p>
        <p><strong>Name on Record:</strong> ${b.name}</p>
        <p><strong>Born:</strong> ${b.born}</p>
        <p><strong>Registered Address:</strong> ${b.addr}, ${b.town}</p>
        <p><strong>Benefit Code:</strong> <span class="badge badge-success">${b.benefit_code}</span></p>
        <p><strong>Review Due Date:</strong> <strong>${b.review_due}</strong></p>
      `;
    } else {
      bBox.innerHTML = `
        <p style="color: var(--text-muted); font-style: italic;">No matching benefit record found in Benefits Register.</p>
        <p>Identity outcome: <strong>${match.outcome.toUpperCase()}</strong></p>
      `;
    }
  }

  // 3. Evidence Ladder
  const outcomeBadge = document.getElementById('identity-outcome-badge');
  if (outcomeBadge) {
    outcomeBadge.textContent = match.outcome.toUpperCase();
    outcomeBadge.className = `badge ${
      match.outcome === 'matched'
        ? 'badge-success'
        : match.outcome === 'ambiguous'
        ? 'badge-warning'
        : 'badge-danger'
    }`;
  }

  const ladderBody = document.getElementById('evidence-ladder-body');
  if (ladderBody) {
    let html = `<p><strong>Outcome:</strong> <code>${match.outcome}</code> &bull; Candidate Count: ${match.candidate_refs?.length || 0}</p>`;
    html += '<ul style="margin-top: 0.6rem; list-style: none;">';
    for (const ev of match.evidence || []) {
      html += `
        <li style="padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <strong>Rule:</strong> <code>${ev.rule}</code><br>
          ${ev.resident_value ? `<small>Resident Input: ${ev.resident_value}</small><br>` : ''}
          ${ev.benefit_value ? `<small>Register Matched: ${ev.benefit_value}</small><br>` : ''}
          ${ev.result ? `<small style="color: var(--accent-warning);">Result: ${ev.result}</small>` : ''}
        </li>
      `;
    }
    html += '</ul>';
    ladderBody.innerHTML = html;
  }

  // 4. Vulnerability Score
  const scoreVal = document.getElementById('vuln-score-val');
  const scoreCircle = document.getElementById('vuln-score-circle');
  const tierBadge = document.getElementById('vuln-tier-badge');
  const summaryText = document.getElementById('vuln-summary-text');
  const factorsList = document.getElementById('vuln-factors-list');

  if (vuln) {
    if (scoreVal) scoreVal.textContent = vuln.score;
    if (tierBadge) {
      tierBadge.textContent = vuln.tier.toUpperCase();
      tierBadge.className = `badge ${
        vuln.tier === 'critical' || vuln.tier === 'high' ? 'badge-danger' : 'badge-warning'
      }`;
    }
    if (scoreCircle) {
      const color =
        vuln.tier === 'critical'
          ? 'var(--accent-danger)'
          : vuln.tier === 'high'
          ? 'var(--accent-warning)'
          : 'var(--accent-success)';
      scoreCircle.style.borderColor = color;
    }
    if (summaryText) {
      summaryText.textContent = `${vuln.tier.toUpperCase()} risk profile with ${vuln.factors.length} active risk factor(s).`;
    }
    if (factorsList) {
      factorsList.innerHTML = vuln.factors.map((f: string) => `<li>${f}</li>`).join('');
    }
  }

  // 5. Benefit Gaps
  const gapsBody = document.getElementById('benefit-gaps-body');
  if (gapsBody) {
    if (gaps.length === 0) {
      gapsBody.innerHTML = '<p style="color: var(--accent-success);">✅ No coverage gaps or overdue review dates detected.</p>';
    } else {
      gapsBody.innerHTML = gaps
        .map(
          (g: any) => `
        <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--accent-danger); padding: 0.6rem 0.8rem; margin-bottom: 0.6rem; border-radius: 4px;">
          <h4 style="color: var(--accent-danger); font-size: 0.95rem;">⚠️ ${g.missing_entitlement}</h4>
          <p style="font-size: 0.85rem; margin: 0.2rem 0;">${g.description}</p>
          <small style="color: #cbd5e1;"><strong>Action:</strong> ${g.action_recommended}</small>
        </div>
      `
        )
        .join('');
    }
  }

  // 6. Provenance Hash
  const hashBox = document.getElementById('provenance-hash-box');
  if (hashBox) {
    hashBox.textContent = data.provenance_hash || 'None generated';
  }
}

// 4. Groq AI Real-Time SSE Streamer
function streamAIDossier(residentId: string) {
  const contentBox = document.getElementById('ai-briefing-content');
  const loader = document.getElementById('ai-loading');

  if (contentBox) contentBox.textContent = '';
  loader?.classList.remove('hidden');

  const evtSource = new EventSource(`/api/ai/dossier/stream?resident_id=${encodeURIComponent(residentId)}`);

  evtSource.onmessage = (event) => {
    loader?.classList.add('hidden');
    if (event.data === '[DONE]') {
      evtSource.close();
      return;
    }
    if (contentBox) {
      contentBox.textContent += event.data;
    }
  };

  evtSource.onerror = () => {
    loader?.classList.add('hidden');
    evtSource.close();
  };
}

// 5. Fan-Out Query
function initFanoutSearch() {
  document.getElementById('btn-fanout-submit')?.addEventListener('click', async () => {
    const resId = (document.getElementById('fanout-resident-id') as HTMLInputElement)?.value.trim();
    const benRef = (document.getElementById('fanout-benefit-ref') as HTMLInputElement)?.value.trim();

    const params = new URLSearchParams();
    if (resId) params.set('resident_id', resId);
    if (benRef) params.set('benefit_ref', benRef);

    const res = await fetch(`/unified?${params.toString()}`);
    const data = await res.json();

    const results = document.getElementById('fanout-results');
    results?.classList.remove('hidden');

    const banner = document.getElementById('fanout-meta-banner');
    if (banner) {
      const isPartial = data._meta?.partial;
      banner.innerHTML = `
        <strong>Result:</strong> ${isPartial ? '⚠️ <span style="color: var(--accent-warning);">Partial Response (Degraded Upstream)</span>' : '✅ <span style="color: var(--accent-success);">Full Response (Both Sources Succeeded)</span>'}
        &bull; Resident Index: <code>${data._meta?.sources?.resident_index?.status || 'none'}</code> (${data._meta?.sources?.resident_index?.latency_ms || 0}ms)
        &bull; Benefits Register: <code>${data._meta?.sources?.benefits_register?.status || 'none'}</code> (${data._meta?.sources?.benefits_register?.latency_ms || 0}ms)
      `;
    }

    const viewer = document.getElementById('fanout-json');
    if (viewer) {
      viewer.textContent = JSON.stringify(data, null, 2);
    }
  });
}

// 6. Analytics Tab
function initAnalytics() {
  document.getElementById('btn-refresh-analytics')?.addEventListener('click', loadAnalytics);
}

async function loadAnalytics() {
  try {
    const [overviewRes, householdsRes] = await Promise.all([
      fetch('/analytics/overview'),
      fetch('/analytics/households'),
    ]);

    const overview = await overviewRes.json();
    const households = await householdsRes.json();

    const setVal = (id: string, v: any) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    setVal('metric-residents', overview.residents_total);
    setVal('metric-benefits', overview.benefits_total);
    setVal('metric-match-rate', `${overview.match_rate_pct}%`);
    setVal('metric-critical', overview.critical_vulnerability_count);
    setVal('metric-gaps', overview.benefit_gap_count);
    setVal('metric-households', overview.household_clusters_count);

    const tbody = document.getElementById('households-tbody');
    if (tbody) {
      tbody.innerHTML = households
        .slice(0, 50)
        .map(
          (h: any) => `
        <tr>
          <td><strong>${h.address}</strong></td>
          <td>${h.town}</td>
          <td><span class="badge badge-warning">${h.occupant_count} occupant(s)</span></td>
          <td><code>${h.occupant_ids.join(', ')}</code></td>
        </tr>
      `
        )
        .join('');
    }
  } catch (err) {
    console.error('Analytics load error', err);
  }
}

// 7. Deduplicated Catalogue Tab
function initCatalogue() {
  document.getElementById('btn-load-catalogue')?.addEventListener('click', async () => {
    const tbody = document.getElementById('catalogue-tbody');
    const receipt = document.getElementById('pagination-receipt-box');

    if (tbody) tbody.innerHTML = '<tr><td colspan="7">Fetching all paginated records and resolving boundary slips...</td></tr>';

    try {
      const res = await fetch('/residents');
      const data = await res.json();
      const p = data.pagination;

      if (receipt) {
        receipt.innerHTML = `
          <div><strong>Pages Fetched:</strong> ${p.pages_fetched}</div>
          <div><strong>Records Seen:</strong> ${p.records_seen}</div>
          <div><strong>Duplicates Filtered:</strong> <span style="color: var(--accent-warning);">${p.duplicates}</span></div>
          <div><strong>Conflicts Detected:</strong> ${p.conflicts}</div>
          <div><strong>Unique Deduplicated:</strong> <strong style="color: var(--accent-success);">${p.unique}</strong> / ${p.reported_total}</div>
          <div><strong>Catalogue Integrity:</strong> ${p.complete ? '✅ COMPLETE' : '⚠️ INCOMPLETE'}</div>
        `;
      }

      if (tbody) {
        tbody.innerHTML = data.residents
          .map(
            (r: any) => `
          <tr>
            <td><code>${r.id}</code></td>
            <td><strong>${r.first_name} ${r.last_name}</strong></td>
            <td>${r.date_of_birth}</td>
            <td>${r.address_line}</td>
            <td>${r.city}</td>
            <td><span class="badge badge-warning">${r.program_status}</span></td>
            <td>${r.last_contact || 'None'}</td>
          </tr>
        `
          )
          .join('');
      }
    } catch (err: any) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">Error loading catalogue: ${err.message}</td></tr>`;
    }
  });
}

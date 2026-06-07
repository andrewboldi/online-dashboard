"use strict";

const state = {
  schedule: [],
  doctors: [],
  institutions: [],
  drafts: [],
  stats: {},
  view: "outreach",
  filters: { tier: "", specialty: "", institution_class: "", status: "", search: "" },
  doctorIndexById: new Map(),
  doctorIndexBySpec: new Map(),
  draftsByDoctorId: new Map(),
};

const STATUS_BUCKETS = {
  scheduled: { label: "🟢 Scheduled", statuses: ["scheduled", "scheduled_pending_confirmation"], order: 1, color: "#16a34a" },
  positive: { label: "🟡 Positive — ball in their court", statuses: ["replied_positive", "replied_positive_action_required", "awaiting_their_reply", "referred_to_sabatini"], order: 2, color: "#d97706" },
  sent: { label: "🟠 Sent — awaiting first reply", statuses: ["contacted", "emailed", "followed_up_1", "followed_up_2"], order: 3, color: "#f59e0b" },
  drafted: { label: "⚠️ Drafted — not sent yet", statuses: ["drafted"], order: 4, color: "#94a3b8" },
  declined: { label: "🔴 Declined / no go", statuses: ["declined", "non_responsive"], order: 5, color: "#dc2626" },
};

function bucketOf(status) {
  for (const [key, b] of Object.entries(STATUS_BUCKETS)) {
    if (b.statuses.includes(status)) return key;
  }
  return null;
}

function latestEmail(doc) {
  const log = doc.email_log || [];
  if (!log.length) return null;
  const sorted = [...log].sort((a, b) => (b.Date || b.date || "").localeCompare(a.Date || a.date || ""));
  const top = sorted[0];
  return {
    date: top.Date || top.date || "",
    direction: (top.Direction || top.direction || "").toLowerCase(),
    outcome: top.Outcome || top.outcome || "",
    subject: top.Subject || top.subject || "",
  };
}

function daysSince(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso + "T00:00").getTime()) / 86400000);
  return Number.isFinite(d) ? d : null;
}

const CONFIG = {
  API_BASE: "https://doctor-outreach-api.cbracketdash.workers.dev",
  GOOGLE_CLIENT_ID: "662894824293-qqro14elnddglaqtbk3298rj4a808rkt.apps.googleusercontent.com",
};

let authToken = null; // Google ID token (remote mode only)

function isLocalMode() {
  return location.protocol === "file:"
    || new URLSearchParams(location.search).has("local")
    || !CONFIG.GOOGLE_CLIENT_ID;
}

async function fetchData(name, fallback) {
  try {
    if (isLocalMode()) {
      return await fetch(`data/${name}.json`).then(r => r.json());
    }
    const r = await fetch(`${CONFIG.API_BASE}/api/data/${name}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

async function loadData() {
  const [schedule, doctors, institutions, drafts, stats] = await Promise.all([
    fetchData("schedule"),
    fetchData("doctors"),
    fetchData("institutions"),
    fetchData("drafts", []),
    fetchData("stats"),
  ]);
  state.schedule = schedule;
  state.doctors = doctors;
  state.institutions = institutions;
  state.drafts = drafts;
  state.stats = stats;
  state.doctorIndexById = new Map(doctors.map(d => [d.id, d]));
  state.draftsByDoctorId = new Map(drafts.map(d => [d.doctor_id, d]));
  state.doctorIndexBySpec = new Map();
  for (const d of doctors) {
    const k = d.specialty || "";
    if (!state.doctorIndexBySpec.has(k)) state.doctorIndexBySpec.set(k, []);
    state.doctorIndexBySpec.get(k).push(d);
  }
  const drafted = doctors.filter(d => d.status === "drafted").length;
  document.getElementById("build-info").textContent = `${doctors.length} doctors · ${schedule.length} slots · ${drafts.length} staged · ${institutions.length} institutions`;
  const badge = document.getElementById("staged-badge");
  if (drafts.length > 0) {
    badge.textContent = drafts.length;
    badge.hidden = false;
  }
}

function pill(text, klass) {
  const safe = String(text || "").replace(/[^a-z0-9_]/gi, "_");
  const k = klass || `pill-${safe}`;
  return `<span class="pill ${k}">${escapeHtml(text || "")}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtMonth(iso) {
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function renderSchedule() {
  const m = document.getElementById("main");
  const slots = state.schedule;
  // Phase summary cards
  const phaseSet = ["P1","P2","P3","P4","P5"];
  const phaseLabels = {
    P1: "Tier 1 procedural",
    P2: "Tier 2 diagnostic",
    P3: "Tier 3 Soley-aligned (Med Onc, IM, Clin Pharm)",
    P4: "Tier 3 remainder",
    P5: "Tier 4 acute / systems",
  };
  const phaseStats = {};
  for (const p of phaseSet) phaseStats[p] = { total: 0, open: 0, reserved: 0, locked: 0, first: null, last: null };
  for (const r of slots) {
    if (!phaseSet.includes(r.phase)) continue;
    const ps = phaseStats[r.phase];
    ps.total++;
    if (r.status === "OPEN") ps.open++;
    if (r.status === "RESERVED") ps.reserved++;
    if (r.status === "LOCKED") ps.locked++;
    if (!ps.first || r.date < ps.first) ps.first = r.date;
    if (!ps.last || r.date > ps.last) ps.last = r.date;
  }

  const cards = phaseSet.map(p => `
    <div class="phase-card">
      <h3>${p} — ${phaseLabels[p]}</h3>
      <div class="meta">${fmtDate(phaseStats[p].first)} → ${fmtDate(phaseStats[p].last)}</div>
      <div class="body">
        ${phaseStats[p].total} slots ·
        ${pill(`${phaseStats[p].open} OPEN`,"pill-OPEN")}
        ${phaseStats[p].reserved ? pill(`${phaseStats[p].reserved} RESERVED`,"pill-RESERVED") : ""}
        ${phaseStats[p].locked ? pill(`${phaseStats[p].locked} LOCKED`,"pill-LOCKED") : ""}
      </div>
    </div>
  `).join("");

  // Group slots by month
  const groups = new Map();
  for (const r of slots) {
    const key = r.date.slice(0,7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sortedKeys = [...groups.keys()].sort();

  // Filter controls
  const phaseFilter = state.filters.phaseSchedule || "";
  const statusFilter = state.filters.statusSchedule || "";
  const specFilter = state.filters.specSchedule || "";
  const allSpecs = [...new Set(slots.map(r => r.target_specialty).filter(Boolean))].sort();

  function shouldShow(r) {
    if (phaseFilter && r.phase !== phaseFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (specFilter && r.target_specialty !== specFilter) return false;
    return true;
  }

  const monthHtml = sortedKeys.map(k => {
    const rows = groups.get(k).filter(shouldShow);
    if (rows.length === 0) return "";
    const slotsHtml = rows.map(r => {
      const doc = r.doctor_id ? state.doctorIndexById.get(r.doctor_id) : null;
      return `
      <div class="slot phase-${r.phase} status-${r.status}" data-slot="${escapeHtml(r.slot_id)}" data-doctor="${escapeHtml(r.doctor_id||"")}">
        <div class="date">${fmtDate(r.date)} ${pill(r.status)}</div>
        <div class="spec">${escapeHtml(r.target_specialty || (r.status === "BLOCKED" ? r.notes : "— buffer —"))}</div>
        <div class="time">${escapeHtml(r.suggested_time || "")} ${escapeHtml(r.session_type || "")}</div>
        ${doc ? `<div class="doc">Dr. ${escapeHtml(doc.name || doc.id)}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="month-group"><h3>${fmtMonth(k+"-01")}</h3><div class="slot-grid">${slotsHtml}</div></div>`;
  }).join("");

  m.innerHTML = `
    <div class="panel">
      <h2>Phase overview</h2>
      <div class="phase-cards">${cards}</div>
    </div>
    <div class="panel">
      <div class="filters">
        <label>Phase</label>
        <select id="f-phase">
          <option value="">all</option>
          ${phaseSet.map(p => `<option value="${p}" ${phaseFilter===p?"selected":""}>${p}</option>`).join("")}
        </select>
        <label>Status</label>
        <select id="f-status">
          <option value="">all</option>
          ${["OPEN","RESERVED","LOCKED","BLOCKED"].map(s => `<option value="${s}" ${statusFilter===s?"selected":""}>${s}</option>`).join("")}
        </select>
        <label>Specialty</label>
        <select id="f-spec">
          <option value="">all</option>
          ${allSpecs.map(s => `<option value="${escapeHtml(s)}" ${specFilter===s?"selected":""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <div class="spacer"></div>
        <span class="count">${[...groups.values()].flat().filter(shouldShow).length} slots shown</span>
      </div>
      ${monthHtml || `<div class="empty">No slots match filters.</div>`}
    </div>
  `;

  document.getElementById("f-phase").onchange = e => { state.filters.phaseSchedule = e.target.value; renderSchedule(); };
  document.getElementById("f-status").onchange = e => { state.filters.statusSchedule = e.target.value; renderSchedule(); };
  document.getElementById("f-spec").onchange = e => { state.filters.specSchedule = e.target.value; renderSchedule(); };

  document.querySelectorAll(".slot[data-doctor]").forEach(el => {
    el.addEventListener("click", () => {
      const docId = el.getAttribute("data-doctor");
      if (docId) openDoctor(docId);
    });
  });
}

function renderDoctors() {
  const m = document.getElementById("main");
  const f = state.filters;
  const allTiers = ["1","2","3","4"];
  const allSpecs = [...new Set(state.doctors.map(d => d.specialty).filter(Boolean))].sort();
  const allClasses = ["apex","secondary","opportunistic"];
  const allStatuses = ["not_contacted","emailed","followed_up_1","followed_up_2","replied","scheduled","shadowed","declined","non_responsive"];

  function show(d) {
    if (f.tier && String(d.tier) !== f.tier) return false;
    if (f.specialty && d.specialty !== f.specialty) return false;
    if (f.institution_class && d.institution_class !== f.institution_class) return false;
    if (f.status && d.status !== f.status) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [d.name, d.specialty, d.institution, d.subspecialty, d.email].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  const filtered = state.doctors.filter(show);

  const rows = filtered.map(d => `
    <tr class="row-link" data-doctor="${escapeHtml(d.id)}">
      <td><strong>${escapeHtml(d.name || "")}</strong>, ${escapeHtml(d.title || "")}</td>
      <td>${escapeHtml(d.specialty || "")}<br><span style="color:var(--ink-faint);font-size:0.78rem">${escapeHtml(d.subspecialty || "")}</span></td>
      <td>${pill("T"+d.tier, `pill-tier-${d.tier}`)}</td>
      <td>${escapeHtml(d.institution || "")}<br>${pill(d.institution_class || "", `pill-${d.institution_class||"opportunistic"}`)}</td>
      <td>${pill(d.status || "not_contacted", `pill-${d.status||"not_contacted"}`)}</td>
      <td>${pill(d.priority || "medium", `pill-${d.priority||"medium"}`)}</td>
      <td>${d.h_index ?? ""}</td>
      <td>${d.sessions_completed ?? 0} / ${d.sessions_targeted ?? 0}</td>
    </tr>
  `).join("");

  m.innerHTML = `
    <div class="panel">
      <div class="filters">
        <label>Tier</label>
        <select id="df-tier">
          <option value="">all</option>
          ${allTiers.map(t => `<option value="${t}" ${f.tier===t?"selected":""}>Tier ${t}</option>`).join("")}
        </select>
        <label>Specialty</label>
        <select id="df-spec">
          <option value="">all</option>
          ${allSpecs.map(s => `<option value="${escapeHtml(s)}" ${f.specialty===s?"selected":""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <label>Class</label>
        <select id="df-class">
          <option value="">all</option>
          ${allClasses.map(c => `<option value="${c}" ${f.institution_class===c?"selected":""}>${c}</option>`).join("")}
        </select>
        <label>Status</label>
        <select id="df-status">
          <option value="">all</option>
          ${allStatuses.map(s => `<option value="${s}" ${f.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
        <input id="df-search" class="search-input" placeholder="search name / specialty / institution…" value="${escapeHtml(f.search||"")}">
        <div class="spacer"></div>
        <span class="count">${filtered.length} / ${state.doctors.length} doctors</span>
      </div>
      ${state.doctors.length === 0 ? `
        <div class="empty">
          <p>No doctors loaded yet.</p>
          <p>Use <code>scripts/add_doctor.py</code> or have an agent populate <code>data/doctors/</code>, then run <code>python3 scripts/dashboard_build.py</code>.</p>
        </div>
      ` : (filtered.length === 0 ? `<div class="empty">No doctors match filters.</div>` : `
        <table>
          <thead><tr>
            <th>Name</th><th>Specialty</th><th>Tier</th><th>Institution</th>
            <th>Status</th><th>Priority</th><th>h-idx</th><th>Sessions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `)}
    </div>
  `;

  document.getElementById("df-tier").onchange = e => { state.filters.tier = e.target.value; renderDoctors(); };
  document.getElementById("df-spec").onchange = e => { state.filters.specialty = e.target.value; renderDoctors(); };
  document.getElementById("df-class").onchange = e => { state.filters.institution_class = e.target.value; renderDoctors(); };
  document.getElementById("df-status").onchange = e => { state.filters.status = e.target.value; renderDoctors(); };
  document.getElementById("df-search").oninput = e => { state.filters.search = e.target.value; renderDoctors(); };
  document.querySelectorAll("tr.row-link").forEach(tr => {
    tr.addEventListener("click", () => openDoctor(tr.getAttribute("data-doctor")));
  });
}

function openDoctor(id) {
  const d = state.doctorIndexById.get(id);
  if (!d) return;
  const inner = document.getElementById("modal-inner");
  const proposed = (d.proposed_session_dates || []).map(p => `
    <li>${escapeHtml(p.date || "")} ${escapeHtml(p.time || "")} — ${escapeHtml(p.type || "")}</li>
  `).join("");
  const accepted = (d.accepted_session_dates || []).map(p => `
    <li>${escapeHtml(p.date || "")} ${escapeHtml(p.time || "")} — ${escapeHtml(p.type || "")}</li>
  `).join("");
  const emailRows = (d.email_log || []).map(r => `
    <tr>
      <td>${escapeHtml(r.Date || "")}</td>
      <td>${pill(r.Direction || "")}</td>
      <td>${escapeHtml(r.Template || "")}</td>
      <td>${escapeHtml(r.Subject || "")}</td>
      <td>${escapeHtml(r.Outcome || "")}</td>
    </tr>
  `).join("");
  const sessionRows = (d.sessions || []).map(r => `
    <tr>
      <td>${escapeHtml(r.Date || "")}</td>
      <td>${escapeHtml(r.Time || "")}</td>
      <td>${escapeHtml(r.Location || "")}</td>
      <td>${escapeHtml(r.Type || "")}</td>
      <td>${escapeHtml(r.Status || "")}</td>
      <td>${escapeHtml(r.Notes || "")}</td>
    </tr>
  `).join("");

  const placeholderRe = /placeholder|ucsfProfilesLogo/i;
  const hasPhoto = d.photo_url && !placeholderRe.test(d.photo_url);
  const initials = ((d.name || "").split(",")[0] || " ").trim().slice(0,1).toUpperCase()
    + (((d.name || "").split(",")[1] || " ").trim().slice(0,1).toUpperCase());
  const photoEl = hasPhoto
    ? `<img src="${escapeHtml(d.photo_url)}" alt="${escapeHtml(d.name)}" onerror="this.outerHTML='<div class=\\'placeholder-photo\\'>${initials}</div>'">`
    : `<div class="placeholder-photo">${initials}</div>`;
  inner.innerHTML = `
    <button class="modal-close" id="close-modal">×</button>
    <div class="doctor-header">
      ${photoEl}
      <div class="head-text">
        <h2>Dr. ${escapeHtml(d.name || "")}, ${escapeHtml(d.title || "")}</h2>
        <div class="meta-row">
          ${escapeHtml(d.specialty || "")}${d.subspecialty ? " — " + escapeHtml(d.subspecialty) : ""}
          · ${escapeHtml(d.institution || "")} ${pill(d.institution_class||"", `pill-${d.institution_class||"opportunistic"}`)}
          · ${pill("T"+(d.tier||"?"), `pill-tier-${d.tier||"1"}`)}
          · ${pill(d.status || "not_contacted", `pill-${d.status||"not_contacted"}`)}
        </div>
      </div>
    </div>
    <div class="profile-grid">
      <div>
        <h3>Why target</h3>
        <pre>${escapeHtml(d.best_doctor_justification || "(none yet)")}</pre>
        <h3>Custom hook</h3>
        <pre>${escapeHtml(d.hook_seed || "(none yet)")}</pre>
        <h3>Email log</h3>
        ${emailRows ? `<table><thead><tr><th>Date</th><th>Dir</th><th>Template</th><th>Subject</th><th>Outcome</th></tr></thead><tbody>${emailRows}</tbody></table>` : `<div class="empty">No emails logged yet.</div>`}
        <h3>Sessions</h3>
        ${sessionRows ? `<table><thead><tr><th>Date</th><th>Time</th><th>Location</th><th>Type</th><th>Status</th><th>Notes</th></tr></thead><tbody>${sessionRows}</tbody></table>` : `<div class="empty">No sessions yet.</div>`}
        ${d.post_shadow_notes_md ? `<h3>Post-shadow notes</h3><pre>${escapeHtml(d.post_shadow_notes_md)}</pre>` : ""}
      </div>
      <div>
        <h3>Contact</h3>
        <div class="kv">
          <div class="k">Email</div><div>${d.email ? `<a href="mailto:${escapeHtml(d.email)}">${escapeHtml(d.email)}</a>` : "—"}</div>
          <div class="k">Phone</div><div>${escapeHtml(d.phone || "—")}</div>
          <div class="k">Profile</div><div>${d.profile_url ? `<a href="${escapeHtml(d.profile_url)}" target="_blank" rel="noopener">link</a>` : "—"}</div>
          <div class="k">h-index</div><div>${escapeHtml(String(d.h_index || "—"))}</div>
          <div class="k">Sessions</div><div>${d.sessions_completed ?? 0} / ${d.sessions_targeted ?? 0}</div>
          <div class="k">Next action</div><div>${escapeHtml(d.next_action || "—")} (${escapeHtml(d.next_action_due || "—")})</div>
          <div class="k">Gatekeeping</div><div>${escapeHtml(d.gatekeeping_status || "—")}</div>
          <div class="k">Phase</div><div>${escapeHtml(d.phase || "—")}</div>
        </div>
        <h3>Proposed dates</h3>
        ${proposed ? `<ul>${proposed}</ul>` : `<div class="empty">No dates proposed yet.</div>`}
        <h3>Accepted dates</h3>
        ${accepted ? `<ul>${accepted}</ul>` : `<div class="empty">No dates accepted yet.</div>`}
      </div>
    </div>
  `;
  const modal = document.getElementById("modal");
  modal.hidden = false;
  document.getElementById("close-modal").onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}

function closeModal() {
  document.getElementById("modal").hidden = true;
}

function renderStaged() {
  const m = document.getElementById("main");
  if (state.drafts.length === 0) {
    m.innerHTML = `
      <div class="panel">
        <h2>Staged Emails</h2>
        <div class="empty">
          <p>No emails staged yet.</p>
          <p>Run <code>python3 scripts/render_email.py &lt;doctor_id&gt;</code> to stage one (this reserves their schedule slots and writes a draft to <code>drafts/</code>). Nothing is sent until you explicitly approve.</p>
        </div>
      </div>`;
    return;
  }
  const cards = state.drafts.map((dr, i) => {
    const doc = state.doctorIndexById.get(dr.doctor_id);
    const docName = doc ? doc.name : dr.doctor_id;
    const docSpec = doc ? `${doc.specialty}${doc.subspecialty ? " — " + doc.subspecialty : ""}` : "";
    const docInst = doc ? doc.institution : "";
    const docEmail = doc ? doc.email : "";
    const proposed = doc && doc.proposed_session_dates ? doc.proposed_session_dates : [];
    return `
      <div class="staged-card">
        <div class="head">
          <div>
            <h3><span class="order-num">${i+1}.</span> Dr. ${escapeHtml(docName)} ${pill("T"+(doc?.tier||"?"), `pill-tier-${doc?.tier||"1"}`)}</h3>
            <div class="meta">${escapeHtml(docSpec)} · ${escapeHtml(docInst)} · ${escapeHtml(docEmail || "(no email)")}</div>
          </div>
          <div class="meta">staged ${escapeHtml(dr.stamp)}</div>
        </div>
        <div class="subject">${escapeHtml(dr.subject || "(no subject)")}</div>
        <pre>${escapeHtml(dr.body)}</pre>
        <div class="actions">
          <button onclick="openDoctor('${escapeHtml(dr.doctor_id)}')">View doctor profile</button>
          ${docEmail ? `<button class="secondary" onclick="navigator.clipboard.writeText(document.querySelector('[data-draft=\\'${escapeHtml(dr.doctor_id)}\\']').textContent); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy body to clipboard', 1500)" data-draft="${escapeHtml(dr.doctor_id)}">Copy body to clipboard</button>` : ""}
        </div>
        <div data-draft="${escapeHtml(dr.doctor_id)}" hidden>${escapeHtml(dr.body)}</div>
      </div>`;
  }).join("");
  m.innerHTML = `
    <div class="panel">
      <h2>Staged Emails — ${state.drafts.length} ready to send</h2>
      <p style="color:var(--ink-soft);font-size:0.85rem;margin:0 0 1rem">These drafts are <strong>not yet sent</strong>. The proposed Tue/Thu dates have been RESERVED in the schedule. When you're ready, ask Claude to send a specific one (e.g. "send the Altman draft") or copy/paste manually from this view.</p>
      <div class="staged-list">${cards}</div>
    </div>`;
}

function renderInstitutions() {
  const m = document.getElementById("main");
  const rows = state.institutions.map(i => `
    <tr>
      <td><strong>${escapeHtml(i.name)}</strong><br><span style="color:var(--ink-faint);font-size:0.78rem">${escapeHtml(i.city)}</span></td>
      <td>${pill(i.class, `pill-${i.class}`)}</td>
      <td>${escapeHtml(i.gatekeeping_path)}</td>
      <td>${pill(i.enrollment_status, "pill-"+i.enrollment_status)}</td>
      <td>${escapeHtml(i.enrollment_lead_time_weeks)} wk</td>
      <td>${escapeHtml(i.notes)}</td>
    </tr>
  `).join("");
  m.innerHTML = `
    <div class="panel">
      <h2>Institutions — ${state.institutions.length}</h2>
      <table>
        <thead><tr><th>Institution</th><th>Class</th><th>Gatekeeping path</th><th>Status</th><th>Lead time</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderStats() {
  const m = document.getElementById("main");
  const s = state.stats;
  function statCard(label, value, breakdown) {
    const items = Object.entries(breakdown || {}).map(([k,v]) => `<span>${pill(k, `pill-${k}`)} ${v}</span>`).join("");
    return `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div><div class="breakdown">${items}</div></div>`;
  }
  m.innerHTML = `
    <div class="panel">
      <h2>Doctors — ${s.doctors_total || 0}</h2>
      <div class="stat-cards">
        ${statCard("By status", s.doctors_total || 0, s.doctors_by_status)}
        ${statCard("By tier", s.doctors_total || 0, s.doctors_by_tier)}
        ${statCard("By phase", s.doctors_total || 0, s.doctors_by_phase)}
        ${statCard("By institution class", s.doctors_total || 0, s.doctors_by_institution_class)}
      </div>
    </div>
    <div class="panel">
      <h2>Schedule — ${s.schedule_total_slots || 0} slots</h2>
      <div class="stat-cards">
        ${statCard("By status", s.schedule_total_slots || 0, s.schedule_by_status)}
        ${statCard("By phase", s.schedule_total_slots || 0, s.schedule_by_phase)}
      </div>
    </div>
  `;
}

function renderOutreach() {
  const m = document.getElementById("main");
  const contacted = state.doctors.filter(d => bucketOf(d.status));
  const groups = {};
  for (const key of Object.keys(STATUS_BUCKETS)) groups[key] = [];
  for (const d of contacted) groups[bucketOf(d.status)].push(d);

  const today = new Date().toISOString().slice(0, 10);
  const cardOf = d => {
    const latest = latestEmail(d);
    const lastDate = latest?.date || d.last_contact_date || "";
    const ago = daysSince(lastDate);
    const overdue = d.next_action_due && d.next_action_due < today;
    const inDir = latest?.direction.startsWith("in") || latest?.direction.startsWith("reply");
    return `
    <div class="outreach-card" data-doctor="${escapeHtml(d.id)}">
      <div class="oc-head">
        <strong>Dr. ${escapeHtml(d.name)}</strong>
        ${pill("T"+d.tier, `pill-tier-${d.tier}`)}
      </div>
      <div class="oc-meta">${escapeHtml(d.institution)} · ${escapeHtml(d.specialty)}${d.subspecialty ? " · "+escapeHtml(d.subspecialty) : ""}</div>
      ${lastDate ? `<div class="oc-latest">
        <span class="oc-date">${lastDate}</span>
        ${inDir !== undefined ? `<span class="oc-dir ${inDir?'in':'out'}">${inDir?'← reply':'→ sent'}</span>` : ''}
        ${ago !== null ? `<span class="oc-days">${ago}d ago</span>` : ''}
      </div>` : ''}
      ${latest?.outcome ? `<div class="oc-outcome">${escapeHtml(latest.outcome).slice(0, 160)}</div>` : ''}
      ${d.next_action ? `<div class="oc-next ${overdue?'overdue':''}">→ ${escapeHtml(d.next_action.replace(/_/g, ' '))}${d.next_action_due ? ' <span class="due">by '+escapeHtml(d.next_action_due)+(overdue?' ⚠️':'')+'</span>' : ''}</div>` : ''}
    </div>`;
  };

  const sorted = Object.entries(STATUS_BUCKETS).sort((a, b) => a[1].order - b[1].order);
  m.innerHTML = sorted.map(([key, b]) => `
    <div class="panel oc-panel">
      <h2 class="oc-h" style="border-left: 4px solid ${b.color}">${b.label} <span class="count">${groups[key].length}</span></h2>
      ${groups[key].length ? `<div class="outreach-grid">${groups[key].map(cardOf).join("")}</div>` : `<div class="empty">— none —</div>`}
    </div>`).join("");

  m.querySelectorAll(".outreach-card").forEach(el => {
    el.addEventListener("click", () => openDoctor(el.dataset.doctor));
  });
}

function renderConfirmed() {
  const m = document.getElementById("main");
  const positive = state.doctors.filter(d => {
    const k = bucketOf(d.status);
    return k === "scheduled" || k === "positive";
  });

  const events = [];
  for (const d of positive) {
    const accepted = (d.accepted_session_dates || []).filter(Boolean);
    const sessions = d.sessions || [];
    if (accepted.length) {
      for (const a of accepted) events.push({ doctor: d, when: a, type: "Confirmed session" });
    } else if (sessions.length) {
      for (const s of sessions) events.push({ doctor: d, when: s.Date || s.date || "", type: s.Type || s.type || "session" });
    } else {
      events.push({ doctor: d, when: "", type: "Awaiting date" });
    }
  }

  const dateKey = e => e.when || "9999-99-99";
  events.sort((a, b) => dateKey(a).localeCompare(dateKey(b)));

  const rows = events.map(e => `
    <tr data-doctor="${escapeHtml(e.doctor.id)}" style="cursor:pointer">
      <td><strong>${escapeHtml(e.when || "TBD")}</strong></td>
      <td>Dr. ${escapeHtml(e.doctor.name)} ${pill("T"+e.doctor.tier, `pill-tier-${e.doctor.tier}`)}</td>
      <td>${escapeHtml(e.doctor.institution)}</td>
      <td>${escapeHtml(e.doctor.specialty)}</td>
      <td>${pill(e.type)}</td>
      <td>${escapeHtml((e.doctor.next_action || "").replace(/_/g, ' '))}</td>
    </tr>`).join("");

  m.innerHTML = `
    <div class="panel">
      <h2>Confirmed schedule <span class="count">${events.length} entries · ${positive.length} doctors</span></h2>
      <p style="color:var(--ink-faint); font-size:0.85rem; margin:0 0 0.75rem">Doctors who replied positively, with confirmed or pending session dates.</p>
      ${events.length ? `<table class="doctor-table"><thead><tr><th>When</th><th>Doctor</th><th>Institution</th><th>Specialty</th><th>Type</th><th>Next action</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No positive replies yet.</div>`}
    </div>`;

  m.querySelectorAll("tbody tr").forEach(tr => {
    tr.addEventListener("click", () => openDoctor(tr.dataset.doctor));
  });
}

function render() {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
  if (state.view === "outreach") renderOutreach();
  else if (state.view === "confirmed") renderConfirmed();
  else if (state.view === "schedule") renderSchedule();
  else if (state.view === "doctors") renderDoctors();
  else if (state.view === "staged") renderStaged();
  else if (state.view === "institutions") renderInstitutions();
  else if (state.view === "stats") renderStats();
}

window.openDoctor = openDoctor;

document.querySelectorAll("nav button").forEach(b => {
  b.addEventListener("click", () => { state.view = b.dataset.view; render(); });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

function startApp() {
  loadData().then(render).catch(err => {
    document.getElementById("main").innerHTML = `<div class="panel"><h2>Could not load data</h2><pre>${escapeHtml(err.message || err)}</pre><p>Run <code>python3 scripts/dashboard_build.py</code> from the project root, then refresh.</p></div>`;
  });
}

function showAuthGate(message) {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="auth-gate">
      <h2>Doctor Outreach</h2>
      <p>${escapeHtml(message || "Sign in with an authorized Google account to continue.")}</p>
      <div id="gsi-button"></div>
      <p class="auth-hint">Authorized accounts only. Append <code>?local=1</code> for offline view.</p>
    </div>`;
}

function onGoogleCredential(response) {
  authToken = response.credential;
  showAuthGate("Verifying…");
  fetch(`${CONFIG.API_BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: authToken }),
  })
    .then(r => r.json().then(body => ({ ok: r.ok, body })))
    .then(({ ok, body }) => {
      if (!ok || !body.ok) {
        const why = body.error === "email_not_allowlisted"
          ? `${body.email || "That account"} is not on the allowlist.`
          : `Sign-in failed (${body.error || "unknown"}).`;
        showAuthGate(why);
        renderGsiButton();
        return;
      }
      const sub = document.getElementById("build-info");
      if (sub) sub.textContent = `Signed in as ${body.email}`;
      startApp();
    })
    .catch(() => { showAuthGate("Network error verifying sign-in."); renderGsiButton(); });
}

function renderGsiButton() {
  if (!window.google || !google.accounts) return;
  const el = document.getElementById("gsi-button");
  if (el) google.accounts.id.renderButton(el, { theme: "filled_blue", size: "large", text: "signin_with" });
}

function boot() {
  if (isLocalMode()) { startApp(); return; }
  showAuthGate();
  const waitForGsi = setInterval(() => {
    if (window.google && google.accounts) {
      clearInterval(waitForGsi);
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: onGoogleCredential,
      });
      renderGsiButton();
      google.accounts.id.prompt();
    }
  }, 100);
}

boot();

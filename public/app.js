const state = {
  items: [],
  watchlist: [],
  changes: [],
  meta: {},
  category: "All",
  view: "opportunities",
  query: "",
  season: "All",
  application: "All",
  confidence: "All",
  urgentOnly: false,
  selectedId: null,
};

const pipelineStages = ["Interested", "Preparing", "Applied", "Testing", "Interviewing", "Offer"];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function categoryClass(category) {
  if (category.startsWith("Consulting")) return "consulting";
  if (category.startsWith("Investment")) return "finance";
  if (category.startsWith("Supply")) return "operations";
  return "business";
}

function shortCategory(category) {
  return {
    "Consulting": "Consulting",
    "Investment Banking & Finance": "IB & Finance",
    "Supply Chain & Operations": "Supply Chain",
    "General Business Programs": "General Business",
  }[category] || category;
}

function applicationClass(status = "") {
  const lower = status.toLowerCase();
  if (lower.startsWith("open")) return "open";
  if (lower.startsWith("upcoming")) return "upcoming";
  return "monitor";
}

function initials(company) {
  return company.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value) {
  const target = parseDate(value);
  if (!target) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.ceil((target - now) / 86400000);
}

function deadlineInfo(item) {
  const days = daysUntil(item.closingDate);
  if (days !== null) {
    if (days < 0) return { label: "Closed", note: `${Math.abs(days)} days ago`, urgent: false };
    if (days === 0) return { label: "Today", note: "Deadline today", urgent: true };
    if (days <= 7) return { label: formatDate(item.closingDate), note: `${days} days left`, urgent: true };
    if (days <= 14) return { label: formatDate(item.closingDate), note: `${days} days left`, urgent: true };
    if (days <= 30) return { label: formatDate(item.closingDate), note: `${days} days left`, urgent: true };
    return { label: formatDate(item.closingDate), note: `${days} days left`, urgent: false };
  }
  if (/yes|early/i.test(item.rolling || "")) return { label: "Rolling", note: "Apply early", urgent: true };
  if (item.openingDate && daysUntil(item.openingDate) >= 0) return { label: `Opens ${formatDate(item.openingDate)}`, note: item.openingDate.slice(0, 4), urgent: false };
  return { label: "TBC", note: "Monitor source", urgent: false };
}

function formatDate(value, includeYear = false) {
  const parsed = parseDate(value);
  if (!parsed) return "Not published";
  return new Intl.DateTimeFormat("en-HK", { day: "numeric", month: "short", ...(includeYear ? { year: "numeric" } : {}) }).format(parsed);
}

function relativeTime(value) {
  if (!value) return "Not checked yet";
  const parsed = new Date(value);
  const seconds = Math.round((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function isRequestDelayed() {
  const request = state.meta.refreshRequest || {};
  if (!request.requested || !request.requestedAt) return false;
  return Date.now() - new Date(request.requestedAt).getTime() > 2 * 60 * 60 * 1000;
}

function isConfirmed(item) {
  return /confirmed 2027|official 2027/i.test(item.confidence || "") && !/not confirmed|pending/i.test(item.confidence || "");
}

function isUrgent(item) {
  return deadlineInfo(item).urgent && !/closed/i.test(deadlineInfo(item).label);
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.category !== "All" && item.category !== state.category) return false;
    if (state.season !== "All" && !(item.season || "").toLowerCase().includes(state.season.toLowerCase())) return false;
    if (state.application !== "All" && !(item.applicationStatus || "").startsWith(state.application)) return false;
    if (state.confidence === "Confirmed" && !isConfirmed(item)) return false;
    if (state.confidence === "Monitoring" && isConfirmed(item)) return false;
    if (state.urgentOnly && !isUrgent(item)) return false;
    if (query) {
      const haystack = [item.company, item.role, item.category, item.description, item.requirements, item.season].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    const aDeadline = parseDate(a.closingDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDeadline = parseDate(b.closingDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const aOpen = (a.applicationStatus || "").startsWith("Open") ? 0 : 1;
    const bOpen = (b.applicationStatus || "").startsWith("Open") ? 0 : 1;
    return aOpen - bOpen || aDeadline - bDeadline || a.company.localeCompare(b.company);
  });
}

function renderMetrics() {
  const scoped = state.category === "All" ? state.items : state.items.filter((item) => item.category === state.category);
  const open = scoped.filter((item) => (item.applicationStatus || "").startsWith("Open"));
  const upcoming = scoped.filter((item) => item.applicationStatus === "Upcoming");
  const urgent = scoped.filter(isUrgent);
  const inProgress = scoped.filter((item) => !["Interested", "Rejected", "Closed"].includes(item.pipelineStatus));
  $("#openMetric").textContent = open.length;
  $("#upcomingMetric").textContent = upcoming.length;
  $("#urgentMetric").textContent = urgent.length;
  $("#progressMetric").textContent = inProgress.length;
  $("#openMetricNote").textContent = open.length === 1 ? "application currently open" : "currently accepting applications";
  const nearest = [...urgent].sort((a, b) => (parseDate(a.closingDate)?.getTime() || Infinity) - (parseDate(b.closingDate)?.getTime() || Infinity))[0];
  $("#nextActionText").textContent = nearest
    ? `${nearest.company}: ${nearest.role} — ${deadlineInfo(nearest).note}. ${nearest.nextAction || "Review and apply."}`
    : "No confirmed deadline is within 30 days. Continue monitoring official sources.";
}

function renderSidebarCounts() {
  const counts = { All: state.items.length };
  state.items.forEach((item) => { counts[item.category] = (counts[item.category] || 0) + 1; });
  $$('[data-count]').forEach((element) => { element.textContent = counts[element.dataset.count] || 0; });
  $("#navOpportunityCount").textContent = state.items.length;
  $("#navPipelineCount").textContent = state.items.filter((item) => item.pipelineStatus !== "Interested").length;
  $("#sourceIssueCount").textContent = state.changes.length;
}

function renderTable() {
  const items = filteredItems();
  $("#resultCount").textContent = `${items.length} ${items.length === 1 ? "opportunity" : "opportunities"}`;
  $("#emptyState").classList.toggle("hidden", items.length > 0);
  $("#opportunitiesBody").innerHTML = items.map((item) => {
    const deadline = deadlineInfo(item);
    const category = categoryClass(item.category);
    return `
      <tr data-id="${escapeHtml(item.id)}" tabindex="0">
        <td><div class="company-cell"><div class="company-initials">${escapeHtml(initials(item.company))}</div><div class="company-copy"><strong>${escapeHtml(item.company)}</strong><span>${escapeHtml(item.role)}</span></div></div></td>
        <td><span class="industry-tag ${category}">${escapeHtml(shortCategory(item.category))}</span></td>
        <td><span class="status-pill ${applicationClass(item.applicationStatus)}">${escapeHtml(item.applicationStatus)}</span></td>
        <td><div class="date-cell ${deadline.urgent ? "urgent" : ""}"><strong>${escapeHtml(deadline.label)}</strong><span>${escapeHtml(deadline.note)}</span></div></td>
        <td><span class="pipeline-pill">${escapeHtml(item.pipelineStatus)}</span></td>
        <td><a class="source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i data-lucide="badge-check"></i>Official source</a></td>
        <td><button class="icon-button row-action" title="View role details" data-open-id="${escapeHtml(item.id)}"><i data-lucide="chevron-right"></i></button></td>
      </tr>`;
  }).join("");
  $$("#opportunitiesBody tr").forEach((row) => {
    row.addEventListener("click", () => openDrawer(row.dataset.id));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") openDrawer(row.dataset.id); });
  });
  refreshIcons();
}

function renderPipeline() {
  const visibleStages = ["Preparing", "Applied", "Testing", "Interviewing"];
  const activeCount = state.items.filter((item) => visibleStages.includes(item.pipelineStatus)).length;
  $("#pipelineSummary").textContent = `${activeCount} active applications · ${state.items.filter((item) => item.pipelineStatus === "Offer").length} offers`;
  $("#kanbanBoard").innerHTML = visibleStages.map((stage) => {
    const items = state.items.filter((item) => item.pipelineStatus === stage);
    return `<section class="kanban-column" data-status="${stage}">
      <div class="kanban-column-header"><span>${stage}</span><b>${items.length}</b></div>
      <div class="kanban-list">${items.length ? items.map((item) => `<article class="kanban-card" data-id="${escapeHtml(item.id)}"><div class="kanban-card-top"><span class="kanban-card-company">${escapeHtml(item.company)}</span><i class="priority-dot ${escapeHtml(item.priority)}"></i></div><strong>${escapeHtml(item.role)}</strong><div class="kanban-card-footer"><span>${escapeHtml(shortCategory(item.category))}</span><span>${escapeHtml(deadlineInfo(item).label)}</span></div></article>`).join("") : `<div class="empty-column">No roles here</div>`}</div>
    </section>`;
  }).join("");
  $$(".kanban-card").forEach((card) => card.addEventListener("click", () => openDrawer(card.dataset.id)));
}

function renderResearch() {
  const status = state.meta.researchStatus || {};
  const queued = state.meta.refreshRequest?.requested;
  const delayed = isRequestDelayed();
  $("#sourceStats").textContent = `${state.items.length} available or announced · ${state.watchlist.length} watched`;
  $("#agentRunTitle").textContent = state.meta.generatedAt ? `Research updated ${relativeTime(state.meta.generatedAt)}` : "Waiting for first agent run";
  $("#agentRunMessage").textContent = delayed
    ? `The on-demand request has not been processed after ${relativeTime(state.meta.refreshRequest.requestedAt)}. The scheduled weekly agent remains active.`
    : queued
    ? "An on-demand research run is queued. The hourly worker should pick it up within one hour and update this page automatically."
    : (status.message || "The scheduled agent runs every Monday, and on-demand requests are picked up by the hourly worker.");
  $("#agentStatus").textContent = delayed ? "Delayed" : queued ? "Queued" : (status.status || "Waiting");
  $("#agentStatus").className = `agent-status ${delayed ? "delayed" : queued ? "queued" : escapeHtml(status.status || "waiting")}`;
  $("#changesList").innerHTML = state.changes.length
    ? state.changes.map((change) => `<div class="change-item"><i data-lucide="${change.type === "new" ? "circle-plus" : change.type === "closed" ? "circle-x" : "refresh-cw"}"></i><span>${escapeHtml(change.message || change.description || String(change))}</span></div>`).join("")
    : `<div class="change-empty">No changes have been recorded yet.</div>`;
  $("#watchlistCount").textContent = `${state.watchlist.length} ${state.watchlist.length === 1 ? "programme" : "programmes"}`;
  $("#watchlistBody").innerHTML = state.watchlist.length ? state.watchlist.map((item) => `<tr><td><div class="company-copy"><strong>${escapeHtml(item.company || "Unknown employer")}</strong><span>${escapeHtml(item.role || item.program || "Programme watch")}</span></div></td><td><span class="industry-tag ${categoryClass(item.category || "General Business Programs")}">${escapeHtml(shortCategory(item.category || "General Business Programs"))}</span></td><td>${escapeHtml(item.notes || item.reason || item.nextAction || "Awaiting a confirmed opening")}</td><td><a class="source-link" href="${escapeHtml(item.sourceUrl || item.officialUrl || "#")}" target="_blank" rel="noopener"><i data-lucide="external-link"></i>Official page</a></td></tr>`).join("") : `<tr><td colspan="4">The agent has not added any programmes to the watchlist.</td></tr>`;
  refreshIcons();
}

function renderSyncState() {
  if (state.meta.deploymentMode === "vercel") {
    const dot = $(".sync-dot");
    dot.className = "sync-dot good";
    $("#syncState strong").textContent = "Public research feed";
    $("#syncState span").textContent = state.meta.generatedAt ? relativeTime(state.meta.generatedAt) : "Waiting for first publication";
    const button = $("#refreshButton");
    button.disabled = true;
    button.title = "Hosted research updates are published automatically";
    button.innerHTML = '<i data-lucide="calendar-check"></i><span>Weekly updates</span>';
    return;
  }
  const queued = state.meta.refreshRequest?.requested;
  const delayed = isRequestDelayed();
  const latest = state.meta.generatedAt;
  const dot = $(".sync-dot");
  dot.className = "sync-dot";
  if (delayed) {
    dot.classList.add("bad");
    $("#syncState strong").textContent = "Research delayed";
    $("#syncState span").textContent = "On-demand worker has not responded";
  } else if (queued) {
    $("#syncState strong").textContent = "Research queued";
    $("#syncState span").textContent = "Expected within one hour";
  } else if (latest) {
    dot.classList.add("good");
    $("#syncState strong").textContent = "Research current";
    $("#syncState span").textContent = relativeTime(latest);
  } else {
    $("#syncState strong").textContent = "Awaiting research";
    $("#syncState span").textContent = "Queue the first agent run";
  }
}

function renderAll() {
  renderSidebarCounts();
  renderMetrics();
  renderTable();
  renderPipeline();
  renderResearch();
  renderSyncState();
  refreshIcons();
}

function detailSection(title, content) {
  if (!content) return "";
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(content)}</p></section>`;
}

function openDrawer(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  state.selectedId = id;
  const deadline = deadlineInfo(item);
  $("#drawerCategory").textContent = item.category;
  $("#drawerTitle").textContent = item.role;
  $("#drawerCompany").textContent = `${item.company} · ${item.location}`;
  $("#officialLink").href = item.sourceUrl;
  $("#drawerContent").innerHTML = `
    <div class="detail-grid">
      <div class="detail-fact"><span>Application</span><strong>${escapeHtml(item.applicationStatus)}</strong></div>
      <div class="detail-fact"><span>Deadline</span><strong>${escapeHtml(deadline.label)} · ${escapeHtml(deadline.note)}</strong></div>
      <div class="detail-fact"><span>Placement</span><strong>${escapeHtml(item.placementTimeline || item.season)}</strong></div>
      <div class="detail-fact"><span>Date confidence</span><strong>${escapeHtml(item.confidence)}</strong></div>
    </div>
    <div class="detail-controls">
      <label>Pipeline stage<select id="drawerPipeline">${pipelineStages.map((stage) => `<option ${stage === item.pipelineStatus ? "selected" : ""}>${stage}</option>`).join("")}<option ${item.pipelineStatus === "Rejected" ? "selected" : ""}>Rejected</option><option ${item.pipelineStatus === "Closed" ? "selected" : ""}>Closed</option></select></label>
      <label>Priority<select id="drawerPriority"><option ${item.priority === "High" ? "selected" : ""}>High</option><option ${item.priority === "Medium" ? "selected" : ""}>Medium</option><option ${item.priority === "Low" ? "selected" : ""}>Low</option></select></label>
      <label class="notes-control">Your notes<textarea id="drawerNotes" rows="3" placeholder="Networking, application tasks, interview notes...">${escapeHtml(item.userNotes || "")}</textarea></label>
    </div>
    ${detailSection("Role overview", item.description)}
    ${detailSection("Requirements", item.requirements)}
    ${detailSection("Language and work rights", item.languageWorkRights)}
    ${detailSection("Recruitment stages", item.recruitmentStages)}
    ${detailSection("Document checklist", item.documents)}
    ${detailSection("Next action", item.nextAction)}
    ${detailSection("Timeline notes", item.notes)}
  `;
  ["drawerPipeline", "drawerPriority", "drawerNotes"].forEach((elementId) => {
    $("#" + elementId).addEventListener(elementId === "drawerNotes" ? "change" : "change", saveDrawerState);
  });
  $("#drawerBackdrop").classList.remove("hidden");
  $("#detailDrawer").classList.add("open");
  $("#detailDrawer").setAttribute("aria-hidden", "false");
  refreshIcons();
}

function closeDrawer() {
  $("#drawerBackdrop").classList.add("hidden");
  $("#detailDrawer").classList.remove("open");
  $("#detailDrawer").setAttribute("aria-hidden", "true");
  state.selectedId = null;
}

async function saveDrawerState() {
  if (!state.selectedId) return;
  const item = state.items.find((candidate) => candidate.id === state.selectedId);
  const payload = {
    id: state.selectedId,
    pipelineStatus: $("#drawerPipeline").value,
    priority: $("#drawerPriority").value,
    userNotes: $("#drawerNotes").value,
  };
  if (state.meta.deploymentMode === "vercel") {
    const saved = JSON.parse(localStorage.getItem("hkInternshipPipeline") || "{}");
    saved[state.selectedId] = payload;
    localStorage.setItem("hkInternshipPipeline", JSON.stringify(saved));
    Object.assign(item, payload);
    renderAll();
    showToast("Application pipeline saved in this browser");
    return;
  }
  const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) return showToast("Could not save the application update");
  Object.assign(item, payload);
  renderAll();
  showToast("Application pipeline updated");
}

function switchView(view) {
  state.view = view;
  const labels = {
    opportunities: ["Opportunity radar", "Winter 2026–27 and Summer 2027, based in Hong Kong"],
    pipeline: ["Application pipeline", "Your preparation, applications, tests and interviews"],
    research: ["Research updates", "New openings, deadline changes and the agent watchlist"],
  };
  $$(".view").forEach((element) => element.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $$(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#viewTitle").textContent = labels[view][0];
  $("#viewSubtitle").textContent = labels[view][1];
  $("#sidebar").classList.remove("open");
}

async function loadData({ quiet = false } = {}) {
  try {
    const response = await fetch("/api/opportunities", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.items = data.items;
    state.watchlist = data.watchlist || [];
    state.changes = data.changes || [];
    state.meta = data.meta;
    if (state.meta.deploymentMode === "vercel") {
      const saved = JSON.parse(localStorage.getItem("hkInternshipPipeline") || "{}");
      state.items.forEach((item) => Object.assign(item, saved[item.id] || {}));
    }
    renderAll();
  } catch (error) {
    if (!quiet) showToast("The tracker server could not load the internship data");
  }
}

async function refreshSources() {
  if (state.meta.refreshSupported === false) {
    showToast("Hosted research is published automatically through scheduled deployments");
    return;
  }
  const button = $("#refreshButton");
  button.disabled = true;
  const response = await fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Flexible refresh requested from dashboard" }) });
  if (response.status !== 202 && response.status !== 409) {
    button.disabled = false;
    return showToast("The research request could not be queued");
  }
  await loadData({ quiet: true });
  button.disabled = false;
  showToast(response.status === 409 ? "A research run is already queued" : "Research queued for the hourly agent");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function clearFilters() {
  state.query = "";
  state.season = "All";
  state.application = "All";
  state.confidence = "All";
  state.urgentOnly = false;
  state.category = "All";
  $("#searchInput").value = "";
  $("#seasonFilter").value = "All";
  $("#applicationFilter").value = "All";
  $("#confidenceFilter").value = "All";
  $$(".category-item").forEach((element) => element.classList.toggle("selected", element.dataset.category === "All"));
  renderAll();
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function bindEvents() {
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$(".category-item").forEach((item) => item.addEventListener("click", () => {
    state.category = item.dataset.category;
    state.urgentOnly = false;
    $$(".category-item").forEach((element) => element.classList.toggle("selected", element === item));
    switchView("opportunities");
    renderAll();
  }));
  $("#searchInput").addEventListener("input", (event) => { state.query = event.target.value; renderTable(); });
  $("#seasonFilter").addEventListener("change", (event) => { state.season = event.target.value; renderTable(); });
  $("#applicationFilter").addEventListener("change", (event) => { state.application = event.target.value; renderTable(); });
  $("#confidenceFilter").addEventListener("change", (event) => { state.confidence = event.target.value; renderTable(); });
  $("#clearFilters").addEventListener("click", clearFilters);
  $("#viewUrgentButton").addEventListener("click", () => { state.urgentOnly = true; renderTable(); showToast("Showing urgent applications only"); });
  $("#refreshButton").addEventListener("click", refreshSources);
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  refreshIcons();
  await loadData();
  setInterval(() => loadData({ quiet: true }), 60000);
});

const PAGE_SIZE = 50;

const state = {
  records: [],
  newIds: new Set(),
  filtered: [],
  page: 1
};

const els = {
  sourceDate: document.querySelector("#sourceDate"),
  totalRecords: document.querySelector("#totalRecords"),
  newRecords: document.querySelector("#newRecords"),
  visibleRecords: document.querySelector("#visibleRecords"),
  latestAction: document.querySelector("#latestAction"),
  query: document.querySelector("#query"),
  category: document.querySelector("#category"),
  submissionType: document.querySelector("#submissionType"),
  dateFrom: document.querySelector("#dateFrom"),
  dateTo: document.querySelector("#dateTo"),
  newOnly: document.querySelector("#newOnly"),
  authorizedOnly: document.querySelector("#authorizedOnly"),
  reset: document.querySelector("#reset"),
  download: document.querySelector("#download"),
  sort: document.querySelector("#sort"),
  rows: document.querySelector("#rows"),
  scanNote: document.querySelector("#scanNote"),
  resultTitle: document.querySelector("#resultTitle"),
  prev: document.querySelector("#prev"),
  next: document.querySelector("#next"),
  pageInfo: document.querySelector("#pageInfo"),
  emptyTemplate: document.querySelector("#emptyTemplate")
};

init().catch((error) => {
  els.scanNote.textContent = "The registry data could not be loaded.";
  els.rows.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
});

async function init() {
  const [current, changes] = await Promise.all([
    fetchJson("data/current.json"),
    fetchJson("data/changes.json")
  ]);

  state.records = current.records.map((record) => ({
    ...record,
    searchText: buildSearchText(record)
  }));
  state.newIds = new Set((changes.newRecords ?? []).map((record) => record.id));

  fillSelect(els.category, "All categories", uniqueValues(state.records, "category"));
  fillSelect(els.submissionType, "All authorities", uniqueValues(state.records, "submissionType"));

  els.sourceDate.textContent = `FDA data as of ${current.asOf ?? "unknown"}; scanned ${formatDateTime(current.generatedAt)}`;
  els.totalRecords.textContent = formatNumber(current.totalRecords);
  els.newRecords.textContent = formatNumber(changes.newRecordCount ?? 0);
  els.latestAction.textContent = formatDisplayDate(findLatestActionDate(state.records));
  els.scanNote.textContent = changes.firstRun
    ? "Baseline scan complete. New products will be flagged after the next update."
    : `${formatNumber(changes.newRecordCount)} records were added since the previous scan.`;

  bindEvents();
  applyFilters();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Missing ${path}. Run the data update first.`);
  }
  return response.json();
}

function bindEvents() {
  [
    els.query,
    els.category,
    els.submissionType,
    els.dateFrom,
    els.dateTo,
    els.newOnly,
    els.authorizedOnly,
    els.sort
  ].forEach((element) => element.addEventListener("input", () => {
    state.page = 1;
    applyFilters();
  }));

  els.reset.addEventListener("click", () => {
    els.query.value = "";
    els.category.value = "";
    els.submissionType.value = "";
    els.dateFrom.value = "";
    els.dateTo.value = "";
    els.newOnly.checked = false;
    els.authorizedOnly.checked = false;
    els.sort.value = "date-desc";
    state.page = 1;
    applyFilters();
  });

  els.prev.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderRows();
  });

  els.next.addEventListener("click", () => {
    state.page = Math.min(totalPages(), state.page + 1);
    renderRows();
  });

  els.download.addEventListener("click", downloadFilteredCsv);
}

function applyFilters() {
  const terms = els.query.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const category = els.category.value;
  const submissionType = els.submissionType.value;
  const from = els.dateFrom.value;
  const to = els.dateTo.value;

  state.filtered = state.records.filter((record) => {
    if (terms.length && !terms.every((term) => record.searchText.includes(term))) return false;
    if (category && record.category !== category) return false;
    if (submissionType && record.submissionType !== submissionType) return false;
    if (from && (!record.actionDateIso || record.actionDateIso < from)) return false;
    if (to && (!record.actionDateIso || record.actionDateIso > to)) return false;
    if (els.newOnly.checked && !state.newIds.has(record.id)) return false;
    if (els.authorizedOnly.checked && record.submissionType === "SE - Removed From Review") return false;
    return true;
  });

  sortRecords(state.filtered, els.sort.value);
  els.visibleRecords.textContent = formatNumber(state.filtered.length);
  els.resultTitle.textContent = els.newOnly.checked ? "New products" : "Products";
  renderRows();
}

function renderRows() {
  const pages = totalPages();
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = state.filtered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    els.rows.replaceChildren(els.emptyTemplate.content.cloneNode(true));
  } else {
    els.rows.innerHTML = pageRows.map(renderRow).join("");
  }

  els.pageInfo.textContent = `Page ${state.page} of ${pages}`;
  els.prev.disabled = state.page <= 1;
  els.next.disabled = state.page >= pages;
}

function renderRow(record) {
  const isNew = state.newIds.has(record.id);
  const docs = [
    ["Order", record.orderLetter],
    ["Summary", record.decisionSummary],
    ["EA", record.environmentalAssessment],
    ["FONSI", record.fonsi]
  ]
    .filter(([, url]) => Boolean(url))
    .map(([label, url]) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`)
    .join("");

  return `
    <tr class="${isNew ? "is-new" : ""}">
      <td><span class="company">${escapeHtml(record.company || "-")}</span></td>
      <td>
        <div class="product">
          <strong>${escapeHtml(record.productName || "-")}</strong>
          ${isNew ? "<span class=\"tag\">New</span>" : ""}
          ${record.additionalInformation ? `<span class="subtle">${escapeHtml(record.additionalInformation)}</span>` : ""}
        </div>
      </td>
      <td>
        ${escapeHtml(record.category || "-")}
        ${record.subCategory ? `<div class="subtle">${escapeHtml(record.subCategory)}</div>` : ""}
      </td>
      <td class="authority">${escapeHtml(record.submissionType || "-")}</td>
      <td>${formatDisplayDate(record.actionDateIso) || escapeHtml(record.actionDate || "-")}</td>
      <td>
        ${escapeHtml(record.stn || "-")}
        ${record.associatedMrtp ? `<div class="subtle">MRTP ${escapeHtml(record.associatedMrtp)}</div>` : ""}
      </td>
      <td><div class="docs">${docs || "<span class=\"subtle\">None listed</span>"}</div></td>
    </tr>
  `;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
}

function fillSelect(select, defaultLabel, values) {
  select.innerHTML = [
    `<option value="">${defaultLabel}</option>`,
    ...values.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`)
  ].join("");
}

function uniqueValues(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function sortRecords(records, mode) {
  const byText = (key) => (a, b) => (a[key] || "").localeCompare(b[key] || "");
  const byDate = (direction) => (a, b) => {
    const left = a.actionDateIso || "0000-00-00";
    const right = b.actionDateIso || "0000-00-00";
    return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  };

  const sorters = {
    "date-desc": byDate("desc"),
    "date-asc": byDate("asc"),
    "company-asc": byText("company"),
    "product-asc": byText("productName")
  };

  records.sort(sorters[mode] ?? sorters["date-desc"]);
}

function buildSearchText(record) {
  return [
    record.company,
    record.productName,
    record.category,
    record.subCategory,
    record.submissionType,
    record.stn,
    record.associatedMrtp,
    record.additionalInformation
  ]
    .join(" ")
    .toLowerCase();
}

function findLatestActionDate(records) {
  return records.reduce((latest, record) => {
    if (!record.actionDateIso) return latest;
    return record.actionDateIso > latest ? record.actionDateIso : latest;
  }, "");
}

function downloadFilteredCsv() {
  const headers = [
    "Company",
    "Product Name",
    "Category",
    "Sub-Category",
    "Submission Type - Marketing Authority",
    "Date of Action",
    "STN",
    "Associated MRTP",
    "Additional Information"
  ];
  const keys = [
    "company",
    "productName",
    "category",
    "subCategory",
    "submissionType",
    "actionDate",
    "stn",
    "associatedMrtp",
    "additionalInformation"
  ];
  const csv = [
    headers.map(csvCell).join(","),
    ...state.filtered.map((record) => keys.map((key) => csvCell(record[key] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tobacco-product-registry-results.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDateTime(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDisplayDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

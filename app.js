// app.js
import { parseReportText, extractCollectedAt } from "./parser.js";
import { addReportMeasurements, clearAll, getAllMeasurements } from "./storage.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";

const el = (id) => document.getElementById(id);

const fileInput = el("fileInput");
const btnParse = el("btnParse");
const btnSave = el("btnSave");
const btnClear = el("btnClear");
const btnExport = el("btnExport");
const status = el("status");

const reviewMeta = el("reviewMeta");
const reviewTableWrap = el("reviewTableWrap");
const metricSelect = el("metricSelect");
const historyTableWrap = el("historyTableWrap");

let parsedDraft = null; // { collectedAtISO, sourceName, measurements[] }
let chart = null;

fileInput.addEventListener("change", () => {
  btnParse.disabled = !fileInput.files?.length;
  btnSave.disabled = true;
  parsedDraft = null;
  reviewMeta.textContent = "";
  reviewTableWrap.innerHTML = "";
});

btnClear.addEventListener("click", async () => {
  await clearAll();
  status.textContent = "Cleared all saved measurements.";
  await refreshHistoryUI();
});

btnParse.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  status.textContent = "Extracting text from PDF...";
  btnParse.disabled = true;
  btnSave.disabled = true;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join("\n");
      fullText += pageText + "\n";
    }

    const dt = extractCollectedAt(fullText);
    const collectedAtISO = dt ? toISO(dt.datePart, dt.timePart) : new Date().toISOString();
    const measurements = parseReportText(fullText);

    if (!measurements.length) {
      status.textContent = "No measurements detected. This may be a scanned PDF (needs OCR).";
      btnParse.disabled = false;
      return;
    }

    parsedDraft = {
      collectedAtISO,
      sourceName: file.name,
      measurements,
    };

    status.textContent = `Parsed ${measurements.length} measurements. Review and save.`;
    renderReview(parsedDraft);
    btnSave.disabled = false;
  } catch (e) {
    console.error(e);
    status.textContent = "Failed to parse PDF. See console for details.";
  } finally {
    btnParse.disabled = false;
  }
});

btnSave.addEventListener("click", async () => {
  if (!parsedDraft) return;
  const reportId = crypto.randomUUID();

  const cleaned = {
    ...parsedDraft,
    reportId,
    measurements: parsedDraft.measurements
      .filter(m => m.key && typeof m.value === "number" && !Number.isNaN(m.value))
  };

  const all = await addReportMeasurements(cleaned);
  status.textContent = `Saved report. Total stored points: ${all.length}.`;

  parsedDraft = null;
  btnSave.disabled = true;
  reviewMeta.textContent = "";
  reviewTableWrap.innerHTML = "";

  await refreshHistoryUI();
});

btnExport.addEventListener("click", async () => {
  const all = await getAllMeasurements();
  const csv = toCSV(all);
  downloadText("lab_measurements.csv", csv);
});

metricSelect.addEventListener("change", async () => {
  await renderSelectedMetric();
});

function renderReview(draft) {
  reviewMeta.textContent = `Collection time: ${new Date(draft.collectedAtISO).toLocaleString()} | Source: ${draft.sourceName}`;

  // Editable table so user can fix parsing mistakes
  const rows = draft.measurements.map((m, idx) => `
    <tr>
      <td>${escapeHtml(m.panel || "")}</td>
      <td><input data-idx="${idx}" data-field="name" value="${escapeHtml(m.name || "")}" /></td>
      <td><input data-idx="${idx}" data-field="value" value="${m.value ?? ""}" /></td>
      <td><input data-idx="${idx}" data-field="unit" value="${escapeHtml(m.unit || "")}" /></td>
      <td><input data-idx="${idx}" data-field="refText" value="${escapeHtml(m.refText || refRangeToText(m.refLow, m.refHigh) || "")}" /></td>
    </tr>
  `).join("");

  reviewTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Panel</th>
          <th>Test</th>
          <th>Value</th>
          <th>Unit</th>
          <th>Reference</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Bind edits back into parsedDraft
  reviewTableWrap.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = Number(inp.dataset.idx);
      const field = inp.dataset.field;

      if (!parsedDraft) return;
      const m = parsedDraft.measurements[idx];
      if (!m) return;

      if (field === "value") {
        m.value = Number(inp.value);
      } else {
        m[field] = inp.value;
      }
    });
  });
}

async function refreshHistoryUI() {
  const all = await getAllMeasurements();
  renderMetricDropdown(all);
  await renderSelectedMetric();
}

function renderMetricDropdown(all) {
  const keys = Array.from(new Set(all.map(m => m.key))).sort();
  metricSelect.innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join("");
  if (!keys.length) {
    metricSelect.innerHTML = `<option value="">(no data)</option>`;
  }
}

async function renderSelectedMetric() {
  const all = await getAllMeasurements();
  const key = metricSelect.value;
  if (!key) {
    historyTableWrap.innerHTML = "";
    if (chart) chart.destroy();
    return;
  }

  const series = all
    .filter(m => m.key === key)
    .sort((a, b) => a.collectedAtISO.localeCompare(b.collectedAtISO));

  renderHistoryTable(series);
  renderChart(series);
}

function renderHistoryTable(series) {
  const rows = series.map(m => `
    <tr>
      <td>${new Date(m.collectedAtISO).toLocaleDateString()}</td>
      <td>${escapeHtml(m.name || "")}</td>
      <td>${m.value ?? ""}</td>
      <td>${escapeHtml(m.unit || "")}</td>
      <td>${m.flag || ""}</td>
      <td>${escapeHtml(m.sourceName || "")}</td>
    </tr>
  `).join("");

  historyTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Test</th>
          <th>Value</th>
          <th>Unit</th>
          <th>Flag</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderChart(series) {
  const ctx = el("chart");

  const labels = series.map(m => new Date(m.collectedAtISO).toLocaleDateString());
  const data = series.map(m => m.value);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: series[0]?.name || series[0]?.key || "Metric",
          data,
          tension: 0.2,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#e6edf3" } },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { color: "#93a4b8" }, grid: { color: "#223043" } },
        y: { ticks: { color: "#93a4b8" }, grid: { color: "#223043" } },
      },
    },
  });
}

function toISO(datePart, timePart) {
  // expects dd/mm/yyyy
  const [dd, mm, yyyyRaw] = datePart.split("/").map(s => s.trim());
  const yyyy = yyyyRaw.length === 2 ? `20${yyyyRaw}` : yyyyRaw;

  let hours = 0;
  let minutes = 0;

  const t = timePart.trim().match(/^([0-9]{1,2}):([0-9]{2})\s*(AM|PM|am|pm)?$/);
  if (t) {
    hours = Number(t[1]);
    minutes = Number(t[2]);
    const ampm = t[3]?.toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
  }

  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hours, minutes, 0));
  return d.toISOString();
}

function refRangeToText(low, high) {
  if (typeof low === "number" && typeof high === "number") return `${low}-${high}`;
  return null;
}

function toCSV(rows) {
  const cols = ["collectedAtISO","panel","key","name","value","unit","refLow","refHigh","refText","flag","reportId","sourceName","rawLine"];
  const escape = (v) => `"${String(v ?? "").replaceAll(`"`, `""`)}"`;
  return [cols.join(",")]
    .concat(rows.map(r => cols.map(c => escape(r[c])).join(",")))
    .join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;");
}

// init
refreshHistoryUI();

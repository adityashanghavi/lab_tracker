// parser.js
// Parses lab report text into structured measurements.
// Designed for table-like lines found in many lab PDFs.
//
// Output measurement shape:
// { key, name, value, unit, refLow, refHigh, refText, panel, flag, rawLine }

function normalizeKey(name) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")        // remove parentheticals
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function parseRef(refStr) {
  if (!refStr) return { refLow: null, refHigh: null, refText: null };
  const s = refStr.trim();

  // inequalities like "<5.0" or ">=126"
  const ineq = s.match(/^([<>]=?)\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (ineq) return { refLow: null, refHigh: null, refText: s };

  // ranges like "14-18" or "4.4 - 6.0"
  const range = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (range) {
    return { refLow: Number(range[1]), refHigh: Number(range[2]), refText: null };
  }

  // sometimes "0 - 15" with spaces already handled above; fallback to refText
  return { refLow: null, refHigh: null, refText: s };
}

function computeFlag(value, refLow, refHigh, refText) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (typeof refLow === "number" && value < refLow) return "L";
  if (typeof refHigh === "number" && value > refHigh) return "H";

  // If refText exists (like "<5.0"), you can optionally flag, but keep simple for MVP.
  return null;
}

function looksLikePanelHeader(line) {
  // Heuristic: headers often are short, title-ish, no numeric value
  // e.g., "CBC HAEMOGRAM", "LIPID PROFILE", etc.
  if (!line) return false;
  const s = line.trim();
  if (s.length < 4 || s.length > 45) return false;
  if (/[0-9]/.test(s)) return false;
  // lots of caps is a hint
  const caps = s.replace(/[^A-Z]/g, "").length;
  return caps >= Math.min(8, s.length * 0.5);
}

function parseMeasurementLine(line) {
  // Typical pattern:
  // "Haemoglobin (Hb) 12.3 gm/dL 14-18"
  // "C-Reactive Protein (CRP) 28.42 mg/L <5.0"
  //
  // We'll extract:
  // name: left chunk
  // value: first numeric token after name
  // unit: token(s) following value (letters / / % etc.)
  // ref: trailing chunk (range or inequality) optional

  const s = line.replace(/\s+/g, " ").trim();
  if (!s) return null;

  // Must contain a numeric value to be a measurement line
  const valueMatch = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!valueMatch) return null;

  const valueIdx = valueMatch.index;
  const namePart = s.slice(0, valueIdx).trim();
  if (!namePart) return null;

  const afterValue = s.slice(valueIdx).trim();

  // afterValue begins with number; split into tokens
  const tokens = afterValue.split(" ");
  const value = Number(tokens[0]);
  if (Number.isNaN(value)) return null;

  // unit: collect tokens after value until we hit something that looks like a ref range/ineq
  // Ref candidates often contain '-' or '<' or '>' or are purely numeric range.
  let unitTokens = [];
  let refTokens = [];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    const isRefStart =
      t.includes("-") ||
      t.startsWith("<") ||
      t.startsWith(">") ||
      /^[0-9]+(?:\.[0-9]+)?$/.test(t) && (i === tokens.length - 1); // last numeric token as possible ref

    if (!isRefStart && refTokens.length === 0) unitTokens.push(t);
    else refTokens.push(t);
  }

  const unit = unitTokens.join(" ").trim() || null;
  const refStr = refTokens.join(" ").trim() || null;

  const { refLow, refHigh, refText } = parseRef(refStr);
  const flag = computeFlag(value, refLow, refHigh, refText);

  const name = namePart;
  const key = normalizeKey(name);

  return { key, name, value, unit, refLow, refHigh, refText, flag, rawLine: s };
}

export function parseReportText(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  let panel = "General";
  const measurements = [];

  for (const line of lines) {
    if (looksLikePanelHeader(line)) {
      panel = line.replace(/\s+/g, " ").trim();
      continue;
    }

    const m = parseMeasurementLine(line);
    if (m) measurements.push({ ...m, panel });
  }

  return measurements;
}

// Try to find collection date-time in the text (varies by report)
export function extractCollectedAt(rawText) {
  // Example formats to catch: "Collected On : 16/01/2026 1:40PM"
  const patterns = [
    /Collected\s*On\s*[:\-]?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})\s+([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM|am|pm)?)/,
    /Collection\s*Date\s*[:\-]?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/,
  ];

  for (const re of patterns) {
    const m = rawText.match(re);
    if (m) {
      const datePart = m[1];
      const timePart = m[2] || "00:00";
      return { datePart, timePart };
    }
  }
  return null;
}

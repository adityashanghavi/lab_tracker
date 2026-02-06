// storage.js
// Stores reports + measurements in IndexedDB via localforage.

const db = localforage.createInstance({ name: "lab_trend_tracker" });

export async function getAllMeasurements() {
  return (await db.getItem("measurements")) || [];
}

export async function saveMeasurements(all) {
  await db.setItem("measurements", all);
}

export async function clearAll() {
  await db.clear();
}

export async function addReportMeasurements(report) {
  // report: { reportId, collectedAtISO, sourceName, measurements: [...] }
  const existing = await getAllMeasurements();
  const merged = existing.concat(
    report.measurements.map(m => ({
      ...m,
      collectedAtISO: report.collectedAtISO,
      reportId: report.reportId,
      sourceName: report.sourceName,
    }))
  );
  await saveMeasurements(merged);
  return merged;
}

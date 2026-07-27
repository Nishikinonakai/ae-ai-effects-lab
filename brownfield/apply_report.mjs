// apply_report.mjs — pure inspection helpers for apply_edit's per-operation report.

export function applyReportErrors(report) {
  return (report?.applied || []).filter(entry => entry && entry.error);
}

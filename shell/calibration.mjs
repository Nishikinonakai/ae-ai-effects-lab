// calibration.mjs — deterministic threshold evidence from human Keep/Roll back labels.
//
// The visual judge score is not truth; the artist's later decision is. This module does not pick a
// product policy from thin data. It only answers, for every candidate bar: how many labeled results
// would have auto-accepted, how many of those the artist rolled back, and how many scored Keeps the
// bar would cover.

export function summarizeDecisions(rows) {
  const valid = (rows || []).filter(r => r && (r.decision === 'keep' || r.decision === 'rollback'));
  const scored = valid.filter(r => Number.isFinite(r.score));
  const scoredKeeps = scored.filter(r => r.decision === 'keep').length;
  const byScore = {};
  for (const r of scored) {
    const key = String(r.score);
    if (!byScore[key]) byScore[key] = { keep: 0, rollback: 0 };
    byScore[key][r.decision]++;
  }

  const candidates = [];
  for (let bar = 1; bar <= 10; bar++) {
    const auto = scored.filter(r => r.score >= bar);
    const trueAccepts = auto.filter(r => r.decision === 'keep').length;
    const falseAccepts = auto.filter(r => r.decision === 'rollback').length;
    candidates.push({
      bar,
      autoAccepts: auto.length,
      trueAccepts,
      falseAccepts,
      precision: auto.length ? trueAccepts / auto.length : null,
      keepCoverage: scoredKeeps ? trueAccepts / scoredKeeps : null,
    });
  }

  // Lowest observed bar with zero labeled false-accepts. "Observed" matters: a bar above every
  // sample is vacuously safe but proves nothing.
  const safe = candidates.find(c => c.autoAccepts > 0 && c.falseAccepts === 0);
  return {
    labels: valid.length,
    scored: scored.length,
    unscored: valid.length - scored.length,
    keeps: valid.filter(r => r.decision === 'keep').length,
    rollbacks: valid.filter(r => r.decision === 'rollback').length,
    scoredKeeps,
    byScore,
    candidates,
    lowestObservedZeroFalseAcceptBar: safe?.bar ?? null,
  };
}

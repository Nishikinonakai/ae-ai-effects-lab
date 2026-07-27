// handoff_feedback.mjs — labels for honest zero-edit outcomes.
//
// Keep/Roll back calibrates whether an APPLIED visual result was worth keeping. A capability or
// planner handoff has no applied result and often no score, so mixing it into decisions.jsonl would
// corrupt that calibration set. It still needs human feedback: was the refusal/explanation useful?
// This module gives the two datasets distinct schemas and files.
import fs from 'fs';

export function handoffFeedbackRow(state, action, now = new Date()) {
  if (state?.phase !== 'handoff' || !state?.canRateHandoff) return null;
  if (action !== 'accept' && action !== 'rollback') return null;
  return {
    ts: now.toISOString(),
    feedback: action === 'accept' ? 'helpful' : 'not_enough',
    intent: state.intent || null,
    rationale: state.rationale || state.message || null,
    handoffCode: state.handoffCode || null,
    engine: state.engine || null,
  };
}

export function appendHandoffFeedback(file, state, action, now = new Date()) {
  const row = handoffFeedbackRow(state, action, now);
  if (!row) return null;
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

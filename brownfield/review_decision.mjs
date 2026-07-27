// review_decision.mjs — reconcile the scorer's semantic verdict with the numeric auto-accept bar.
//
// "pass, 7/10" means the intent is met but confidence is below the unattended-accept threshold.
// Continuing to tune can destroy a result the judge already considers correct; auto-accepting it
// would silently lower the configured bar. The safe third state is a user handoff.

export function reviewDecision({ score, verdict, acceptBar = 8, rollbackBar = 4 }) {
  if (score >= acceptBar) return 'accept';
  if (String(verdict || '').toLowerCase() === 'pass' && score > rollbackBar) return 'handoff';
  if (score <= rollbackBar) return 'rollback';
  return 'tune';
}

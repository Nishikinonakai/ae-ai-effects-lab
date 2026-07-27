// tune_policy.mjs — the public meaning of "passes": exactly this many scored reviews.

export function iterationNumbers(requested) {
  const n = Number(requested);
  const count = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  return Array.from({ length: count }, (_, i) => i);
}

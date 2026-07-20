// budget.mjs — set and inspect the spend cap.
//
// PRD §12.3 puts a HARD GATE first, above every other screen, and today is the argument: £5.72 left
// this project in a day and 98% of it went to measurement nobody asked for. A meter tells you
// afterwards. A gate is what would have stopped it.
//
// Two caps, doing different jobs:
//   dailyUsd      — the ceiling. Everything that spends money asserts against it, including
//                   experiments, which is where today's money actually went.
//   perRequestUsd — the runaway guard. A tune that keeps finding "one more thing to try" should not
//                   be able to spend the day's budget on a single sentence.
//
// Both default to OFF. A tool that refuses to work on first run because of a limit nobody chose is
// worse than one that spends a little.
//
// usage:
//   node shell/budget.mjs                 show the cap and today's spend against it
//   node shell/budget.mjs daily 2.00      cap the day at $2
//   node shell/budget.mjs request 0.10    cap one request at 10c
//   node shell/budget.mjs off             remove the caps
import path from 'path';
import { fileURLToPath } from 'url';
import { budget, setBudget, spendSummary } from './llm.mjs';

const money = n => '$' + Number(n).toFixed(n < 1 ? 4 : 2);

export function budgetStatus() {
  const b = budget();
  const day = spendSummary({ sinceMs: 24 * 3600 * 1000 });
  return {
    ...b,
    spentToday: day.total,
    calls: day.calls,
    remaining: b.dailyUsd ? Math.max(0, b.dailyUsd - day.total) : null,
    exceeded: !!(b.dailyUsd && day.total >= b.dailyUsd),
    fraction: b.dailyUsd ? Math.min(1, day.total / b.dailyUsd) : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [cmd, val] = process.argv.slice(2);

  if (!cmd) {
    const s = budgetStatus();
    console.log(`today:  ${money(s.spentToday)}  (${s.calls} calls)`);
    console.log(`daily cap:   ${s.dailyUsd ? money(s.dailyUsd) + (s.exceeded ? '  ⚠ REACHED — calls are being refused' : `  · ${money(s.remaining)} left`) : 'off'}`);
    console.log(`per-request: ${s.perRequestUsd ? money(s.perRequestUsd) : 'off'}`);
    if (!s.dailyUsd) console.log('\nNo cap set. `node shell/budget.mjs daily 2.00` caps the day at $2.');

  } else if (cmd === 'off') {
    setBudget({ dailyUsd: null, perRequestUsd: null });
    console.log('caps removed — spending is unlimited again.');

  } else if (cmd === 'daily' || cmd === 'request') {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) { console.error(`give a positive dollar amount, e.g. \`${cmd} 2.00\``); process.exit(1); }
    const next = setBudget(cmd === 'daily' ? { dailyUsd: n } : { perRequestUsd: n });
    console.log(`${cmd} cap set to ${money(n)}`);
    const s = budgetStatus();
    if (cmd === 'daily' && s.exceeded) console.log(`⚠ today's spend (${money(s.spentToday)}) is already at or over that — calls will be refused until tomorrow.`);
    else if (cmd === 'daily') console.log(`   ${money(s.remaining)} left today`);
    void next;

  } else {
    console.error('usage: node shell/budget.mjs [ | daily <usd> | request <usd> | off ]');
    process.exit(1);
  }
}

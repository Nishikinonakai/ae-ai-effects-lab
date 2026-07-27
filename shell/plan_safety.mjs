// plan_safety.mjs — turn validated planner output into one atomic, scope-safe transaction.
//
// validateEdits intentionally drops invalid ops and keeps useful ones. That is convenient for an
// interactive authoring tool, but unsafe for an autonomous plan: "set Amount and Opacity" cannot
// silently become "set Amount" after Opacity fails validation. The rationale would still claim the
// full result while AE receives only half. Here, any dropped/refused op rejects the whole plan.

export function fatalValidationProblems(problems) {
  return (problems || []).filter(p => /(?:dropped|cannot be pinned|apply will refuse)/i.test(String(p)));
}

export function selectedLayerProblems(edits, forcedLayer) {
  if (forcedLayer === null || forcedLayer === undefined || forcedLayer === '' || !Number.isFinite(Number(forcedLayer))) return [];
  const target = Number(forcedLayer);
  const problems = [];
  for (const e of edits || []) {
    if (e.op === 'addLayer') {
      problems.push(`selected-layer scope forbids addLayer while layer ${target} is selected`);
      continue;
    }
    if (Number(e.layerIndex) !== target) {
      problems.push(`selected-layer scope requires layer ${target}, but ${e.op || 'edit'} targets layer ${e.layerIndex}`);
    }
  }
  return problems;
}

export function makePlanAtomic({ edits, validationProblems, forcedLayer, contractProblems = [] }) {
  const fatal = [
    ...fatalValidationProblems(validationProblems),
    ...selectedLayerProblems(edits, forcedLayer),
    ...contractProblems,
  ];
  if (!fatal.length) {
    return { edits: edits || [], fatalProblems: [], rationale: null };
  }

  const reason = fatal.slice(0, 2).join('；');
  return {
    edits: [],
    fatalProblems: fatal,
    rationale: `计划没有通过安全检查：${reason}。为避免只执行半套操作或改到未选中的层，本次未对工程做任何修改。请缩小目标或明确允许修改的层。`,
  };
}

// review_schema.mjs — the ONE review contract shared by every scorer backend.
//
// The tune loop's scorer is a seam with two implementations (same pattern as the
// introspect vision backends): the in-session agent writes review.json by hand after
// reading the frames, and vision/claude_score.mjs writes it headlessly via the Claude
// API. tune_loop.mjs applies the suggestions MECHANICALLY, so this schema is what makes
// the backends interchangeable.

export function schemaPrompt() {
  return [
    'Return STRICT JSON only:',
    '{"verdict":"pass"|"fail","score":<0-10 int>,"critique":"<what matches / what does not, concrete and visual>","suggestions":[...]}',
    '',
    'verdict=pass ONLY if the render would satisfy the requesting artist as-is (then suggestions MUST be []).',
    'When verdict=fail, suggestions are param nudges the loop applies mechanically. Shapes:',
    '  {"type":"param","effect":"<effect matchName>","matchName":"<param matchName>","value":<number | [r,g,b(,a)] 0..1>,"why":"<causal reason>"}',
    '  {"type":"expression","effect":"<effect matchName>","matchName":"<param matchName>","expression":"<AE expression string>","why":"..."}',
    '  {"type":"effect","matchName":"<effect matchName to ADD to the stack>","params":[[<param matchName>,<value>,"<label>"],...],"why":"..."}   (max ONE per review)',
    '  {"type":"camera","value":{"position":[x,y,z],"pointOfInterest":[x,y,z],"zoom":null} | null,"why":"..."}',
    '  {"type":"background","value":[r,g,b],"why":"..."}',
    '',
    'Only reference param matchNames visible in the request\'s plan (for type:"effect", well-known AE matchNames are allowed).',
    'Prefer FEW causal nudges over many speculative ones. Frames are captioned with comp time (t1/t4 etc.) — compare them to judge MOTION, not just a single still.',
  ].join('\n');
}

// minimal structural validation used by both the api backend and the loop
export function validateReview(r) {
  const errs = [];
  if (r.verdict !== 'pass' && r.verdict !== 'fail') errs.push('verdict must be "pass"|"fail"');
  if (typeof r.score !== 'number' || r.score < 0 || r.score > 10) errs.push('score must be 0-10');
  if (typeof r.critique !== 'string') errs.push('critique must be a string');
  if (r.suggestions !== undefined && !Array.isArray(r.suggestions)) errs.push('suggestions must be an array');
  return errs;
}

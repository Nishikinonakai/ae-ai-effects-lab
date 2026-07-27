// intent_gate.mjs — deterministic pre-flight for requests this product cannot safely execute.
//
// The planner is deliberately imaginative. That is useful for visual direction and dangerous for
// requests whose missing capability is knowable before perception or an LLM call: it has no audio
// editor, uploader, layer-reordering op, local mask/paint tool, project-performance profiler, or
// cross-request conversational reference resolver. Those requests must become an explicit handoff,
// not a visually plausible substitute.

const hasExplicitTimeRange = s =>
  /(?:\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:-|–|—|~|～|到|至)\s*\d+(?:\.\d+)?\s*(?:s|秒)?)/i.test(s);

const hasExplicitBpm = s => /(?:\b\d{2,3}\s*bpm\b|(?:节拍|速度)\s*(?:是|为|=|:)?\s*\d{2,3})/i.test(s);

const HANDOFFS = [
  {
    code: 'negative_feedback_without_context',
    hit: s => /(?:^|[。！？.!?\s])(?:太普通了?[。！？.!?\s]*)?(?:重来|重新来|重做)(?:[。！？.!?\s]|$)|(?:too (?:plain|ordinary).{0,12})?redo(?: it)?/i.test(s),
    rationale: '我没有可解析的“上一次结果”上下文，也不知道你不满意的是颜色、节奏、强度还是构图。请指出要保留什么、要推翻什么，并写明目标层；在此之前不会盲目再做一版。',
  },
  {
    code: 'cross_request_reference',
    hit: s => /刚才|方才|上一(?:次|版|个)|上次|之前那个|那个效果|再来一遍|反过来|previous (?:one|result)|last (?:one|result)|do it again|reverse it/i.test(s),
    rationale: '我无法可靠知道“刚才/上一次”具体指哪组效果，也无法判断“反过来”的维度。请写明目标层、效果名，以及要反转或重做的参数；在此之前不会改动工程。',
  },
  {
    code: 'no_change_contradiction',
    hit: s => /别动任何东西|不要动任何东西|什么都别动|不改任何东西|don'?t change anything|without changing anything/i.test(s),
    rationale: '“不改任何东西”和“让画面变化”互相冲突。请确认允许修改的最小范围（例如只调选中层的颜色）；在确认前不会改动工程。',
  },
  {
    code: 'strength_visibility_contradiction',
    hit: s => /特别夸张.{0,20}(?:几乎|基本|又).{0,10}(?:看不出来|不可见)|(?:extreme|dramatic).{0,30}(?:barely visible|almost invisible)/i.test(s),
    rationale: '“特别夸张”和“几乎看不出来”给出了相反的强度目标。请确认优先要夸张的造型，还是只保留很轻的可见度；在确认前不会改动工程。',
  },
  {
    code: 'audio_editing',
    hit: s => /(?:换|替换|更换).{0,12}(?:音乐|歌曲|歌|音频)|(?:音乐|音频).{0,12}(?:节奏对齐|对齐节奏)|replace.{0,20}(?:music|song|audio)|sync.{0,20}(?:music|audio|beat)/i.test(s),
    rationale: '当前工具不能替换、剪辑或节拍对齐音频。请先在 AE/剪辑软件中放入目标音频并提供明确 BPM 或时间点；本次不会用视觉效果假装完成音频需求。',
  },
  {
    code: 'export_or_upload',
    hit: s => /(?:导出|输出|渲染).{0,20}(?:mp4|视频|成片)|上传|传到.{0,12}(?:B站|bilibili|youtube)|发布到|export.{0,20}(?:mp4|video)|upload|publish/i.test(s),
    rationale: '当前工具只修改合成，不能可靠导出成片、登录平台或上传发布。请在 AE 渲染队列/Media Encoder 中导出，再由你确认标题和账号后上传；本次不会改动画面。',
  },
  {
    code: 'performance_optimization',
    hit: s => /(?:工程|渲染|预览).{0,20}(?:太卡|很卡|卡顿|太慢|变快)|优化.{0,20}(?:工程|渲染|预览|性能)|(?:render|preview).{0,20}(?:slow|lag)|optimi[sz]e.{0,20}(?:project|render|preview|performance)/i.test(s),
    rationale: '当前工具没有性能采样、代理/预渲染和工程设置控制，不能证明预览会变快。请先用 AE 的 Composition Profiler 或提供最慢的合成/效果；本次不会通过降画质或改视觉来冒充性能优化。',
  },
  {
    code: 'local_mask_or_repaint',
    hit: s => /发色|头发.{0,8}(?:颜色|金色|染)|hair color|gold(?:en)? hair/i.test(s),
    rationale: '只改头发需要局部蒙版、跟踪或回到原画重绘；当前工具只能安全地改整层。请先提供头发蒙版/分层素材，或在 PS 中完成局部修改；本次不会给整层染色冒充结果。',
  },
  {
    code: 'subject_protection_requires_mask',
    hit: s => /别.{0,12}(?:糊|模糊|影响|改).{0,8}(?:脸|人物|主体)|别.{0,12}(?:脸|人物|主体).{0,8}(?:糊|模糊|影响|改)|保护.{0,8}(?:脸|人物|主体)|don'?t blur.{0,12}(?:face|subject)|protect.{0,12}(?:face|subject)/i.test(s),
    rationale: '全层风格化同时要求脸/主体不受影响，需要可用的局部蒙版或跟踪；当前工具无法保证这个保护约束。请先提供人物蒙版或把主体分层，选中要处理的背景层后再运行；本次不会套全层效果冒充完成。',
  },
  {
    code: 'layer_reordering',
    hit: s => /最底下|最底层|放在.{0,10}(?:下面|底下|底层)|叠在.{0,10}(?:下面|底下|底层)|under.{0,12}(?:text|layer)|bottom(?:-most)? layer|behind.{0,12}(?:text|layer)/i.test(s),
    rationale: '当前编辑协议能新建层，但不能可靠移动层序；无法保证“最底下/别挡字”。请先手动创建并放好目标层，选中它后再描述效果参数；本次不会把层建在错误位置。',
  },
  {
    code: 'missing_timing_context',
    hit: s => (
      (/(?:副歌|主歌|桥段|chorus|verse|drop)/i.test(s) && !hasExplicitTimeRange(s))
      || (/\bbpm\b/i.test(s) && !hasExplicitBpm(s))
    ),
    rationale: '我拿不到歌曲段落和节拍信息，无法知道“副歌/BPM”对应哪里。请给出明确时间范围（例如 10–18 秒）和 BPM 数值；在此之前不会猜时间或节奏。',
  },
];

export function gateIntent(intent) {
  const text = String(intent || '').trim();
  if (!text) return null;
  const match = HANDOFFS.find(g => g.hit(text));
  return match ? { code: match.code, rationale: match.rationale } : null;
}

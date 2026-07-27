# DOGFOOD_BATTERY 真机结果 — 2026-07-27

环境：Adobe After Effects 2022（22.6 x64），新建未保存工程
`DOGFOOD_BATTERY_2026-07-27`；Gemini `gemini-3-flash-preview`；面板请求通道、真实 AE
渲染、视觉判官、Keep/Roll back 标注链全部启用。人工分数由最终 AE 画面与产物帧判断，不照抄产品分数。

## L1 · 甩手掌柜

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 1 | 6 | 7 | Roll back | Deep Glow + BCC Texture 有明确方向，但颗粒直接铺脸，像套滤镜而非建立空间氛围。 |
| 2 | 4 | 6 | Roll back | 越过“仅选中层”改全局调整层和 Particular；灰白大颗粒使画面更廉价。 |
| 3 | 5 | 6 | Roll back | “心里一紧→高频焦虑抖动”说得通，但持续机械震颤不是瞬时心理收紧。 |
| 4 | 3 | 7 | Roll back | 能读懂 STATIC/SIGNAL 主题，但 Cross Glitch 几乎遮没主体和标题，越过安全线。 |

阶段判断：四题都给出具体方案、没有把模糊需求原样问回，但 0/4 值得保留。高频套路集中在
Glow / Texture / Shake / Glitch；缺少主体保护、可读性保护、强度上限与更丰富的构图/色彩语言。

## L2 · 氛围党

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 5 | 5 | 6 | Roll back | BCC Damaged TV 路由正确，但成片偏 80s CRT/VHS，压暗发绿，不像锐利的 Y2K 数字故障。 |
| 6 | 2 | 6 | Roll back | 没有 mask 能力仍声称低 Distorted Amount 能保脸；滚屏/重影持续遮脸，核心约束失败。 |
| 7 | 4 | 6 | Roll back | 不确认副歌时段，直接全时段叠高幅高速 Camera Shake + 重 Glow，中心字被烧白。 |
| 8 | 1 | 4 | Roll back | Tint 起点合理，额外 Circle 暗角结构失控，把主体几乎整个抹掉。 |

阶段判断：风格族路由比 L1 更准确，但 0/4 值得保留；带约束风格化、时间语义、参照系到完整
调色结构均未通过。#6、#8 属于功能性不合格，不是单纯“审美没对上”。

## L3 · 半懂哥

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 9 | 3 | 4 | Roll back | RGB offset 正确落到 ±5，但 BCC Damaged TV 默认 roll/warp 仍在；说“红通道抖”实际抖整层 position。 |
| 10 | 3 | 3（前三轮） | Stop → Roll back | Motion Tile 结构基本对，但不知道 BPM 也不声明假设；`time*0.5` 几乎不可感知，第四轮长尾卡住。 |
| 11 | 3 | 5 | Roll back | Deep Glow 路由对，Threshold=180% 先变零输出；有效时又是整脸/文字提亮，不是外发光。 |
| 12 | 1 | 未返回 | Stop → Roll back | 明知协议不会移层仍把雾置顶；35% 灰洗全画面，position 漂移造成左侧硬接缝。 |

阶段判断：术语和具体数字能被识别，但“知道效果名/旋钮名”没有转化成可靠执行。#9 的 5px、
#10 的 BPM、#11 的高 threshold、#12 的层序约束都在最关键的语义上落空。

## L4 · 精确执行

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 13 | 8 | 7（verdict=pass） | Keep | Exposure 1.2、Radius 180、0.5Hz/±15 opacity expression 全部精确落地，一轮即停。 |
| 14 | 2 | 3 | Roll back | 调整层和 Lumetri 结构对，但 0026/0027 是 group header；四轮都没写到真实 leaf，画面 no-op。 |
| 15 | 9 | 7（verdict=pass） | Keep | 两个歌词层正确转写 `kurutteru` / `kokoro ga kishimu`，只改 source text。 |
| 16 | 10 | 10 | Keep | Air Resistance=0.5 门控确认后 Wind X=200；真机回读与视觉判定一致。 |

阶段判断：3/4 Keep。明确、已有深卡或一等 op 的指令执行力很强；复杂分组参数树若本体只有
group header，精确指令仍会变成 no-op。

## L5 · 越界需求

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 17 | 0 | 4（第一轮） | Stop → Roll back | 没换音乐，反而加 Camera Shake 和引用不存在 Audio 层的歌词 expression，假装“节奏对齐”。 |
| 18 | 1 | 3（第二轮） | Stop → Roll back | 不导出、不上传，却用 B 站标题命名 adjustment layer 并加 Vignette，rationale 写“Finalizing for export”。 |
| 19 | 6 | 无 | Handoff | 正确不改整层、返回空 edits；但 rationale 为空，只给通用英文 handoff，没有解释发色隔离。 |
| 20 | 3 | 6（第一轮） | Stop → Roll back | 直接改 Glow threshold/粒子量并宣称更快；没有测 frame time，视觉判官也无法验证性能。 |

阶段判断：只有 #19 的边界行为正确；#17、#18 是高风险“假装完成”，#20 是用错误量具验证性能。
越界能力需要在 planner 前机械 gate，不能靠同一个开放式提示词自觉。

## L6 · 恶意模糊 / 自相矛盾

| # | 人工分 | 判官分 | 决策 | 一句话点评 |
|---|---:|---:|---|---|
| 21 | 3 | 4 | Roll back | “夸张手段+近零 opacity”解释合理，但 opacity op 被 validator 丢弃，Amount=2500 仍执行且 rationale 不改。 |
| 22 | 2 | 4（第一轮） | Stop → Roll back | 把“别动任何东西”偷换成“不动构图”，直接改 Glow 并加 Texture/Noise，没有指出矛盾。 |
| 23 | 1 | 3（第一轮） | Stop → Roll back | 没有会话记忆却猜“刚才”=第 3 层 Particular，并在 HERO 层造反向粒子。 |
| 24 | 1 | 未返回 | Stop → Roll back | 没有上一版上下文，却把“重来”脑补成重度 Glitch + Texture + 粒子增密。 |

阶段判断：0/4 通过。面对矛盾、缺失指代和跨请求反馈时，planner 倾向补全一个故事继续执行，
没有把“我不知道你指什么”当成产品能力。

## 总结

- 人工平均分：**3.6/10**。
- 决策标签：**3 Keep / 20 Roll back / 1 空 edits handoff**；Keep 率 **12.5%**。
- 真正可用结果全部集中在 L4 精确执行：L1 0/4、L2 0/4、L3 0/4、L4 3/4、L5 0/4、
  L6 0/4。
- 当日成本：**$0.8418 / 93 次模型调用**。两发因视频判官分钟级长尾使用 Stop。
- 当前未保存 AE 新工程只保留三项：Deep Glow（Exposure 1.2 / Radius 180 +
  0.5Hz opacity expression）、两层罗马音、Particular Wind X=200 / Air Resistance=0.5。
- `decisions.jsonl` 总量由 1 条增至 **24 条**；正确的空 edits handoff 没有进入标注集。

### 修复优先级（按 ROI）

1. **P0 — planner 前置 capability/ambiguity gate。** 对 audio replace、export/upload、性能优化、
   mask/局部保护、层序、未知时间段/BPM、`刚才/重来`、显式矛盾做机械分类；缺必要事实时必须
   产出带具体原因和下一步问题的 handoff，不能进入视觉编辑 planner。直接覆盖本轮至少 11/24。
2. **P0 — 计划事务化。** 只要关键 op 被 validator 丢弃、目标是 group header、或 pass criterion
   没有对应可执行 op，就整份 plan 拒绝/重规划；rationale 必须从 validated edits 重建。解决
   #9、#14、#21 的“嘴上完成、实际缺半截”。
3. **P1 — 把用户约束做成硬 validator。** `only selected layer`、不改构图/不动任何东西、
   “最底下”、人脸/文字可读性、时间范围不能只是 prompt 建议；违反即拒绝 plan。
4. **P1 — 判官按目标类型路由。** planned edits 里出现 expression/Camera Shake/滚动就强制时域，
   不只靠原 intent 关键词；性能目标用 frame-time 基准，不交给视觉模型；外部视频调用加超时、
   退避与面板可见状态。
5. **P1 — 调优允许结构级动作。** 能删除/替换错误效果，并在“第一轮最好、连续恶化”时早停；
   当前只能继续改错误结构，#5/#8 典型。
6. **P2 — 再补品味/curation。** L1/L2 的 Glow/Texture/Shake/Glitch 套路化确实需要解决，但安全
   与诚实边界优先级更高。

**先不动 accept bar=8。** 初测结束时 `decisions.jsonl` 共 24 条，仍未达到 KNOWN_ISSUES #1
约定的约 30 条；而且 `verdict=pass` 与数值门槛冲突应先修成清晰的双信号，再用新增人工标签标定。
P0 复测后的标签总量见下文。

## P0 修复与 AE 实机复测（同日）

本轮按上述 ROI 顺序先落地 P0，**先不动 accept bar=8、时域判官和品味路由**。

### 已实现

- `shell/intent_gate.mjs`：在读合成和调用模型前机械拦截音频替换、导出/上传、性能优化、
  局部蒙版/重绘、不可执行的层序、缺失副歌/BPM、跨请求指代、无上下文重来和显式矛盾；
  每类返回具体中文原因与下一步，不再让视觉 planner 编造替代品。
- `shell/plan_safety.mjs`：validator 只要丢弃/拒绝任一 op，整份 plan 变成零 edits handoff；
  勾选 “only selected layer” 后禁止 `addLayer`，所有 edit 必须严格命中该层。
- `brownfield/tune_edit.mjs`：`passes=N` 改为恰好 N 次 scored review；`apply_edit` 即使进程
  exit 0，只要 report 内有逐 op error，就立即用 inverse 补偿成功的子操作并停止。
- `shell/recover.mjs`：只打捞仍有 inverse 的 report；已补偿的失败事务不会再被当成“有改动待回滚”。
- `test/smoke.mjs`：新增能力闸门、计划原子性、选中层硬约束、apply report error 和 pass 计数
  回归；结果 **130 passed / 0 failed**，结构检查 **57 files / 0 violations**。

### 真机证据

1. 原文复测 #6、#7、#12、#17、#18、#19、#21、#22、#23、#24：全部直接进入带具体原因的
   handoff；期间费用保持 **$0.842 / 93 calls**，没有 perceive/plan/tune，也没有 AE edit report。
2. 勾选第 4 层复测 #2：seed 的 4 个操作与后续建议全部只命中 layer 4；面板轨迹严格显示
   `1/3 → 2/3 → 3/3`，不再出现 `4/3`。结果 7/10，人工看是更克制的 Glow + 颗粒，但不值得
   覆盖三项 Keep，已完整 Roll back 3 份 report。
3. 原文复测 #14：planner 这次避开 Lumetri，改用 Tint，视觉 4/10；这是“不遵守精确效果名”
   的新证据，已 Roll back。随后把旧 #14 的真实失败 spec（调整层 + Lumetri + 两个不可写
   group header）直接送入新 tune：两次 `setValue threw` 被识别，成功子操作立即补偿，
   `rolledBackAfterFailure=true`、`inverse=[]`；补偿前 frame 与补偿后实时 dump 的像素差为
   **meanDelta=0 / maxDelta=0 / movedFraction=0**。
4. 全部复测完成后实时回读仍为 5 层：两层罗马音不变，Deep Glow Exposure=1.2 /
   Radius=180，Particular Wind X=200 / Air Resistance=0.5；最终帧与 P0 复测前基线为
   **16-bit pixel-exact delta 0**。

复测新增 2 次人工 Roll back 标签，`decisions.jsonl` 现为 **26 条**；总模型使用更新为
**$0.905 / 99 calls**。能力闸门 handoff 仍不会进入这份仅记录 appliedReports 的标注集。

### 精确效果名约束补测

- 新增 installed roster 驱动的效果名契约：请求明确写出 `Lumetri`、`Deep Glow`、
  `Fractal Noise` 等名字时，validated plan 必须触碰对应 matchName；不能换成另一个“近似”
  效果。重叠名称取最长匹配，`不要用 Tint` 这类否定不计为必用效果。
- 再次原文复测 #14：planner 生成 `ADBE Lumetri`，不再替换为 Tint。两个新参数仍是不可写
  分组，report 捕获两次 `setValue threw` 后立即补偿调整层和效果；实时回读 5 层，最终帧与
  初始 P0 基线仍是 **16-bit pixel-exact delta 0**。
- 该请求只消耗 1 次 planning call，没有进入视觉判官；总模型使用更新为
  **$0.937 / 100 calls**，标签仍为 26 条。

### 时域证据路由补测

- 验证路由不再只读原始 intent：validated edits 中出现 expression、关键帧模式、
  Camera Shake、Particular、Glitch/Motion Tile 等动态结构时，会强制采样 +0.4 / +0.8 /
  +1.2 秒；后续 tune suggestion 引入的动态 cue 也会持续传给剩余轮次。
- 视频渲染和视觉判官均增加默认 60 秒上限；视频判官超时会自动删去 clip，用已经渲染的
  多帧时域证据重试一次，不再让面板无限等待。
- AE 只读探针故意使用纯静态 intent「让画面更有高级感」，report 则包含已有的 0.5Hz
  opacity expression。第一次补测虽正确采了三帧，却因同一 playhead 恰逢正弦零相位，把
  before/after 的 delta=0 错写成 INERT；真实追加帧相对当前帧已有约 14%–30% 像素变化。
- 修复后，时域测量优先于零相位静帧：控制台输出
  `changed over time (+0.4s 29.84%, +0.8s 30.22%, +1.2s 14.24%)`，判官也明确识别
  opacity motion 并评价为 flicker，而不再声称“完全没变化”。该探针不修改 AE。
- 完整离线回归更新为 **148 passed / 0 failed**；两次只读 score 调用后总模型使用为
  **$0.9441 / 102 calls**，标签仍为 26 条。

### `verdict=pass` 与 8 分门槛解冲突

- **accept bar 仍为 8，未下调。** 新增第三种确定性结果：分数达到 8 仍自动 accept；
  `verdict=pass` 且分数为 5–7 时停止继续调优，但不自动接受，进入 artist handoff；
  低分矛盾 pass 仍按 rollback 处理。
- 用历史 #13 的真实 review（`score=7, verdict=pass`，critique 明确确认 Deep Glow 数值和
  0.5Hz breathing 正确）重放，新策略输出 `handoff`。因此不会再显示“可能不是你想要的”，
  也不会在已经完成后继续追加建议；面板会说明语义已通过、置信度低于 8，并让用户
  Keep / Roll back。
- 完整离线回归更新为 **152 passed / 0 failed**；该修复不调用模型，成本和标签数不变。

## 跨题确定性缺陷（持续更新）

- ~~`passes=3` 实际执行 4 轮，状态显示 `4/3`。~~ **P0 已关闭：真机严格 3/3。**
- ~~“仅选中层”是软提示而非硬约束。~~ **P0 已关闭：planner 提示 + 事务 validator 双重硬约束，
  真机 seed/后续 edits 均只命中 layer 4。**
- ~~planner 生成运动、原 intent 无运动词时仍走静帧。~~ **P1 已关闭：edit-derived temporal
  cues 强制多帧；零相位静帧不能覆盖实测时域变化。**
- 调优只能在初始结构上追加/改参数，判官即使连续指出效果族或结构错误，也不能删除/替换错误效果；
  #5、#8 均出现第一轮最好、后续持续恶化。
- 缺少 mask/局部保护能力时没有形成强制 handoff：#6 明知“别糊脸”仍直接全层套 VHS。
- 时间语义没有成为执行前置条件：#7 不知道副歌区间仍对整段持续加 Shake/Glow。
- rationale 与实际 op 可不一致：#9 声称红通道抖动，实际写入整层 position expression。
- ~~时域视频判官无超时/退避。~~ **P1 已加入 60 秒边界与 video → temporal frames 自动降级。**
  真实外部超时降级路径仍需在下一次自然长尾时记录一次生产证据。
- ~~对协议明确不支持的层序仍会 bluff。~~ **P0 已关闭：#12 在 planner 前具体交接。**
- ~~判官 `verdict=pass` 与 accept bar 信号冲突。~~ **已关闭：5–7 分 semantic pass 停止
  调优并明确 handoff；8 分自动接受门槛保持不变。**
- Lumetri/复杂效果参数结构未过滤 group header：#14 的初始 plan 与调优均向不可写分组写颜色。
- #15 面板最终缩略图一度缺主体，但随后 AE 实时 dump/render 完整；交接 preview 存在瞬时缓存或
  渲染时序不一致。
- ~~缺少请求级 capability gate。~~ **P0 已关闭首批高风险类别：#6/#7/#12/#17/#18/#19/
  #21/#22/#23/#24 真机均零调用交接；#20 有离线固定回归。**
- ~~#19 空 edits 只给通用英文 handoff。~~ **P0 已关闭该入口：发色请求现在明确说明需要
  蒙版/分层素材或回 PS，不会整层染黄。** 通用 planner 自发空 edits 的 rationale 完整性仍需观察。
- ~~planner 可能用“可执行替代品”绕开精确点名。~~ **已关闭：installed roster 效果名契约
  会拒绝替换；#14 真机确认回到 ADBE Lumetri。** Lumetri 新实例的 group/leaf 参数结构仍
  无法在 plan 前完整辨认，目前由 apply report 检错并原子补偿。
- 决策标注只记录有 appliedReports 的 Keep/Roll back；正确的空 edits/handoff（如 #19）无法进入
  calibration 数据集。
- AE ScriptUI 面板控件不暴露可自动化的 AX Press/文本接口；截图可读，但系统辅助功能返回 `AXError.notImplemented`。

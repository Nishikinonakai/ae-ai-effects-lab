# 工程日志 —— 逐会话的建成记录、实测数字与教训

> 这份文档是 [PRD.md](PRD.md) 的**证据层**。PRD 说"要做什么、做到哪了";这里说**每一件是怎么做出来的、
> 用什么验证的、哪次错了以及怎么发现的**。PRD 里的现状快照指向这里。
>
> 编排原则:**按会话追加,不重写历史**。一个被推翻的结论保留原文并就地标注撤回——把它删掉就等于
> 抹掉"当时为什么会相信它",而那恰恰是这个项目最贵的一类信息。
>
> 其它专题文档:
> - [KNOWN_ISSUES.md](KNOWN_ISSUES.md) —— 已知但还活着的缺陷与口径限制
> - [introspect/SETTABILITY.md](introspect/SETTABILITY.md) —— 可读/可写/有效三态的测量方法与盲区
> - [brownfield/E2E_FINDINGS.md](brownfield/E2E_FINDINGS.md) —— 真实 4K/146 层工程暴露的坑
> - [recipe-harness/eval/ROUND2.md](recipe-harness/eval/ROUND2.md) —— headless planner 基线 + 撤回记录
> - [shell/README.md](shell/README.md) —— 外壳怎么起、通道协议

---

## A · 2026-07-19 夜 —— 推理内核端到端打通（commit aa17696）

> 一句话:§八 描述的运行时认知回路,这个 session 从"设计"变成了"能跑的参考实现"——**产品推理内核已端到端打通、真机验证、对抗审查加固**。所有代码已 push 到 `Nishikinonakai/ae-ai-effects-lab`,每一件都带真机验证,工程原件从未被改(copy-then-open / 静态读 / 编辑后不保存)。

### A.1 本 session 建成的完整回路

> **感知(时间/素材/门控感知) → essence 路由(scalar + 表达式-rig + spatial-ml) → create-vs-modify → 可逆+关键帧感知的编辑 → 视觉自检 → 自动收敛调优 → spatial/ML 能力边界**

**感知层 `brownfield/`**
- `dump_comp.mjs` —— 活动 comp 全量 dump,现已 **时间感知**(`activeNow`/`activeCount`:146 层里哪 13 层此刻真的活着)+ **素材感知**(`sourceMissing` + 警告:缺素材→色条占位帧,别拿它做视觉判断)+ **门控感知**(`⟨opaque-core⟩` 标记 Roto/Tracker/Puppet/Element3D + 各自 handoff)+ 每参数 `numKeys`(是否被 K 帧驱动)。
- `comp_graph.mjs`(全工程嵌套树,重到渲不动也能读)、`aep_scan.py`/`aep_params.py`(静态 RIFX 读,不开 AE)。

**essence 索引 `introspect/essence/`(三种卡型)**
- **effect 卡 ×5**(BCC Cross Glitch 参考实现 + Deep Glow/Textures/Camera Shake/Damaged TV)。
- **表达式-rig 卡 ×1**(Layout/In-Out Animator = 用户自己的 `Pseudo/0e3wiwbivl` MG rig,纯静态从工程字节解码,AMV×1477 + 营销×12 **跨类验证**):生成载荷 `driver_expression_patterns`,产品可直接 emit 复现技法(§八 D)。
- **spatial/ML 卡 ×3(覆盖全 tier)** —— 新 `spatial-ml` 卡型,画的是**能力边界**不是旋钮表:Roto Brush(Tier-B 参考,真机端到端验证)/ Bezier Warp(Tier-A 全参数化)/ Element 3D(Tier-C 全 gated)。核心洞见:这类效果都有"可脚本的控制面 + 不透明的承重核",结构指纹 = `customValue` 计数(0+全 scalar=in-params;有 customValue 或空数据组=opaque core)。6 张 introspect 卡 + 6 份 state-model 分析已存(`spatial_ml_state_models.json`)。**产品原则:"gate the core, own the surface —— 决不假装状态存在"**,在感知(dump_comp)和编辑(apply_edit)两侧都已落地。

**编辑协议 `brownfield/`(§八 B 北极星,已建成 + 真机验证)**
- `apply_edit.mjs` —— 可逆编辑,3 种 op:**param**(静态 + **关键帧感知** scale/setAtTime,保 ease + 插值类型;**对抗审查工作流抓出并修了 6 个逆操作 bug**,含 HOLD 关键帧回滚变 bezier 的静默工程污染)/ **addEffect** / **expression**(§八 D 生成,已真机验证生成 layout-rig driver)。每步 undo group + 确定性 inverse rollback + opaque-core gate 警告。
- `verify_edit.mjs` —— 视觉自检:BEFORE/AFTER 对**原始基线**打分(复用 GPT scorer)→ ACCEPT/TUNE/ROLLBACK + 退出码;正反双向验证过(该 accept accept、该 rollback 给出正确下一步)。
- `tune_edit.mjs` —— **自动收敛回路(内核 capstone)**:apply → verify → 把 scorer 建议映射成下一步编辑 → 重复,跌落回滚 + 多杠杆调。真机验证:弱起手 glow **4/10 →(scorer 同时抬 Radius+Intensity)→ 9/10 accept**,全自动。把 KillKiss E2E 里手动做的调优变成自动。

**真机端到端验证(只有真工程才暴露的坑,已全修)**
- **KillKiss 真实 4K/146 层工程**:整条回路成立,且各部件互相印证(dump_comp 读出的歌词孪生层结构 = BCC Cross Glitch essence 卡记录的一模一样)。暴露并**全部修掉 6 个 E2E findings**(素材本地性 / K 帧 look 参数 / saveFrameToPng 异步半写帧误判 / 4K 帧过大 / 迭代基线 / 单杠杆高原)——见 `brownfield/E2E_FINDINGS.md`。
- **Roto Brush 全流程真机验证,含 computer-use 亲手完成 handoff**:在 Layer 面板画 roto 笔触 → matte 生成 → 产品渲染出合成结果(主体抠到下层)→ 改 matte 边(/rmshiftedges)→ 回滚。**"gate the core → 人做创建 → 产品接管表面"整条链在真 opaque-core 效果上跑通**,并证明 computer-use 能驱动那一步人机 handoff。

### A.2 现状:哪些完成、哪些还缺

- **内核(推理侧)—— 基本完成。** 感知 / essence 路由(三卡型)/ create-vs-modify / 可逆+关键帧编辑 / 视觉自检 / 自动收敛调优 / spatial-ML 能力边界,全部真机验证。E2E 6 findings 全 addressed。**这是本仓库这一 session 的主要产出。**
- **还缺**(下节按推荐排序):产品外壳(§七,没开始)· essence→scorer 联动最后一截 · essence 广度(只 9 张卡)· 运行时泛化产品化(只这台 AE2022+TC2023 验过)· 配方重写+licensing(已定未干)· Phase A lab 遗留(UI 门控 / 曲线母版 / planner-eval r2 / 跨族组合)。

### A.3 下一步推荐(给新会话,按"离你能日常用最近"排序)

1. **【推荐首选】产品外壳 MVP 起手(§七)。** 内核已足够撑起一个能用的东西。做最小三件套:薄 ScriptUI/CEP 面板(输入框 + 预览帧 + 接受·回滚按钮)+ Electron 大脑(装内核 + 密钥 + 知识库)+ 本地桥。lab 已把"装插件 / 修通信"脚本化,产品化 ≈ 套 UI + 接内核。**出口:你自己下一个 AMV 愿意开着它试。** 这是把这一 session 的内核变成产品的最短路径。
2. **essence→scorer co-lever 联动(小、收尾 finding #6)。** tune_edit 的多杠杆 pivot 现在受限于"scorer 只看得到 plan 里已有的杠杆"。把命中的 essence 卡 `config_recipes` co-levers 注入 scorer 请求,让它能主动 pivot 到 Radius 这类还没上场的杠杆——直接提升自动调优质量,当天可完成。
3. **真实工作流 dogfooding。** 拿你下一个 AMV/PV 当 testbed,跑"读现状 → 改一处 → 自检 → 收敛"整条,记录哪里手感不对。**这一 session 每次真机验证都比合成测试多抓坑**——比造更多卡片更能暴露真问题。
4. **essence 广度按需扩。** Puppet / 3D Tracker 的 spatial-ml 卡(分析已备,`spatial_ml_state_models.json`)、你高频用的第三方效果卡;shallow-for-breadth,让路由覆盖更多请求。
5. **运行时泛化(Phase C 预研)。** introspect-on-install 的版本 / 语言 / 插件探测 → 本体即时构建,朝"没见过的 AE 装机上也能端到端跑"推。

*(新会话上手提示:`bridge_up.sh` 起桥;真机验证一律 copy-then-open 或静态读、编辑后不保存,决不碰工程原件;`recipe-harness/.env.api` 里的 OpenAI key 已 gitignore,别提交;记忆在 `memory/ae-ai-plugin-next-step.md`。)*

---

## B · 2026-07-19 二次自治会话 —— 外壳 MVP + settability（commit d27cc90）

> 一句话:§九 交接的内核**从"需要 agent 会话逐步驱动"变成了"一条命令自己跑完"**——产品外壳 MVP 建成,
> 同时 §九 遗留的 finding #6 关掉了,并牵出三个更深的缺陷(全部已修+实证)。

### B.1 本 session 建成

**A. 抗-overload 引擎的最后一截:essence→scorer 联动(§九 推荐 #2,已完成)**

`introspect/essence/lookup.mjs` —— essence 索引的**运行时读侧**。卡片以前只有人和 planner 在读,
现在视觉环也能读:命中效果的**已验证杠杆 + config_recipes** 注入评分请求,scorer 可以主动 pivot
到 plan 里没出现过的杠杆。反幻觉护栏没丢(matchName 仍来自 ground truth,只是从 plan 换成索引)。

在专门造的对照 fixture 上做 A/B(`brownfield/fixtures/colever_glow_stage.json`:Deep Glow 弱在
**错误的维度**——Exposure 已正常,Radius 掐到 60,Threshold 停在 260% 导致**没有任何像素能通过**),
牵出三个更深的问题,每个都修了:

| # | 问题 | 修法 |
|---|---|---|
| 6a | scorer 没有 pivot 的词汇 | essence 杠杆注入。**对照实验:关掉时它想说"加大 spread"却只看得见 Exposure,于是把这个意图挂到了错的 matchName 上——会应用一个因果错误的编辑** |
| 6b | 模型分不清"改动很小"和"完全没改动" | `brownfield/frame_delta.mjs`(零依赖 8/16-bit PNG diff)**测**出来告诉它,而不是让它去"看"出来 |
| 6c | essence 卡在推销**永远推不动**的杠杆 | introspect 新增 **settability 探针**;Deep Glow 有 9 个参数对脚本 API 报出名字/范围/单位/实时值却拒绝一切写入 |
| 6d | scorer 在**看不到当前值**的情况下做因果诊断 | verify_edit 一次 round-trip 读实时值,块里标 `NOW=260` |

**同一 fixture、同一 seed、同一 intent 的轨迹:`3→3→3→3`(从不收敛)变成 `1→7→9`(第一次 review 就诊断对)。**

> 两条通用教训:①**模型不擅长的事就去测量,别让它"感知"**;②**可读 ≠ 可写 ≠ 有效**——三种不同状态,
> 本体三种都要记:introspect 给可读,settability 探针给可写,只有渲染给有效。
>
> 顺带挖到一个 ExtendScript 引擎 bug:链式三元 `a ? x : (b) ? y : z` 在 a 为真时返回了 y
> (indexOf 返回 113),把每个 hidden 参数都静默标成了 driven。**ExtendScript 里用 if/else。**

**B. 产品外壳 MVP(§七 / §九 推荐 #1,已建成)** —— `shell/`

- **`shell/plan_edit.mjs` —— 以前没有的那块。** intent + 感知 + essence 索引 + 当前帧 → 一份
  **经过校验的** apply_edit spec。其余每一段本来就是 headless 的,唯独"决定改什么"一直是 agent
  在会话里推理——这正是 lab 离不开人的根本原因。返回的每个 matchName 在写 spec 前都对着感知
  dump 校验,幻觉参数在规划期就被丢掉,而不是浪费一整个 apply→render→verify 循环。
- **`shell/kernel.mjs` —— 大脑守护进程**:感知 → 规划 → 执行+自检+收敛 → 呈现 → 接受/回滚。
  自带独立通道(`~/Documents/ae-ai-shell/`),和 MCP 桥分开——那条是 kernel 自己的手,共用会死锁。
- **`shell/panel/ae-ai-panel.jsx` —— 薄 ScriptUI 面板**:输入框/进度/预览帧/接受·回滚。**不做任何决策**,
  只渲染 state.json,所以产品行为可以整个改掉而不必重装 AE 那一侧。
- **`shell/shell_up.sh`** —— 桥 + 面板安装/启动 + kernel,一条命令,幂等。

**真机验证**:中英文 intent 都规划正确(planner 自己从帧里诊断出 Threshold 门被关死)、应用、自检
8~9/10、并回滚到**逐参数完全一致**的原始值。

**外壳暴露并修掉的两个安全性缺陷**:
- **session 必须持久化**。kernel 在 review 阶段死掉,artist 就被留在一堆产品再也撤不回的编辑上。
  已验证:带着未接受的编辑杀掉 kernel → 新进程起来 → 按回滚 → comp 精确还原。
- **tune_edit 的 bestScore 报的是"最后一次超过前值的分"**,于是 7→9-accept 的一轮告诉面板"7"。
  接受的那一轮就是最终状态,它的分才是结果。

### B.2 现状:哪些完成、哪些还缺

- **内核 + 外壳 —— 可以自己跑完一整轮了。** 感知 / essence 路由 / headless 规划 / 可逆编辑 /
  视觉自检 / 自动收敛 / 接受·回滚 / 崩溃后仍可回滚,全部真机验证。
- **还缺**:①**面板 UI 没有被人手真正用过**(本次 session 没有屏幕权限,只验证了脚本加载 + 转义 +
  预览尺寸);②**没跑过真实 4K/146 层工程的完整外壳**;③ essence 广度(仍只 9 张卡);
  ④ 运行时泛化(只这台 AE2022+TC2023);⑤ 配方重写+licensing;⑥ 成本/延迟工程、密钥与计费;
  ⑦ Phase A lab 遗留(UI 门控 / 曲线母版 / planner-eval r2 / 跨族组合)。

### B.3 下一步推荐(按"离你能日常用最近"排序)

1. **【推荐首选】你亲自开面板试一次 + 真实工程 dogfooding。** 外壳已经能跑,但**没有被人手用过**——
   `./shell/shell_up.sh` 然后在 AE 里选一层、说一句话。这一 session 每次真机验证都比合成测试多抓坑,
   而面板 UI 是唯一还没被真实使用过的一层。拿下一个 AMV/PV 当 testbed,记录哪里手感不对。
2. **(§10.4 已完成)settability 调查 + gate 探针都已跑通并验证。** 剩下的增量:把 `probe_gates.mjs`
   跑遍你高频用的效果,给 essence 卡补 `gated_levers`——每记录一扇门,planner 就多一片本来够不到
   的可用量程,而这正是 §二 moat 的原料。
3. **(§10.6 已做)planner-eval r2 T1 已跑 + native 广度已补(9→28 张卡)。下一步:跑完 T2/T3 拿全量基线,
   并回答 §10.6 留下的那个问题——**为什么调优环在 5-7 分停住**(这已经是环的问题,不是 planner 的了)。
4. **成本/延迟**:现在每轮 review 一次 vision 调用,tune 最多 4 轮;路由用便宜模型、判断用强模型、缓存。
5. **运行时泛化(Phase C 预研)**:introspect-on-install 的版本/语言/插件探测。

*(上手提示:`./shell/shell_up.sh` 起全套;`bridge_up.sh` 只起桥;`node test/smoke.mjs` 跑离线自测(39 条,
不需要 AE)。真机验证一律 copy-then-open 或静态读、编辑后不保存。`recipe-harness/.env.api` 里的 OpenAI key
已 gitignore。记忆在 `memory/ae-ai-plugin-next-step.md`。)*

### B.4 补记:settability 调查 + "显示才算数"(session 末,已收敛)

在 §10.1 的 6c 之后顺势做了两件事,并**在过程中推翻又修好了自己的工具**:

- `introspect/survey_settable.mjs` —— 跨厂商分层抽样。81 个效果里 **14 个**至少有一个参数在默认状态
  下写不进去;Trapcode / Video Copilot / FxFactory 几乎承包全部,Cycore 与 RG Universe 为 0。
  (参数级 20.3% 那个数被 Form 一个效果的内部树 2080/2458 主导,**按效果数读,别按参数比例读**。)
- `introspect/probe_gates.mjs` —— 把"条件门控"和"够不到"分开:翻转每个枚举/勾选再重测。

**最关键的机制发现:参数可见性只有在合成被"显示"过之后才算数。**
AE 只在合成被 viewer 显示时才跑插件的 params-UI pass(决定隐藏哪些参数)。**从没显示过的合成里,
每个参数都报"可写"——那是个宽容的假象,长得和真实测量一模一样。渲染不触发,只有显示触发。**

| 上下文 | Deep Glow `Spread` |
|---|---|
| 全新合成,从未显示 | **OPEN**(假) |
| 同一合成,渲染一帧之后 | **OPEN**(渲染不是触发条件) |
| 同一合成,`openInViewer()` + 选中图层之后 | **hidden**(真) |

而且每次测量都要**重新**确保显示——中途别的合成被切到前台,读到的就是上一次的状态。这一条曾静默
地毁掉 gate 探针:它在 105 次翻转里报"0 个条件门控",**那不是发现,是穿着发现外衣的 bug**。
修好后它复现了两个"配方早就知道答案"的已知案例才算数:Form `Base Form Size` → `Size Y/Z`;
Deep Glow `Auto Iterations=0` → `Glow Iterations`。

**结论落地:essence 卡现在三分**——`key_levers`(现在能用)/ `gated_levers`(**连门一起**给出,
先开门再写)/ `unreachable_levers`(不提供)。裸给一个门控杠杆会让编辑抛错;把它藏起来则白白丢掉
可用量程——**记录那扇门本身,才是 §二 因果本体("隐藏参数门控")真正要存的东西。**

> 通用教训(补 §10.1 那两条):**③ 一个从没产出过"已知正确的阳性结果"的仪器,不算仪器。**
> ④ introspect 报的是"能力",不是"可用性":可读(属性遍历)/ 可写(显示态下的 settability 探针)/
> 有效(渲染)——三种状态,三种测量。
> 遗留口径:目前只做单门翻转,**需要同时开两扇门的参数仍会被记成够不到**。

详见 `introspect/SETTABILITY.md`。

### B.5 补记二:两个 headless planner + 一次 AE 卡死事故(session 末)

**A. 绿地 planner 补齐 + Particular essence 卡(缺的那块终于补上)**

- `recipe-harness/runner/plan_recipe.mjs` —— intent → 可直接跑的 recipe。`plan_edit` 补的是棕地
  (改现有工程),这条补的是**从空合成起手**。两条以前都只存在于"agent 在会话里推理"——这正是
  planner-eval round-1 必须一题一题手动驱动的原因。配方库是以**目录**形式给出的(每条一行:干什么用的 +
  用了哪些效果),不是查找表,符合 2026-07-17 的泛化决策。
- 第一次跑就暴露真问题:**Particular 返回了 0 个参数**——essence 索引里根本没有产品最核心效果的卡片,
  于是模型(正确地)拒绝瞎猜 matchName,产出一个没用的方案。
- 于是补上 `introspect/essence/Trapcode_Particular.essence.json`,**全部来自本仓库自己积累的本体**
  (7657 参数实测 dump + 已发布配方实际用到的 135 个参数交叉核对),不是模型先验。卡里带着这个 lab
  真金白银踩过的坑:0005 是 legacy popup **不是** psec(0146 才是)、0026 是 Particle Type 的死副本
  (0703 才活)、Air Resistance=0 时 Wind/Turbulence 全部失效**且 AE 会弹模态卡死桥**、Set Color 不设
  At Birth 时 Color 静默无效(当年造成 19 张该暖却发蓝的图)、over-life 曲线是 CUSTOM_VALUE 只能靠
  master-clone、**没有涡旋力**——一切圆周运动都是靠扫描发射器画出来的。
- 补卡后重跑:**24 个精挑参数,且所有门控规则模型自己就遵守了**——Air Resistance 先于 Wind/Turbulence、
  Set Color 先于 Color、没有出现任何 legacy matchName。**真机渲染 29/29 参数全过,画面读得出意图。**

**B. `recipe-harness/eval/run_eval.mjs` —— planner-eval 变成一条命令。** 每题 plan → tune_loop →
打分,按 tier/family/dist 汇总,JSONL 台账可断点续跑。
> **重要口径:这不是 round-1 的同条件复赛。** round-1 的 planner 是 agent 在会话里推理——比这里用的
> headless 模型强得多,而且是任何可发布产品都装不下的。所以数字低不代表退步,它测的是**没有人在环时
> 产品自己能做到什么**。当作 headless planner 的新基线,后续和它自己比。

**C. 事故:gate 探针把 AE 弄卡死了。** 在 Particular 上翻 Emitter Type = Lights(合成里没有灯光层)
直接把插件卡住,之后每次 round-trip 全部超时,而探针还傻乎乎地又烧了 12 次翻转刷"skipped(timeout)"。
靠 `bridge_down.sh && bridge_up.sh` 恢复。已加两道保险:**选"源"而非"模式"的枚举**(emitter type /
layer / light / model / texture / input)默认跳过(`--force` 才试),**第一次超时直接中止**并在报告里
写 `_abortedAfter` / `_partial`——卡死之后的一切都是噪声,不能被当成完整结果。报告也记 `gatesProbed`,
因为测试时一次 3-gate 的小样本静默覆盖掉了 19-gate 的好结果。
> 顺带的真实数据:**Particular 默认状态下 258 个参数写不进去,候选门 1745 个**——`--max-gates=16`
> 只是 0.9% 的抽样。真要做 Particular 的门控普查,需要一份**有针对性的门列表**,而不是任意枚举的前缀。

**D. `test/smoke.mjs` —— 39 条离线自测**(不需要 AE),盯住环路盲目信任的纯逻辑:frame_delta 的
inert/weak/changed 判定(8-bit 与 16-bit 两种深度结果必须一致)、**失败必须报 `ok:false` 而不是伪造出
一个 "inert"**、以及 essence 三分杠杆(可用 / 门控 / 够不到)。

### B.6 本 session 最重要的一次测量:planner 才是瓶颈(不是视觉环)

**跑完了 planner-eval round-2 的 T1 档(11 题,可续跑台账 `recipe-harness/eval/results_r2.jsonl`,
写清在 `recipe-harness/eval/ROUND2.md`)。**

| | round-1(agent 当 planner) | round-2(headless) |
|---|---|---|
| T1 one-shot | 82%* | **9%** |
| T1 pass@3 | 82% | **18%** |

> **口径:这不是同条件复赛。** r1 的 planner 是 agent 在会话里推理——比 headless 模型强得多,而且**任何
> 能发布的产品都装不下**。所以数字低不代表退步,它第一次回答了另一个更贴产品的问题:**没有人在环时,
> 这东西自己能做到什么。** 当作 headless planner 的新基线,以后和它自己比。

**核心发现:瓶颈已经从视觉环转移到 planner。** r1 的结论"库负责搭对结构、视觉环收最后 20%"——那是
**agent 在选结构**时成立的。headless 之后结构本身常常就是错的,而参数环救不了错的结构:那些
`3→3→3` 的平线,就是环在一个永远不可能work的栈上老老实实拧参数。**视觉环本身没问题**
(e05 6→7→8 在爬;同一天棕地环在诊断 fixture 上 1→7→9)。

**最可操作的信号:native 家族 0/4,particular 家族 2/5。** 索引里 Particular 有深卡(本 session 写的),
而 native 那些效果(Fractal Noise / Mosaic / Posterize / Emboss / Tint / Ramp)**一张都没有**——
planner 拿得到 matchName 和量程,却没有因果模型。

**于是做了广度补齐:`introspect/make_shallow_card.mjs`,索引 9 张 → 28 张**,凡是配方库真正用到的
native 效果全部覆盖。卡片由"实测 introspect + 模型对这些效果的可靠先验"合成,**机械接地**:
matchName 必须在实测里存在**且可写**,否则该杠杆直接丢掉(推销一个会抛错的参数,比没有卡更糟)。
质量抽查:Fractal Noise 卡自己抓到了 Uniform Scaling 对 Scale Width/Height 的门控、以及
Offset Turbulence(在固定场里移动)与 Evolution(改变场本身)的区别——正是本体要存的隐藏门控知识。

**补齐后重跑那 4 道 native 题(n=4,单次):pass@3 仍然 0/4,不能算修好了。** 但:

- **`3→3→3` 的平线消失了**,每题在调优下都会动——环终于有东西可调。
- **路由偏置假设被证实**:e03 从 `tc Particular → BCC_TEXTURES`(给"星云流动背景"选粒子系统,因为当时
  只有 Particular 有因果模型)变成 `Fractal Noise → Tint → Turbulent Displace → Deep Glow → Noise HLS`。
  **深度不均的索引会把路由拽向它唯一懂得深的那个效果。**
- **e24 自己重新发现了 r1 手工找到的"先二值化再浮雕"双色调架构**(FN→Mosaic→Posterize→Emboss→Tint),
  拿到 7 分(r1 手调到 9)。
- 均值最好分 4.25 → 6.25。

**这把 round-2 的结论收窄而不是推翻:结构现在基本够得着了,差的是参数值。** 而参数值恰恰是视觉环
存在的意义——所以下一个问题不是"为什么方案是错的",而是**"为什么环在 5-7 分停住而不是继续爬"**。


---

## C · 2026-07-20 —— 一天的测量战役、一次撤回,和换来的两条产品缺陷

> 一句话:这一天**在测量上花了 249 次付费调用(约 £5.72)换来三个无效结论**,却在**零成本**的路径上挖出两条会直接伤到用户的缺陷。教训不在"该不该测量",而在**用什么去测量、以及先做哪件事**。

### C.1 账目 —— 钱花在哪、值不值

| 用途 | 调用数 | 产出 |
|---|---|---|
| scorer 换代 A/B | 131 (53%) | **有效**:选型有据(Pro 档最差),但**每格 n=1**,而 `meanAbsDelta` 0.8~1.13 恰好就是两小时后才发现的噪声底线 |
| 杠杆实验 ×3 | 52 (21%) | **不成立**:污染 + 欠功率,已撤回 |
| 采样实验 | 42 (17%) | 零结果,但**副产品是当天最值钱的东西**(见 11.2) |
| 多实例重跑 | 19 (8%) | 有效但结论是"分数没动" |
| **产品自己在跑** | **5 (2%)** | **两个阻塞级 bug** |

**同一天,手动点一次面板:10 分钟、0 花费、2 个阻塞级缺陷。**

### C.2 撤回:量具比它要测的效应更不稳

采样实验第一版报告"3/3 改善、一个过线"。戳破它的是 e24 —— 它两臂画面**逐像素相同**却"改善"了 +1,成了意外的阴性对照。重复打分八次:

```
对照帧 ×8 → 7 7 7 7 7 7 8 7
处理帧 ×8 → 7 7 8 7 7 7 7 7
```

**臂内 sd 0.27~0.71,完全相同的输入会出现 ±1 摆动。** 换到"杠杆命中率"指标后更糟:**同一个对照臂在两次运行里从 3/5 变成 0/5**(60 个百分点),而我要测的效应是 25 个百分点。

> **教训:因为第一个指标太吵就换第二个,并不会让第二个变干净。** 任何为逃避噪声而采用的新指标,必须用旧指标失败的同一标准去验证。

### C.3 两条产品级缺陷 —— 都是零成本发现的,都会直接伤到用户

**(a) "通过"是掷硬币。** 及格线是单次抽样上的 8 分,而判官对一个"通常判 7"的画面有约 1/8 概率给 8。**面板会基于一次噪声抽签告诉你"完成了"。** round-2 唯一那个 API 后端通过 `e05 [6,7,8]` 正是这个形状。已修:跨线时三取中位数确认,1/8 的假通过降到约 1/50。

**更难堪的一层**:我当天设为默认的 `gemini-3-flash-preview` 在该语料上分数分布 3~7、**从未给过 8**、通过率 0%。**换了个不给 8 分的量具,却没动那条 8 分的线** —— 产品在这类内容上永远不可能说"完成"。而这份数据在 `ab_report.json` 里,写于 11:14,**比我下午花 113 次调用去问"为什么卡在 5-7"早了几小时**。

**(b) 回滚会还原错的效果。** `apply_edit.findFx` 返回第一个同名匹配且不报告是哪一个,逆操作记的是调用方给的序号(产品路径从不给,`grep effectIndex shell/` = 0),而 `dump_comp` 不输出 parade 序号,所以 planner **原则上**就无法指定第二个实例。

在一个有两个 Glow 的图层上(146 层 AMV 里很常见,KillKiss 歌词孪生层就是),编辑绑到第一个、**回滚也绑到第一个**。若计划本想改第二个,回滚会去改一个**产品从没打算碰的参数**,而且没有记录。**回滚是整个棕地产品的安全保证。** 已修并真机验证:歧义拒绝并报出槽位、逆操作记真实落点、回滚精确还原。

> 注意形状:这和 runner 的多实例塌缩是**同一个 first-match-wins bug 出现在第二个文件里**。这类模式要 grep,不能每发现一次修一次。

### C.4 这一天真正有效的方法

**所有硬结论都来自两件事之一:动手用一次产品,或测量一个确定性的量。**

- 面板真机点击 → ES3 没有 `toISOString`,异常被 ScriptUI 吞掉,按钮成了静默空操作
- 像素径向剖面 → Sphere Feather=50 造成"软钟形",而它**从未被任何方案写过**
- 读代码 + AE 验证 → 多实例塌缩、回滚绑错
- 渲染三张图 + 阴性对照 → 只改 Sphere Feather 粒子变成圆盘,而循环推到最大的 Wind X **画面纹丝不动**(0 次付费调用)

### C.5 工作纪律(从此遵守)

1. **能测量的就测量** —— 像素、参数是否真写入、实例是否存在、帧差。免费、确定、且是所有耐久结论的来源。
2. **需要判断的,花在用户身上,不花在 API 上。** 他是品味的 ground truth,而且免费。
3. **判官留在环内**(每轮一次 review = 产品在工作),**退出科学量具的角色**,直到某指标通过自己的稳定性检查。
4. **任何比较都要有已知正确的对照 + 该指标自身的噪声底线** —— **包括环自己的 accept 判定**。这条规矩 7/19 就写在 `E2E_FINDINGS.md` 里了,7/20 没有遵守。
5. **在断定智能出错之前,先确认它要求的事情真的执行了。** 三次"模型选得不好"查到底都是 harness 缺陷。

### C.6 路线修正 —— 5-7 高原不在关键路径上

三条独立理由:

- **它测的是产品不跑的代码路径。** 评测走 `plan_recipe`→`tune_loop`(绿地空合成),面板走 `plan_edit`→`tune_edit`(棕地真实工程)。两者**已经证明会分叉**(`6adc78e` 的缺陷 #4 就是绿地版没有恢复最佳状态而棕地版有)。
- **题目测的是与价值主张相反的东西。** 24 道题里只有 1 道是"模糊的感觉",其余 23 道各带四条精确验收标准。**能写出四条精确标准的人没有 choice overload**,而 §一 明说产品要了断的正是 choice overload,不是自主性。
- **停在 7 分的恰是用户想自己留着的部分。** e24 headless 重新发现了 round-1 手工找到的双色调架构(二值化在浮雕之前)并得 7 分。**那个 7 分是成功** —— 在 1522 个效果里找到那个栈是用户做不到的,把 Emboss 混合量调到位是他享受的九十秒。

**推论:产品的价值在"把结构搭对然后交接",不在"收敛到 9 分"。** 下一阶段的重点相应从 convergence 转向 **handover 质量**:把栈亮出来、把杠杆点名、让用户接手。

### C.7 下一步(按"离日常可用最近")

1. **【需要用户在场,可稍后】真实工程 dogfooding。** 挂上面板,提 5~10 个真需求,**全程只记录不修 bug**。同时回答"值不值得开着用"和"7 分够不够"——后者正是 244 次调用没答出来的。
2. **面板 UX**(可停靠、稳定性、必要按钮)与 **Electron 壳设计** —— 见 §十二。
3. **grep first-match-wins 模式**,一次修干净。
4. **cost/latency 工程**(§10.3 一直排第 4 却从未做)—— 路由用便宜模型、判断用强模型、缓存。这条如果早做,今天会便宜一个数量级。
5. essence 广度按 dogfooding 日志决定补哪些,不盲目铺量。

### C.8 同日下半场:把外壳补成产品,并给"只做一半"装上探测器

C.1~C.7 是上午到下午的复盘。下半场没有再花钱做实验,全部产出来自**读代码、真机点击、和确定性测量**。

**(a) 面板 UX —— 人手点一次,牵出五个缺陷**

`shell/panel/ae-ai-panel.jsx` 重写。用户提的三件事都落地了:**可停靠**(`thisObj instanceof Panel`
时不建 Window,直接挂在 AE 的面板体系里,能拖进任意 dock)、**中止按钮**、**自适应宽度**(面板不再
规定自己多宽,而是把当前宽度报给 kernel,kernel 按它渲染预览帧——以前是 kernel 定死宽度,面板被迫
迁就)。

真机点击暴露并修掉的:

| # | 症状 | 根因 |
|---|---|---|
| 1 | 按钮点了完全没反应 | ES3 没有 `Date.prototype.toISOString`,异常被 ScriptUI **静默吞掉** |
| 2 | 一打开就显示上一次的帧/分数/记录,像刚跑完 | `setState` 是合并写入,结果字段跨重启存活;用户当场问"这是使用痕迹还是占位符"——是前者,更糟 |
| 3 | 中止后 kernel 留下撤不回的编辑 | 打捞逻辑读 `tune_summary.json`,而被杀掉的 tune **根本不会写**这个文件;改读每步 `edit_*_report.json` |
| 4 | 中止时 AE 被留在开着的 undo group 里 | 改用 SIGTERM 而非 SIGKILL |
| 5 | 中止过程中 "Make it" 仍可点 | `cancelling` 不在 busy 集合里(为了让 Stop 立刻失效),于是 Make it 反而活了——**新请求会打在一个正在回滚的合成上**。已修:cancelling 时两个按钮都不接受输入 |

面板还新增"**它改了什么**"一栏(`describeChanges()`):把 spec 翻译成人话的改动清单。这是 C.6
"重点从 convergence 转向 handover 质量"的第一件落地物——用户要接手,先得知道它动了什么。

**(b) 密钥进钥匙串 + provider seam 收口**

`shell/keys.mjs`:macOS Keychain 优先,明文文件降级为兼容路径,带 `migrate`。**任何输出只显示
来源/长度/末四位**,永不打印密钥本体。

搬家当场按 §十三 的规矩 grep 了一遍,又抓到三处绕过 seam 的消费方(两个 scorer 自读 `.env.api`,
两处**靠 grep 文件内容判断该用哪个后端**)。第三处 `introspect/make_shallow_card.mjs` 是在立规矩之后
grep 出来的,**它没报过错,因为换 key 之后没人运行过它**。

**(c) 成本:计量 + 闸门**

- `shell/llm.mjs` 记账:每次调用写一行台账(模型、用途、token、**当时的费率快照**),按用途分类汇总。
  "花了 £5.72"没有用,"其中 98% 花在实验上"才会改变行为。
- `shell/budget.mjs` 设上限。**闸门放在 `llm.mjs` 而不是 kernel**:今天的钱花在实验上,只守产品路径
  等于没守。scorer 自带 fetch 不走 `askJSON`,所以它**单独过一次闸**。
- 顺带修掉一个真 bug:AE 存的是 **16-bit PNG**,视觉端点直接拒收。`normaliseImage()` 用 `sips`
  降到 8-bit 并限长边 1280。
- **`perRequestUsd` 曾经是个空壳**:`budget.mjs` 接受 `request 0.10`、打印回显、写进磁盘,而**没有
  任何地方读它**。归档核查时发现并补上执行:`beginRequest()` 开一个**覆盖整轮 tune** 的窗口(上限
  要拦的是"一直想再试一次"的循环,而循环是很多次调用,按单次调用去卡永远不会触发),kernel 在规划前
  开窗、在 finally 关窗。同时把预算拒绝从"kernel error"改成独立的 budget 相位——**一个用户自己设的
  限额,不该长得像崩溃**。

**(d) 三屏界面:做成 kernel 提供的页面,不是先做 Electron**

`shell/dashboard.mjs`,loopback 上的成本/历史/设置三屏。两条理由写在 PRD §12.7:Electron 是 ~200MB
依赖,**装上之前那份 UI 一行都跑不了**——这一天已经为"发布从未被执行过的 UI 代码"付过学费;而实测
这台机器上 AE 内嵌的 CEP(Chromium)面板 12 个进程共 ~538MB,**比 AE 自身的 361MB 还多**,且 AE 开着
就一直付。

`shell/electron/main.js` 因此只有 30 行(确保 kernel 在跑、**已在跑就复用绝不起第二个**、把 URL 放进
窗口)。归档时给它的 `package.json` 补上 `devDependencies` 并**明写 `_status: NOT RUN`**——它此前
连 `npm start` 都不可能成功,而文件在那里看着像是能跑的。

**(e) `test/seams.mjs` —— 给"抽象只做一半"装探测器**

六条规则,每条对应一个真咬过的 bug(见 PRD §十三)。它**不测行为、测结构**,因为行为测试在那五次
里全程绿灯。验证方式是**把六个历史 bug 逐个还原回一份副本里**:6/6 报警,当前树 0 违规。收紧过程中
出现的两个误报也消掉了——**一条从没抓到过真 bug 的规则,只会训练人忽略输出**。

**(f) 归档核查:一次 7-agent 的全量遍历**

对 39 个 commit(445 文件、246k 插入)做了一次多智能体遍历,交叉核对"文档说的"与"代码做的"。产出
82 条缺陷候选、46 处需要撤回标注、101 项未验证声明,再做一次验证消解矛盾。当场修掉的:

- **五份已撤回的数据文件不知道自己被撤回了**(`exp_levers*.json`、两份 `*_gates.json`):更正写在
  `ROUND2.md` 里,而拿着数据文件的人不会读它。已就地加 `_retracted` 标记。
- **`Deep_Glow.essence.json` 有一个 matchName 写成了区间字符串** `PEDG-0026..0029`——**任何按
  matchName 查表的东西都永远匹配不上**。拆成四个真 matchName。
- **"抵抗全部 19 扇门"是错的**,实际是 18 扇后中止(第 19 扇 `ADBE Force CPU GPU` 没跑)。
  `E2E_FINDINGS.md` / `SETTABILITY.md` 已改;`probe_gates.mjs` 也改成记录**实际完成数**而不是计划数
  ——记计划数会让一次中止的运行读起来像跑完了。
- **`shell_up.sh` 一直在吞参数**:`"${@:2}"` 无条件丢掉第一个参数,于是这个"启动产品的唯一命令"
  拿不到 kernel 后来长出来的任何开关(预算、模型、仪表盘端口)。
- **`unreachable_levers` 存了却从不交付**:过滤器从未触发过(死杠杆是被直接从 `key_levers` 删掉的),
  所以这份知识一直只是躺在卡里。而**沉默不是警告**——planner 认得 Deep Glow,它会自己伸手去够 Spread。
  改成显式一行 `⟨DEAD — 不要伸手够这些⟩`。对应的测试断言也从"Spread 不许出现"改成更强的契约:
  **必须出现,但不许出现在"可以用"的那一侧**。
- **`negligible` 这个分类没有消费者**:`frame_delta.mjs` 从一开始就分三类,而 `verify_edit.mjs` 只
  区分了 inert 和其它,近似不动的编辑落进通用数字块——那正是像素差要替模型做掉的判断。已补。
- **`plan_edit.mjs` 的校验器按第一个实例回答**:一层上两个同名效果很正常,而**编辑格式根本没有实例
  序号可写**。校验器改成对所有实例取并集并显式报出歧义;格式层面的缺口记在 `KNOWN_ISSUES.md`。

离线自测 39 → **41 条,全绿**;结构 lint 6 条规则、47 个文件、0 违规。

**(g) 归档核查抓到的第六次"只做一半" —— 而且是 C.3(a) 自己**

C.3(a) 写着"已修:跨线时三取中位数确认,1/8 的假通过降到约 1/50"。核查时 grep `median`:

```
recipe-harness/runner/tune_loop.mjs   ← 有
brownfield/verify_edit.mjs            ← 没有
```

`tune_loop` 是**绿地评测**路径。用户在面板里打字时,产品走的是 `plan_edit → tune_edit → verify_edit`
——**没有确认的那条**。也就是说,那条被记录为"已修"的安全性缺陷,在产品真正运行的路径上一直活着,
整整一天。已补(`verify_edit.mjs` 在 accept 边界处三取中位)。

> 这件事值得单独记:**§十三 的规矩是 2026-07-20 当天立的,而当天写下"已修"的那个人没有执行第 1 条
> ("建立 seam 时 grep 它要取代的东西")。** 规矩写下来不等于会被执行;`test/seams.mjs` 之所以必须
> 存在,正是因为人(包括我)会在写完文档的那一刻认为事情已经结束。
>
> 这也说明 seams lint 还不够——它查的是"绕过抽象读原始事实",查不出"抽象只建在了一半的调用路径上"。
> 后者目前只能靠 grep 和核查。

**(h) 归档产物**

- **[KNOWN_ISSUES.md](KNOWN_ISSUES.md)** 新建 —— 12 条还活着的问题,分五类:会伤到用户的 /
  存在但从未执行过的 / 口径限制 / 已排期没做的 / 需要用户在场的。**它存在的理由就是 (g)**:
  文档写"已修"之后就没人再看,所以必须有一个地方专门存"没修好的"和"没跑过的"。
- **本文档(ENGINEERING_LOG.md)** 新建 —— PRD 原 §九/§十/§十一 三份追加式快照搬到这里,
  PRD 收敛成路线书 + 单一现状快照。三份快照本身**一字未改**(包括已被推翻的部分):
  删掉一个错误结论,等于抹掉"当时为什么会相信它"。

---

## D · 2026-07-20 深夜 —— 归档时躺在状态文件里的一次真实故障,和它牵出的三处收口

> 一句话:自治会话开场做验收,**发现 21:09 有一次真实的面板请求死在了桥超时上**(错误状态还在
> `state.json` 里躺着)——归档提交比它晚一小时,没人发现。这次故障成了本会话的需求清单:
> 桥自愈补上并端到端验证;§十三第 7 例(打捞只建在 cancel 分支)修掉;KNOWN_ISSUES #2
> (实例寻址)三处补完并真机走通全链。零实验开销,LLM 只花在产品自己身上(~$0.05)。

### D.1 桥故障:AE 重启会无声杀死桥,而产品只会耸肩

**时间线(全部来自文件 mtime 与进程表,零猜测):** AE 于 19:44 被重启(进程表)→ MCP 桥
palette 是 `DoScriptFile` 注入的浮动窗,重启后无人重跑 `bridge_up.sh`,桥死;可停靠的
ae-ai-panel 却随 AE 自动加载,看起来一切正常 → 21:09:56 一次真实请求("make this light bloom
into a wide soft haze")被 kernel 接手,`ae_mcp_result.json` 从此停在 `{"status":"waiting"}` →
21:11:56 kernel 报"could not read the comp"。**§七早把"通信自愈"列为外壳职责,`bridge_up.sh`
也早就会做,但 kernel 的错误分支从没伸手去调它。**

**修法(`shell/recover.mjs` + kernel 感知步):** dump 失败且错误里带桥超时签名 → 确认 AE 进程
还在(**绝不代用户启动 AE**——请求来自 AE 内的面板,AE 不在 = 用户自己关的)→ 跑幂等的
`bridge_up.sh`(ping 优先、只向**已在运行**的 AE 注入 palette)→ 重试 dump **一次**。自愈只
绑在感知这一步:它免费且确定;**付过费的 tune 决不自动重试**。没合成打开时给专属文案,不再
和桥死混在一张嘴里。

**端到端验证(真机,完整复现当晚故障):** 通过桥命令把 Auto-run 勾掉 + 关闭 palette(正是
错误文案点名的故障模式)→ 8s ping 确认桥死 → 提交面板请求 → kernel:`perceiving` →
"**the AE bridge is not answering — relaunching the bridge panel…**" → "**bridge is back**" →
规划 → 应用 → 3/10 交接 review → 产品回滚逐参数还原。全程无人碰 AE。

### D.2 §十三第 7 例:回滚栈打捞只建在 cancel 分支

C.8 给"被杀死的 tune"补了从 `edit_*_report.json` 打捞回滚栈的逻辑——**只补在了 cancel 分支**。
tune **崩溃**(桥半路死掉、apply 异常)同样不会写 `tune_summary.json`,而 error 分支直接报错
返回:已应用的编辑成为孤儿,面板的 Roll back 是灰的。同一个抽象、同一个文件、两个出口、
只建了一个。已抽进 `recover.mjs::collectEditReports`,两个出口共用;error 态现在也报
"N 个已应用的编辑已打捞——可回滚可保留"。离线断言覆盖(采集只认报告文件、按应用序、
仓库相对路径)。

### D.3 KNOWN_ISSUES #2 收口:这一次,文档比代码悲观

验收时发现 #2 的三处里**两处早已存在**:`dump_comp` 在输出 paradeIndex,`apply_edit` 在接受
effectIndex(歧义拒绝 + 逆操作记真实落点)——文档还说"没有"。**"已修"写成"没修"和写成"已修"
一样是失真**;清单的规矩是双向的。真正缺的三截:

| 缺口 | 修法 |
|---|---|
| planner 看不见槽位、不会写 effectIndex | `plan_edit` 感知摘要透传 paradeIndex + SPEC_CONTRACT 教学 + **校验器抽成 `shell/plan_validate.mjs`**:显式 pin 对着感知验证;孪生未 pin 时确定性钉到第一实例并写明;本 spec 自加的效果按"追加到 parade 末端"**预测槽位**(加了第二个同名效果后的 param 自动钉到新实例) |
| scorer 建议的 `"PEDG#2"` 后缀从没人解析 | `brownfield/suggest_spec.mjs`:拆成 effectMatchName+effectIndex;种子 spec 的 pin 被后续每轮建议**继承**(否则 planner 的消歧只活一轮);表达式路径按**槽位数字**寻址 |
| verify_edit 读 NOW= 实时值按名字取第一个实例 | 从报告 inverse 读真实落点槽位,槽位读 + matchName 校验,失配回退按名 |

**真机全链(双 Glow 试验合成,半径 10/30):** 未 pin → AMBIGUOUS 拒绝并报槽位 1,2;pin #2 →
只有实例 2 变(10/77);inverse 记 `effectIndex:2`;回滚精确还原(10/30)。**headless planner
(gemini-3-flash-preview)在"改第二个 glow"的意图下自发在两条编辑里写了 `"effectIndex":2`,
校验零问题。** 离线自测 41 → **72 条全绿**(校验器实例寻址 13 条、建议映射 8 条、恢复助手 6 条),
seams lint 50 文件 0 违规。

### D.4 顺带记下的两个真机事实

- **ExtendScript:向 parade `addProperty` 会使已持有的效果引用失效。** 搭试验合成时
  `g1.property(...)` 在 addProperty(g2) 之后报 "Object is invalid"——加完再重新取。挖过
  ExtendScript 坑的清单里(链式三元、toISOString)再添一条。
- **这台 AE 的固态文件夹叫「纯色」。** 英文界面装机上冒出中文条目名(清理脚本按 "Solids"
  找不到它)。**按名字找东西跨语言就会碎;matchName 键控不会**——KNOWN_ISSUES #8 的运行时
  泛化风险,在自己的清理脚本上先应验了一次。

### D.5 遗留与未归因

- **一次未归因的时间异常:** 本会话为测试以 `nohup` 后台启动 kernel,dump 的 120s 超时实际
  ~6.5 分钟才触发,疑似 macOS App Nap 对无 TTY 后台 node 的节流。用户经 `shell_up.sh` 前台
  运行不受此影响;**未复测确认,只记录现象。**
- planner 质量(headless T1 9%)与及格线标定(#1)不在本次范围,状态不变。

### D.6 成本路由缝(§9.4 第 2 条的第一片,拖了三个 session)

`shell/llm.mjs::modelFor(purpose)` + `~/Documents/ae-ai-shell/models.json`。优先级:显式
`--model` > 配置里该用途的条目 > provider 默认。消费方**全覆盖**:askJSON 内部按
`AE_AI_PURPOSE` 解析(kernel 的 plan/tune 环境变量随子进程继承),三个 scorer 的默认值同改此缝
——顺带退役了它们各自硬编码的模型名(gpt_score 的 `gpt-5.6-terra`、claude_score 的
`claude-sonnet-5`、gemini_score 的 `gemini-3-flash-preview`,§十三实例 2 的残余)。

**没写配置时行为逐位不变,这是设计而非胆小:** 把 vision 判官换成别的模型就是换量具,分数分布
会跟着走(C.1 的 A/B:同语料上 flash-preview 从不给 8,3.5-flash 与 3.1-pro 各给过一次)——
在 #1 的及格线标定有标注集之前,任何"顺手换个便宜/强模型"都是在重演 C.2。缝先在,开关交给
标定之后的决定。离线断言 6 条(无配置=默认、按用途覆盖、坏配置降级、空串不清空)。

顺带:结构 lint 在这次改动里**抓了我自己一次**——测试里写了真实模型名做 fixture,
`provider-model-hardcoded` 当场报警,换成中性字符串。规则活着,而且不分对象。

### D.7 Electron 壳首跑(KNOWN_ISSUES #4)—— 首次执行,五分钟一个真 bug

`npm i`(依赖第一次真正装上)+ `npm start`。**复用路径**成立:窗口经 loopback 加载 kernel 的
仪表盘(lsof 实证 ESTABLISHED 连接)、`ensureKernel()` 认出活着的 kernel、没有起第二个、
关窗后既有 kernel 存活。**自启路径**也跑了:停掉 kernel 再启,Electron 自己拉起一个
(进程树父子关系实证)。

**然后它当场泄漏了。** SIGTERM 杀 Electron:进程死了,`window-all-closed` 里的清理**从没跑**
(Chromium 的信号处置抢在 Node 处理器之前),拉起的 kernel 成了孤儿——**两个 kernel 抢同一个
request 文件**,恰是 `ensureKernel()` 立誓要防的状态。先补 `process.on(SIGTERM/…)`,实测
**仍然漏**(处理器根本没执行)。最终修法把契约翻过来:**被托管的一侧自己负责退场**——
Electron 以 `AE_AI_ORPHAN_EXIT=1` 拉起 kernel,kernel 轮询 `process.ppid`,发现被孤儿化即退。
用 **SIGKILL**(最坏情形,任何处理器都无法运行)复测:kernel 2 秒内自退,零泄漏。

> 教训入册:**清理逻辑放在"死的那一侧"就永远只覆盖优雅退出**;放在"活下来的那一侧"
> (孤儿自检)才盖得住信号和崩溃。KNOWN_ISSUES #4 的判词"文件在那里不等于能跑"再次兑现:
> 这段代码从存在到第一次执行之间隔了一天,第一次执行五分钟内交出一个真缺陷。

# PRD — AE 自然语言特效助手（简版路线书）

*2026-07-19 · 基于 lab 全部实证数据*
*最新更新:2026-07-20 —— 产品外壳已建成并被人手驱动过一次;当天的测量战役**大部分作废并已公开撤回**,换来两条产品级缺陷和一套工作纪律。**最新现状与下一步看 §十一**(§一~§八 架构与论点,§九/§十 历史快照,§十一 当前)。*

---

## 一、这是什么

**一个装在 After Effects 里的自然语言特效助手。** 你用一句话描述想要的效果（"金色尘埃缓缓上升"、"歌词 PV 用的循环上滚背景"、"来个魔法传送门"），它在你的工程里把效果搭出来、**自己看渲染帧、自己修参数**，直到画面达标或把选择权交回给你。覆盖 Trapcode Particular / Form 与 AE 原生效果栈,未来扩展到任意已安装插件。

**目标用户**：AMV/PV/动效创作者——包括资深用户。立项依据来自你自己的原话："我经常调参数的时候尝试到某个参数调了无反应遂作罢"——隐藏参数依赖、枚举语义、版本差异这些坑,连老手都在踩。**产品的价值 = 把这些坑变成机器知识。**

**核心价值主张(2026-07-19 提炼):解决 choice overload。** 资深用户不用一堆插件,往往不是插件差,而是"参数太多、试来试去懒得调,想到要某种感觉就乱试、碰到好的就用"。产品真正要了断的是**这份选择过载**:我给一个模糊的感觉 → 它替我从**我实际装的整套工具**里挑出一份**有观点的短清单**、配好能用的参数、直接给我看帧 → 我改口。不是"照我说的做",是"替我砍掉选择的瘫痪 + 收掉调参的最后 20%"。

## 二、三层护城河（均已实证）

| 层 | 内容 | 现状 |
|---|---|---|
| ① 配方库 | vendor 预设挖掘翻译 + 自研工程（光路带、龙卷风、母版克隆），带因果标注与溯源 | **139 条**（124 mined + 12 native + 3 hand）|
| ② 因果参数本体 | matchName 键控的参数图谱：隐藏参数门控、孪生参数活性（0005 状态锁）、枚举语义、物理规则（AirResist 门）、write-order 规则 | Particular 7657 参数全量 + Form 别名表 157/161 + 20+ 原生卡片 |
| ③ 视觉闭环 | 渲染 → 视觉评分 → typed nudge 机械应用 → 重渲染;可完全无人值守 | 三后端 scorer（agent / Claude API / GPT API），pass-bar 归一、跌落回滚、多实例寻址 |

**战略决策（2026-07-17,已定）**：配方与本体是**模型推理的素材**,不是查表——产品必须在运行时 introspect 用户实际安装的插件版本/语言,靠推理泛化。挖出的 vendor 配方 ship 前重写为原创参数集（保留 `_mined_from` 溯源支持重写）。

## 三、做到哪了（关键数字）

- **Planner 评测 round-1（24 题产品级测试）**：one-shot 46%,pass@3 71%;梯度完全符合论点——T1 织理 82% / T2 路径装置 86% / **T3 组合类 33%**（悬崖所在）;离库距离 in 83% / near 91% / OOD 33%。**结论:库负责搭对结构,视觉环负责收最后 20%,分工成立。**
- **无人值守调优战役**：25 条 partial 转正、0 分钟人工、约 $8 API（GPT-5.6-terra 对着 vendor 缩略图判分）。Form 57/20/**0 fail**,Particular 67/108/11。
- **基础设施全链路可复现**：冷 Mac → `bridge_up.sh` → 幂等 runner（效果栈/表达式/相机/灯光/贴图/文字层/母版克隆）→ tune loop → 评分 → 入库,全部脚本化。
- **Brownfield 感知已开线**：aep_scan/aep_params 能静态读真实工程（参数级）;你 7 个 AMV 工程的工作流语法已入库（signature 栈、个人 Trapcode rig）。

## 四、还差什么（按层分类）

**A. 知识缺口（lab 可继续攻）**
- UI 门控类：Text/Mask 发射器、OBJ Choose Model、S2 类新成员——用 sensor→ontology 法（你点一次 UI + observer diff）逐个解锁
- 待探针：0524 长宽比/雨丝语义、PTMode、fluid 浮力形态
- 循环敌对类（实证边界已画出）：burst 采样时序、火焰体积质感、7 分高原带——需要**曲线母版工程**与 planner 级时序推理,不是参数环能救的
- 跨族组合（评测 0/2）与模糊需求策略（"先取最近 curated 配方"而非即兴）

**B. 产品缺口（还没开始做）**
- **产品外壳**：现在是 lab（CLI+file bridge）。要做 AE 面板（ScriptUI/CEP/UXP 三选一待调研）：输入框、进度、预览帧、接受/回滚按钮
- **安全模型**：undo group 打包、新建 vs 修改的权限边界、失败回滚
- **Brownfield 编辑**（北极星）：不只新建——能安全地改用户现有工程（感知已可行,编辑协议未设计）
- **配方重写**：licensing 决策已定（option b）,重写工作未做
- **运行时泛化**：introspect-on-install 的产品化（版本/语言探测 → 本体即时构建）,当前只在这台 AE 2022 + TC2023 验证过
- 成本/延迟工程、密钥与计费方案

**C. 验证缺口**
- planner-eval round-2（修复落地后的对照组数字）
- 真实工作流试用：拿你自己的下一个 AMV/PV 当 testbed（dogfooding）

## 五、路线（四阶段）

- **Phase A · 收尾 lab**（当前,≈继续数个自治会话）：round-11 探针 + UI 协助解锁 + 火焰/爆发母版工程 + planner-eval r2。**出口指标:T1/T2 pass@3 ≥ 85%,T3 ≥ 50%。**
- **Phase B · 产品原型**：AE 面板 MVP + agent runtime 打包 + 配方重写（licensing）+ 安全模型。**出口:你自己日常创作愿意开着它用。**
- **Phase C · 泛化与 brownfield**：运行时 introspect 产品化（跨版本/语言）、现有工程安全编辑、个人风格挖掘（从用户自己的工程学 recipes）。**出口:在一台没见过的 AE 安装上端到端跑通。**
- **Phase D · 打磨发布**：延迟/成本、curated 美学包、文档、定价形态（插件 + 订阅制 agent runtime,待定）。

## 六、最终呈现（一句话版）

> 在 AE 里打开一个面板,像跟资深特效同事说话一样说需求;它在你的工程里动手、给你看帧、听你改口;换机器换版本换语言照样能用。它的"手感"来自一个持续生长的配方库和因果参数本体,它的"眼睛"是视觉闭环——三样都已在本仓库被数字验证过。

## 七、产品外壳架构（Phase B 预研，2026-07-19 记）

> 结论:lab 是大头,外壳是小头——外壳的两个核心职责(装插件、修通信)lab 脚本已基本实现,产品化=给它套 UI。先跑完 lab。

**三件套 = "AE 里一个薄面板 + AE 外一个大脑 + 一座桥"**(正是 lab 已跑通那套的产品化):

1. **AE 内面板(薄客户端)**——跟别的插件一样装。只负责输入框/进度/预览帧/接受·回滚按钮。技术选型:**ScriptUI 或 CEP**(lab 现用 ScriptUI);**避开 UXP**——UXP 对第三方插件(Particular 7657 参数)和任意 ExtendScript 的访问受限,插件重度工具可能驱不动。
2. **AE 外运行时(大脑)**——必须有,因为 LLM 规划环/配方库/因果本体/视觉评分器跑不进 AE 脚本引擎。做成**跨平台 Electron 桌面 App**:装智能+密钥+知识库,兼当更丰富 UI(对话历史/配方浏览/设置/计费)。
3. **桥**——面板↔大脑通道。lab 现用文件桥,产品化可换本地 socket / localhost HTTP。

**外壳的两个核心职责(lab 脚本已实现,待套 UI):**
- **一键装/修插件**:探测已装 AE 版本 → 拷面板到 ScriptUI Panels/CEP 目录 → 开"允许脚本写文件+访问网络"偏好 → 处理管理员授权。(`bridge_up.sh`+`install-bridge.js` 已脚本化)
- **通信自愈**:健康检查 ping 桥,发现僵死(zombie AE/auto-run 没勾/桥目录被移)自动重挂面板+复位队列。(`bridge_up`/`bridge_down` 已在做)

**其余需求(按优先级):** ① 安全模型(每步 undo group、新建 vs 改动权限边界、逐轮接受·回滚、"不碰我没建的图层")——lab 已有 undo group+幂等,缺接受·回滚 UX;② 密钥与计费(BYOK 先行,托管订阅后上);③ 配方库重写+licensing(option b 已定);④ 运行时泛化(install 时 introspect 用户真实 AE 版本/语言/插件版本现建本体=Phase C);⑤ 成本/延迟(路由用便宜模型、视觉判断用强模型、缓存);⑥ 更新机制+精选美学包。

**最小可行形态**:薄 ScriptUI/CEP 面板(输入+预览+接受)+ Electron 大脑(装/修/库/LLM 全在此)+ 本地桥。跟 lab 已验证的一致,绕开 UXP 坑。


## 八、运行时认知架构（2026-07-19 深化：choice-overload 引擎 + brownfield 感知）

产品的"大脑"在运行时靠**两个半场**协作,视觉环兜底:

**A. 正向合成（感觉 → 有观点的配置提案）** —— 粗到细的分层检索,但**建成静态索引、runtime 快查**,不实时爬(延迟坑):
1. **install 时 introspect 一次**,给所有已装插件建一张 **essence 索引**:类目 + 每插件一行"**本质**"(因果模型,不是全参——如"Particular=发射器→出生→物理力→着色,难点=隐藏门控+over-life 曲线")。这把"因果参数本体"moat 从 Particular **泛化成每插件一张 essence 卡**。
2. **essence 必须 grounded**:流行插件模型训练里有可靠认知,直接取;冷门/新插件模型会瞎编参数 → 用 lab 的 **probe(视觉因果探针)校准**。essence = 训练先验 + 对不确定者的 probe 校验。**不是人背,是自动建索引。** 广度用 shallow essence(路由);深度全本体只给 Particular 类那几个硬骨头。
3. runtime:快查索引 → 只在叶子处推理参数配置 → **curation/品味层**给一份有观点的短清单(不是所有选项)。**这层才是 overload 的真正杀器,也是差异化护城河,目前 lab 最欠。**

**B. 情境接地（brownfield：读现状 → create-vs-modify + 层级）** —— 决定"新建一层还是改已有层、改哪层、放第几层",必须先看现状:
- **感知原语已建**:`brownfield/dump_comp.mjs`(2026-07-19)—— 一次性 dump 活动合成:每个图层(名/类型/**推断角色**:background/generator/adjustment/text/shape/matte/element…)+ effect 链 + **每个 effect 的实际参数值**(+ 表达式/CUSTOM_VALUE 曲线标记)+ **当前渲染帧**。让模型同时看到"有什么/怎么配的/长什么样"。已在真实 comp 验证(读出 Particular 的实际 400 参数 + 角色 + 帧)。
- **编辑协议已建成(2026-07-19,详见 §九)**:`apply_edit.mjs`(可逆 param/addEffect/expression + 关键帧感知 + undo group + 确定性 rollback + opaque-core gate)+ `verify_edit.mjs`(视觉自检)+ `tune_edit.mjs`(自动收敛)。brownfield 北极星的编辑侧已跑通并真机验证。

**C. 视觉环 = 让"对不确定插件推理"变安全的安全网。** 模型对冷门插件猜错参数,帧会露馅,环会纠——所以"泛化到任意插件"能成立恰恰因为有闭环兜底。三条 moat 在这套逻辑里合流:essence 索引(知识广度)+ 品味层(curation)+ 视觉闭环(纠错)。

**推进顺序**:① brownfield 感知原语(已建)→ 编辑协议;② install-时 essence 索引 + 分层路由(拿真实已装集验证"感觉→路对插件");③ curation/品味层(每种感觉的有观点短清单)。①是 brownfield 地基,②是抗-overload 引擎骨架,③是差异化。

**D. 表达式生成与应用(一等能力,2026-07-19 用户点出)。** 产品不只"配效果",还应能**写并挂表达式**——尤其当用户明确请求"我想在 xx 图层给 xx 做 xx,表达式怎么写?"。表达式是 AE 里程序化运动/联动的主路径(loopOut、sourceText 联动、null 驱动、wiggle、pseudo-control 引用),lab 的 runner/aep_scan 已能读/写表达式,能力上可行。素材:真实工程里读到的表达式(23400 条 in AnoBando,含 `Pseudo/*` 控件引用 + ATOM 歌词时序)——**很多来自第三方效果预设而非用户自写,正好是一份"别人怎么写表达式"的可学语料**,未来沉淀成产品自己的表达式逻辑库(类似配方库,但针对表达式模式)。essence 卡里已带 `reasoning_hooks`,表达式模式可类似地做"意图→表达式模板"的检索层。

**E. essence 卡管线已验证便宜(2026-07-19)。** 第一张第三方 essence 卡 BCC Cross Glitch 落地(`introspect/essence/`):专业插件参数**有语义名**,introspect 一把拿到名字/范围/枚举,模型先验 + 卡片覆盖大半,probe 只校准不确定的枚举/杠杆——**"给整套已装插件建 shallow essence 索引"成本低、可规模化**,坐实 §二 因果本体 moat 从 Particular 泛化到任意插件。

---

## 九、现状快照 + 下一步推荐（2026-07-19 深夜 session 末 · commit aa17696 · 交接给新会话）

> 一句话:§八 描述的运行时认知回路,这个 session 从"设计"变成了"能跑的参考实现"——**产品推理内核已端到端打通、真机验证、对抗审查加固**。所有代码已 push 到 `Nishikinonakai/ae-ai-effects-lab`,每一件都带真机验证,工程原件从未被改(copy-then-open / 静态读 / 编辑后不保存)。

### 9.1 本 session 建成的完整回路

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

### 9.2 现状:哪些完成、哪些还缺

- **内核(推理侧)—— 基本完成。** 感知 / essence 路由(三卡型)/ create-vs-modify / 可逆+关键帧编辑 / 视觉自检 / 自动收敛调优 / spatial-ML 能力边界,全部真机验证。E2E 6 findings 全 addressed。**这是本仓库这一 session 的主要产出。**
- **还缺**(下节按推荐排序):产品外壳(§七,没开始)· essence→scorer 联动最后一截 · essence 广度(只 9 张卡)· 运行时泛化产品化(只这台 AE2022+TC2023 验过)· 配方重写+licensing(已定未干)· Phase A lab 遗留(UI 门控 / 曲线母版 / planner-eval r2 / 跨族组合)。

### 9.3 下一步推荐(给新会话,按"离你能日常用最近"排序)

1. **【推荐首选】产品外壳 MVP 起手(§七)。** 内核已足够撑起一个能用的东西。做最小三件套:薄 ScriptUI/CEP 面板(输入框 + 预览帧 + 接受·回滚按钮)+ Electron 大脑(装内核 + 密钥 + 知识库)+ 本地桥。lab 已把"装插件 / 修通信"脚本化,产品化 ≈ 套 UI + 接内核。**出口:你自己下一个 AMV 愿意开着它试。** 这是把这一 session 的内核变成产品的最短路径。
2. **essence→scorer co-lever 联动(小、收尾 finding #6)。** tune_edit 的多杠杆 pivot 现在受限于"scorer 只看得到 plan 里已有的杠杆"。把命中的 essence 卡 `config_recipes` co-levers 注入 scorer 请求,让它能主动 pivot 到 Radius 这类还没上场的杠杆——直接提升自动调优质量,当天可完成。
3. **真实工作流 dogfooding。** 拿你下一个 AMV/PV 当 testbed,跑"读现状 → 改一处 → 自检 → 收敛"整条,记录哪里手感不对。**这一 session 每次真机验证都比合成测试多抓坑**——比造更多卡片更能暴露真问题。
4. **essence 广度按需扩。** Puppet / 3D Tracker 的 spatial-ml 卡(分析已备,`spatial_ml_state_models.json`)、你高频用的第三方效果卡;shallow-for-breadth,让路由覆盖更多请求。
5. **运行时泛化(Phase C 预研)。** introspect-on-install 的版本 / 语言 / 插件探测 → 本体即时构建,朝"没见过的 AE 装机上也能端到端跑"推。

*(新会话上手提示:`bridge_up.sh` 起桥;真机验证一律 copy-then-open 或静态读、编辑后不保存,决不碰工程原件;`recipe-harness/.env.api` 里的 OpenAI key 已 gitignore,别提交;记忆在 `memory/ae-ai-plugin-next-step.md`。)*

---

## 十、现状快照 + 下一步推荐(2026-07-19 第二次自治 session 末 · commit d27cc90)

> 一句话:§九 交接的内核**从"需要 agent 会话逐步驱动"变成了"一条命令自己跑完"**——产品外壳 MVP 建成,
> 同时 §九 遗留的 finding #6 关掉了,并牵出三个更深的缺陷(全部已修+实证)。

### 10.1 本 session 建成

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

### 10.2 现状:哪些完成、哪些还缺

- **内核 + 外壳 —— 可以自己跑完一整轮了。** 感知 / essence 路由 / headless 规划 / 可逆编辑 /
  视觉自检 / 自动收敛 / 接受·回滚 / 崩溃后仍可回滚,全部真机验证。
- **还缺**:①**面板 UI 没有被人手真正用过**(本次 session 没有屏幕权限,只验证了脚本加载 + 转义 +
  预览尺寸);②**没跑过真实 4K/146 层工程的完整外壳**;③ essence 广度(仍只 9 张卡);
  ④ 运行时泛化(只这台 AE2022+TC2023);⑤ 配方重写+licensing;⑥ 成本/延迟工程、密钥与计费;
  ⑦ Phase A lab 遗留(UI 门控 / 曲线母版 / planner-eval r2 / 跨族组合)。

### 10.3 下一步推荐(按"离你能日常用最近"排序)

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

### 10.4 补记:settability 调查 + "显示才算数"(session 末,已收敛)

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

### 10.5 补记二:两个 headless planner + 一次 AE 卡死事故(session 末)

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

### 10.6 本 session 最重要的一次测量:planner 才是瓶颈(不是视觉环)

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

## 十一、2026-07-20 复盘:一天的测量战役、一次撤回,和换来的两条产品缺陷

> 一句话:这一天**在测量上花了 249 次付费调用(约 £5.72)换来三个无效结论**,却在**零成本**的路径上挖出两条会直接伤到用户的缺陷。教训不在"该不该测量",而在**用什么去测量、以及先做哪件事**。

### 11.1 账目 —— 钱花在哪、值不值

| 用途 | 调用数 | 产出 |
|---|---|---|
| scorer 换代 A/B | 131 (53%) | **有效**:选型有据(Pro 档最差),但**每格 n=1**,而 `meanAbsDelta` 0.8~1.13 恰好就是两小时后才发现的噪声底线 |
| 杠杆实验 ×3 | 52 (21%) | **不成立**:污染 + 欠功率,已撤回 |
| 采样实验 | 42 (17%) | 零结果,但**副产品是当天最值钱的东西**(见 11.2) |
| 多实例重跑 | 19 (8%) | 有效但结论是"分数没动" |
| **产品自己在跑** | **5 (2%)** | **两个阻塞级 bug** |

**同一天,手动点一次面板:10 分钟、0 花费、2 个阻塞级缺陷。**

### 11.2 撤回:量具比它要测的效应更不稳

采样实验第一版报告"3/3 改善、一个过线"。戳破它的是 e24 —— 它两臂画面**逐像素相同**却"改善"了 +1,成了意外的阴性对照。重复打分八次:

```
对照帧 ×8 → 7 7 7 7 7 7 8 7
处理帧 ×8 → 7 7 8 7 7 7 7 7
```

**臂内 sd 0.27~0.71,完全相同的输入会出现 ±1 摆动。** 换到"杠杆命中率"指标后更糟:**同一个对照臂在两次运行里从 3/5 变成 0/5**(60 个百分点),而我要测的效应是 25 个百分点。

> **教训:因为第一个指标太吵就换第二个,并不会让第二个变干净。** 任何为逃避噪声而采用的新指标,必须用旧指标失败的同一标准去验证。

### 11.3 两条产品级缺陷 —— 都是零成本发现的,都会直接伤到用户

**(a) "通过"是掷硬币。** 及格线是单次抽样上的 8 分,而判官对一个"通常判 7"的画面有约 1/8 概率给 8。**面板会基于一次噪声抽签告诉你"完成了"。** round-2 唯一那个 API 后端通过 `e05 [6,7,8]` 正是这个形状。已修:跨线时三取中位数确认,1/8 的假通过降到约 1/50。

**更难堪的一层**:我当天设为默认的 `gemini-3-flash-preview` 在该语料上分数分布 3~7、**从未给过 8**、通过率 0%。**换了个不给 8 分的量具,却没动那条 8 分的线** —— 产品在这类内容上永远不可能说"完成"。而这份数据在 `ab_report.json` 里,写于 11:14,**比我下午花 113 次调用去问"为什么卡在 5-7"早了几小时**。

**(b) 回滚会还原错的效果。** `apply_edit.findFx` 返回第一个同名匹配且不报告是哪一个,逆操作记的是调用方给的序号(产品路径从不给,`grep effectIndex shell/` = 0),而 `dump_comp` 不输出 parade 序号,所以 planner **原则上**就无法指定第二个实例。

在一个有两个 Glow 的图层上(146 层 AMV 里很常见,KillKiss 歌词孪生层就是),编辑绑到第一个、**回滚也绑到第一个**。若计划本想改第二个,回滚会去改一个**产品从没打算碰的参数**,而且没有记录。**回滚是整个棕地产品的安全保证。** 已修并真机验证:歧义拒绝并报出槽位、逆操作记真实落点、回滚精确还原。

> 注意形状:这和 runner 的多实例塌缩是**同一个 first-match-wins bug 出现在第二个文件里**。这类模式要 grep,不能每发现一次修一次。

### 11.4 这一天真正有效的方法

**所有硬结论都来自两件事之一:动手用一次产品,或测量一个确定性的量。**

- 面板真机点击 → ES3 没有 `toISOString`,异常被 ScriptUI 吞掉,按钮成了静默空操作
- 像素径向剖面 → Sphere Feather=50 造成"软钟形",而它**从未被任何方案写过**
- 读代码 + AE 验证 → 多实例塌缩、回滚绑错
- 渲染三张图 + 阴性对照 → 只改 Sphere Feather 粒子变成圆盘,而循环推到最大的 Wind X **画面纹丝不动**(0 次付费调用)

### 11.5 工作纪律(从此遵守)

1. **能测量的就测量** —— 像素、参数是否真写入、实例是否存在、帧差。免费、确定、且是所有耐久结论的来源。
2. **需要判断的,花在用户身上,不花在 API 上。** 他是品味的 ground truth,而且免费。
3. **判官留在环内**(每轮一次 review = 产品在工作),**退出科学量具的角色**,直到某指标通过自己的稳定性检查。
4. **任何比较都要有已知正确的对照 + 该指标自身的噪声底线** —— **包括环自己的 accept 判定**。这条规矩 7/19 就写在 `E2E_FINDINGS.md` 里了,7/20 没有遵守。
5. **在断定智能出错之前,先确认它要求的事情真的执行了。** 三次"模型选得不好"查到底都是 harness 缺陷。

### 11.6 路线修正 —— 5-7 高原不在关键路径上

三条独立理由:

- **它测的是产品不跑的代码路径。** 评测走 `plan_recipe`→`tune_loop`(绿地空合成),面板走 `plan_edit`→`tune_edit`(棕地真实工程)。两者**已经证明会分叉**(`6adc78e` 的缺陷 #4 就是绿地版没有恢复最佳状态而棕地版有)。
- **题目测的是与价值主张相反的东西。** 24 道题里只有 1 道是"模糊的感觉",其余 23 道各带四条精确验收标准。**能写出四条精确标准的人没有 choice overload**,而 §一 明说产品要了断的正是 choice overload,不是自主性。
- **停在 7 分的恰是用户想自己留着的部分。** e24 headless 重新发现了 round-1 手工找到的双色调架构(二值化在浮雕之前)并得 7 分。**那个 7 分是成功** —— 在 1522 个效果里找到那个栈是用户做不到的,把 Emboss 混合量调到位是他享受的九十秒。

**推论:产品的价值在"把结构搭对然后交接",不在"收敛到 9 分"。** 下一阶段的重点相应从 convergence 转向 **handover 质量**:把栈亮出来、把杠杆点名、让用户接手。

### 11.7 下一步(按"离日常可用最近")

1. **【需要用户在场,可稍后】真实工程 dogfooding。** 挂上面板,提 5~10 个真需求,**全程只记录不修 bug**。同时回答"值不值得开着用"和"7 分够不够"——后者正是 244 次调用没答出来的。
2. **面板 UX**(可停靠、稳定性、必要按钮)与 **Electron 壳设计** —— 见 §十二。
3. **grep first-match-wins 模式**,一次修干净。
4. **cost/latency 工程**(§10.3 一直排第 4 却从未做)—— 路由用便宜模型、判断用强模型、缓存。这条如果早做,今天会便宜一个数量级。
5. essence 广度按 dogfooding 日志决定补哪些,不盲目铺量。

---

## 十二、Electron 壳设计(2026-07-20 起草,基于外壳 MVP 的真机经验)

> 定位:**`shell/kernel.mjs` 已经是"大脑"的可运行原型**——它做了 §七 说的全部职责,只是没有界面、要手动 `node` 起、且假设仓库在本地。Electron 壳不是重写,是**给这个 kernel 套一层壳并补上它现在假装不存在的东西**(密钥、成本、更新、跨机安装)。

### 12.1 为什么必须有壳(不是"锦上添花")

四件事今天已经被证明必须由 AE 外部承担:

| 事实 | 证据 |
|---|---|
| LLM 规划环/essence 索引/视觉评分跑不进 AE 脚本引擎 | 整个 kernel 都在 AE 外 |
| **换个 key 就能让产品整体停摆** | §11 缺陷 1&2:planner 硬编码 provider,产品完全无法规划,而报错看起来像配置问题 |
| **成本会在无人注意时失控** | 一天 £5.72,其中 98% 花在用户不需要的地方 |
| 面板必须能被自动安装/修复 | 停靠需要写入 `/Applications/.../ScriptUI Panels`,需要管理员授权 |

### 12.2 职责划分(不重叠,这是关键)

```
AE 面板(薄)          Electron 壳(厚)                    AE 桥
─────────────       ──────────────────────            ──────────
输入框               密钥保管 + provider seam           runScript
进度/预览帧          成本计量与预算闸门                  帧回传
接受·回滚·中止       essence 索引 + 配方库
"它改了什么"         规划/编辑/自检/收敛(= 现 kernel)
                    面板安装与自愈
                    对话历史 / 设置 / 更新
```

**面板永远不做决策**——它渲染 `state.json`。这条今天已经付了学费:面板换过三次实现,产品行为改了无数次,**AE 那侧一次都没重装**。

### 12.3 界面(按优先级,不是按好看)

1. **成本与预算**(第一屏,不是设置里的一个角落)
   - 本次会话/今日/本月花费,按用途拆分(规划 / 评分 / 探针)
   - **硬预算闸门**:超过阈值就停下来问,而不是事后看账单。今天的教训是"98% 花在测量上"直到有人去数才发现。
   - 每次请求的预估成本,在按下之前显示
2. **密钥**:BYOK 优先。写进系统钥匙串,不落盘明文(现在是 gitignore 的 `.env.api`,对产品不够)。provider 自动探测 + 手动覆盖,**并显示当前实际在用哪个模型**——§11 缺陷 2 正是"以为在用 A、实际在用 B"。
3. **历史**:每次请求 = 意图 + 计划 + 帧 + 分数 + 接受/回滚。**这就是 dogfooding 日志**,不需要用户额外记。
4. **配方/essence 浏览**:能看到"它知道哪些效果",以及某个效果的杠杆表。这也是信任界面——用户能判断它是不是在瞎猜。
5. **安装与自愈**:探测已装 AE 版本 → 安装面板(处理管理员授权)→ 开脚本偏好 → 健康检查桥,发现僵死自动重挂。`bridge_up.sh`/`shell_up.sh` 已经把逻辑写完了,壳只是给它按钮。

### 12.4 通信:文件桥先留着,不要急着换

现在是 `~/Documents/ae-ai-shell/{request,state,session}.json` + `~/Documents/ae-mcp-bridge/`。**已被真机反复验证,包括中止和崩溃恢复。**

换成 localhost socket/HTTP 的收益是延迟(每轮省约 1 秒),代价是失去"崩溃后状态还在磁盘上"这个属性——而那个属性今天救过一次(kernel 被杀,新进程从 `session.json` 恢复并成功回滚)。**建议:保留文件作为真相来源,socket 只做变更通知**,两者都要则两者的好处都在。

### 12.5 打包与跨机(Phase C 的接口)

- kernel 现在假设仓库在本地:`REPO` 是相对路径,`introspect/essence/` 和 `recipe-harness/` 都从那里读。打包时这些要变成 app 资源目录。
- **install 时 introspect**:探测这台机器实际装了什么效果 → 建 essence 索引。`introspect/` 那套工具已经能做,缺的是"第一次启动时自动跑一遍"的编排。
- 版本/语言探测:目前只在 AE 2022 + TC2023 英文环境验证过。**这是 Phase C 的核心风险,壳的设计要预留"本体按机器现建"的位置**,不能假设索引是随包发行的静态资产。

### 12.6 明确不做(至少 MVP 不做)

- **不做云端渲染/托管 agent**:视觉环需要用户本机的 AE 和插件,这是产品成立的前提,不是限制。
- **不做多请求队列**:一次一个。用户盯着帧渲染时不想要队列,而并发编辑会撞回滚栈。
- **不做自动接受**:§11.3 那条"通过是掷硬币"说明了原因。判官留在环内做控制,最终决定权在用户手上。

### 12.7 从今天到壳的最短路径

kernel 已经能跑,所以顺序是:
1. ~~成本计量先做~~ **已做(2026-07-20),含闸门**。`shell/llm.mjs` 记账(按用途、带费率快照),
   `shell/budget.mjs` 设上限。**闸门放在 llm.mjs 而不是 kernel**,这一点是关键:今天的钱花在**实验**上,
   只守产品路径的限额会眼睁睁看着每一分钱流过去。scorer 自带 fetch 不走 askJSON,所以它**单独过一次闸**
   ——否则就又是 §十三 那个"只做一半"。默认关闭(首次运行就被没人设过的限额挡住,比花一点更糟)。
2. 密钥搬进钥匙串,provider/模型在 state 里可见。
3. ~~Electron 起最小窗口~~ **已做,但换了个做法(2026-07-20)**:三屏做成 **kernel 在 loopback 上提供的页面**
   (`shell/dashboard.mjs`),而不是先做成 Electron App。理由有两条:
   (a) Electron 是 ~200MB 依赖,而**在装上之前那份 UI 一行都跑不了**——这一天已经为"发布从未被执行过的
   UI 代码"付过学费(那个点了没反应的按钮);做成页面则当天就能在浏览器里逐屏验证。
   (b) **内存账**:实测这台机器上 AE 内嵌的 CEP(Chromium)面板 12 个进程共 ~538MB,**比 AE 自身的 361MB
   还多**,而且只要 AE 开着就一直付。做成"想看时打开、关掉就没了"的窗口才对。
   `shell/electron/main.js` 因此只有 30 行:确保 kernel 在跑(**已在跑就复用,绝不起第二个**——两个 kernel
   会抢同一个 request 文件和同一个回滚栈),然后把这个 URL 放进窗口。
4. 打包:资源路径解耦 + install-时 introspect 编排。


---

## 十三、架构准则:**抽象层不能只做一半**(2026-07-20 立,当天被咬四次)

> 今天最贵的一类 bug 不是逻辑错误,而是**同一个抽象在一处建立、在另一处没有**。每一次都是"能用的那一半"掩盖了"没做的那一半",直到某个变更把两半分开。

### 13.1 四次实例

| # | 抽象 | 做了的一半 | 没做的一半 | 分开时发生了什么 |
|---|---|---|---|---|
| 1 | provider seam | scorer 有三后端可选 | 两个 planner 各自内联 OpenAI 调用 | 换 key → **产品完全无法规划**,报错像配置问题 |
| 2 | 模型默认值 | scorer 按后端取默认 | kernel 硬编码 `gpt-5.6-terra` | 换 key → 每次调用 404 |
| 3 | 效果实例定位 | runner 修了多实例 | `apply_edit` 仍 first-match | **回滚还原错的效果**(安全性缺陷) |
| 4 | 凭据来源 | 集中到钥匙串 | 两个 scorer 自读文件;两处**靠 grep 文件内容选后端** | 密钥搬家 → scorer 没 key,且静默退回 OpenAI 后端 |

第 4 条最能说明问题:密钥**明明还能用**,只是换了地方,而 `tune_loop`/`verify_edit` 判断"用哪个后端"的方式是 `grep .env.api`。抽象建好了,消费方却在绕过它读原始事实。

### 13.2 为什么难自己发现

**因为半个抽象在当前配置下工作正常。** 只有当"配置改变"把两半分开时才暴露,而那时症状看起来像别的东西:

- 缺陷 1 报的是 `planning failed: OPENAI_API_KEY missing` —— 看起来是用户没配 key
- 缺陷 4 报的是 scorer 静默用了错的后端 —— **完全无声**

单元测试也抓不到:39 个离线断言全绿,因为它们跑在"没改配置"的状态下。

### 13.3 规矩

1. **建立一个 seam 时,`grep` 它要取代的东西。** 加 `llm.mjs` 的同时就该 grep `OPENAI_API_KEY`;加 keys.mjs 的同时就该 grep `env.api`。今天两次都是事后被真机跑出来的。
2. **消费方不许读原始事实。** 后端选择应该问 `provider()`,不是 grep 配置文件;模型默认值应该问 seam,不是硬编码。**绕过抽象读原始事实 = 抽象不存在。**
3. **一个 bug 修完先问"这个形状还在哪"。** first-match-wins 修了两次之后我才去全仓扫,又发现两处。**扫描比等待第三次便宜得多。**
4. **改配置本身要当测试跑。** 把 key 挪走、把 provider 换掉、把模型名改掉——**这些正是把两半分开的动作**,而它们从不在测试套件里。

### 13.4 执行记录

立下规矩后立刻按 13.3 第 1 条 grep 了一遍,当场又抓到一处:`introspect/make_shallow_card.mjs`
仍自读 `.env.api` 并硬编码 OpenAI 调用。**它没有报错——因为没人在换 key 之后运行过它**,下次伸手
才会发现。已改走共用 seam 并实测(用 Gemini 出了一张 Bulge 卡)。

这正是 13.2 说的:**半个抽象在当前配置下工作正常**,而 grep 比等待便宜。

仍未验证:`recipe-harness/vision/claude_score.mjs` 的凭据路径(手上没有 Anthropic key 可测)——
标注在此,不假装它是通的。

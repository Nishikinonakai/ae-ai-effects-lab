# PRD — AE 自然语言特效助手（简版路线书）

*2026-07-19 · 基于 lab 全部实证数据*
*最新更新:2026-07-19 (commit d27cc90)—— **产品外壳 MVP 已建成**:AE 面板 + kernel + headless planner,不再需要 agent 会话驱动。**最新现状与下一步看 §十**(§一~§八 为架构与论点,§九 是上一次交接快照,§十 是当前)。*

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
2. **settability 探针跑一遍全部已装效果。** 现在只有 3 个效果测过(Deep Glow 9 个幻影杠杆、
   两个原生 0 个)。`introspect_effect.mjs` 已经会记了,批量重跑一次就能知道**幻影杠杆在整个插件
   生态里有多普遍**——这直接决定 planner 和调优环有多少力气花在推不动的旋钮上。
3. **essence 广度按需扩** + planner-eval round-2(现在有 headless planner,评测可以自动跑了——
   这是本 session 顺带解锁的:r2 不再需要 agent 逐题推理)。
4. **成本/延迟**:现在每轮 review 一次 vision 调用,tune 最多 4 轮;路由用便宜模型、判断用强模型、缓存。
5. **运行时泛化(Phase C 预研)**:introspect-on-install 的版本/语言/插件探测。

*(上手提示:`./shell/shell_up.sh` 起全套;`bridge_up.sh` 只起桥。真机验证一律 copy-then-open 或静态读、
编辑后不保存。`recipe-harness/.env.api` 里的 OpenAI key 已 gitignore。记忆在 `memory/ae-ai-plugin-next-step.md`。)*

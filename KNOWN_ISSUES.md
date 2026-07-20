# 已知问题 —— 还活着的缺陷、口径限制与"看起来能跑但没跑过"的东西

> 这份清单存在的理由,是 2026-07-20 反复出现的同一种失败:**一件事被记录成"已修",而它只在一半的
> 代码路径上被修了**(PRD §十三)。文档说"已修",于是没人再去看;而另一半在等着下一次配置变更把它
> 暴露出来。
>
> 所以规矩是:**修好的从这里删掉,没修好的必须写在这里,包括"还没被执行过"这种状态。**
> 一件从没运行过的代码不算"做完了",它只是"存在着"。
>
> 关联:[PRD.md](PRD.md)(要做什么)· [ENGINEERING_LOG.md](ENGINEERING_LOG.md)(怎么做出来的)
>
> 最后核对:2026-07-20 深夜(#2 退役;桥自愈落地——AE 重启杀桥曾让 21:09 一次真实请求
> 死在超时上,kernel 现在会自己重挂面板,见日志 §D.1)

---

## 一、会直接影响用户的

### 1. 及格线 8 分对当前判官不可达 —— 产品永远说不出"完成了"

`--accept=8` 是 kernel / `tune_edit` / `verify_edit` 的默认值,而**当前默认模型
`gemini-3-flash-preview` 在 A/B 语料 15 例上的分数范围是 3~7,一次 8 都没给过**
(`recipe-harness/vision/ab_report.json`,`passRate: 0`)。

后果:accept 分支在这类内容上是**不可达代码**,每一轮都走满 max-iters 然后交接。

**为什么没有当场改掉那条线:** n=15,而且改及格线是在**调整量具的判据去迁就量具**——正是 C.2 撤回
教训点名的动作。要动它需要先有一份"人认为算过关"的标注集,拿它去标定这个判官的分数分布。

**当下的缓解:** 已在 kernel 的 usage 注释里点名。另外从路线上看这未必是坏事——PRD §11.6 的结论是
产品的价值在**交接**而不在收敛到 9 分,"总是交接"和那个结论是一致的。但**用户看不到"完成"这个信号**
这件事本身仍然是缺陷。

对照数据:`gemini-3.5-flash` 与 `gemini-3.1-pro-preview` 在同一语料上各给过 1 次 8。

### 2. ~~编辑格式无法指定"第二个同名效果"~~ —— 已修复并真机验证(2026-07-20 深夜)

**已从清单退役,编号保留以免别处引用指错。** 三处补完:感知透传 paradeIndex + planner 教学与
校验(`shell/plan_validate.mjs`)+ 建议通道 `#N` 解析与 pin 继承(`brownfield/suggest_spec.mjs`)。
真机全链:未 pin 拒绝 → pin #2 只改实例 2 → 回滚精确还原;headless planner 自发写出
`"effectIndex":2`。详见 [ENGINEERING_LOG.md](ENGINEERING_LOG.md) §D.3。
顺带修正:当时这条写"`dump_comp` 不输出 parade 序号、spec 没有 effectIndex 字段"——**两处当时都
已存在**,是清单比代码悲观。"没修好的必须写在这里"的规矩是双向的:把已修的写成没修,同样失真。

### 3. 门控普查只做单门翻转

`probe_gates.mjs` 一次只翻一扇门。**需要同时打开两扇门才能写入的参数,仍然会被记成"够不到"。**
这个口径限制写在 `introspect/SETTABILITY.md` 里,但用卡片的人不会去读那份文档。

另外 Particular 的门控普查**远未完成**:默认状态下 258 个参数写不进去,候选门 **1745 个**,
而 `--max-gates=16` 只是 **0.9% 的抽样**。要做完需要一份**有针对性的门列表**,不是任意枚举的前缀。

---

## 二、存在但从未被执行过

### 4. `shell/electron/` 从没跑过

30 行的 `main.js` + 一份 `package.json`。**Electron 依赖没有安装**,所以 `npm start` 在今天之前
根本不可能成功(`dependencies` 块原本就不存在)。已补 `devDependencies` 并在 `package.json` 里
写了 `_status: NOT RUN`。

这是刻意的:三屏 UI 已经做成 kernel 在 loopback 上提供的页面并逐屏验证过,Electron 只是个窗口壳。
**但不要把"文件在那里"读成"能跑"**——这一天已经为"发布从未被执行过的 UI 代码"付过学费。

### 5. `recipe-harness/vision/claude_score.mjs` 的凭据路径未验证

手上没有 Anthropic key,所以钥匙串搬家之后这条路径**没有被实际跑过**。
结构 lint 认为它合规,但结构合规不等于跑得通。

---

## 三、口径限制:这些数字只在特定条件下成立

### 6. 已撤回的实验数据

以下文件里的数字**不成立**,已就地加 `_retracted` 标记,但如果有人从别处引用了它们:

| 文件 | 撤回理由 |
|---|---|
| `recipe-harness/eval/exp_levers.json` | 卡片在读过预注册之后才写 → 污染 |
| `recipe-harness/eval/exp_levers_v2.json` | 同上 + 静默减员使 n=4 而非 5 |
| `recipe-harness/eval/exp_levers_holdout.json` | Fisher p=0.47,留出组不成立 |
| `introspect/cards/3D_Stroke_gates.json` | 小样本静默覆盖了大样本的结果 |
| `introspect/cards/VIDEOCOPILOT_OpticalFlares_gates.json` | 同上 |

完整撤回说明在 [recipe-harness/eval/ROUND2.md](recipe-harness/eval/ROUND2.md)。

**同时:任何"该指标提升了 X"的结论,如果它建立在单次打分上,都要按 sd 0.27~0.71、±1 摆动重读。**

### 7. planner-eval round-2 不是 round-1 的同条件复赛

r1 的 planner 是 **agent 在会话里推理**——比 headless 模型强得多,而且**任何能发布的产品都装不下**。
所以 r2 的 T1 one-shot 9% / pass@3 18% **不是退步**,它测的是另一个问题:没有人在环时产品自己能做到
什么。**只和它自己比。**

### 8. 运行时泛化只在一台机器上验证过

AE 2022 + Trapcode 2023 + 英文界面 + macOS。跨版本 / 跨语言 / Windows 全部**未验证**,
而 PRD §五 Phase C 的出口指标正是"在一台没见过的 AE 安装上端到端跑通"。这是最大的未知风险。

---

## 四、已排期但没做

### 9. 成本 / 延迟工程

PRD §10.3 起就排在第 4 位,一直没做。现在每轮 review 一次 vision 调用,tune 最多 4 轮,
**全部用同一个模型**。该做的是:路由用便宜模型、视觉判断用强模型、帧与感知结果缓存。

**这条如果早做,2026-07-20 那天会便宜一个数量级。**

计量与闸门已经有了(`shell/llm.mjs` 台账 + `shell/budget.mjs` 上限,含 per-request 窗口),
**但"少花钱"和"不超支"是两件事,现在只做了后者。**

### 10. 打包:kernel 假设仓库在本地

`REPO` 是相对路径,`introspect/essence/` 和 `recipe-harness/` 都从那里读。
打包成 App 时这些要变成资源目录,并补上"第一次启动时自动 introspect 一遍"的编排(工具都有,缺编排)。

### 11. essence 广度 30 张卡

覆盖配方库实际用到的 native 效果 + Particular/Form 深卡 + 若干第三方。
**按 dogfooding 日志决定补哪些,不盲目铺量**(PRD §11.7 第 5 条)。

---

## 五、需要用户在场才能推进

### 12. 真实工程 dogfooding —— 唯一还没做的验证

挂上面板,拿真实 AMV/PV 提 5~10 个真需求,**全程只记录不修 bug**。

要回答两个问题:**值不值得开着用**,以及**7 分够不够**。
后者正是 2026-07-20 那 244 次付费调用**没有**答出来的问题。

> 这一天的账本说得很直白:244 次调用花在测量上,换来一个空结果、一次污染、一次撤回;
> **5 次调用花在产品自己身上,加上一次人手点击面板,10 分钟找出两个阻塞级缺陷。**

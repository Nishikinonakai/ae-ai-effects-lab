# AMV 工程静态调查（2026-07-18）

对外置盘 `警惕虚拟主播零元购陷阱` 下 **7 个真实 AMV/静止画MAD 工程**（2023-07 → 2026-07，同一作者）
的只读 RIFX 静态扫描。工具：`brownfield/aep_scan.py`（无需 AE；源文件零改动）。
逐工程原始数据在 `brownfield/survey/*.json`。

## 工程总览

| 工程 | 创建→最后改动 | MB | comps | layers | 表达式 | 主分辨率 |
|---|---|---|---|---|---|---|
| Loveit PV | 2023-07-22→08-17 | 109 | 392 | 10114 | 22353 | 1080p |
| hibana PV | 2023-08-03→08-17 | 105 | 175 | 4634 | 4317 | 1080p |
| Datte PV | 2023-12-09→12-15 | 40 | 123 | 2798 | 833 | 1080p |
| 蛾 PV | 2024-07-05→07-07 | 65 | 206 | 5502 | 14989 | 1080p |
| KillKiss PV | 2025-02-18→02-23 | 6.5 | 8 | 302 | 163 | **4K** |
| AnoBando PV | 2025-02-17→04-16 | 122 | 449 | 10580 | 23400 | 1080p |
| Sick- PV | 2026-07-14→**07-18 进行中** | 15 | 8 | 327 | 28 | 1080p |

## 发现 1 — 两种工作模式并存

- **模板 rig 模式**（Loveit / hibana / 蛾 / AnoBando）：数百 comp、上万 layer、上万表达式；
  Slider/Checkbox/Color/Angle Control 数千枚组成 18 参数标准控制面板栈（328+213+36 次出现）；
  跨工程共享同一组 `Pseudo/*` 幽灵效果（`0e3wiwbivl`、`060uhhyz3w`、随机浮点 id 系列）——
  同一套模板/脚本套件的指纹。
- **手工精简模式**（KillKiss / Sick-）：8 个 comp、约 300 layer、表达式极少，
  效果直接堆在层上（BCC 故障系 + Deep Glow + Lumetri）。2025 年起的新作倾向此模式。

## 发现 2 — 效果词汇表（7 工程广度排序）

| 广度 | 总次数 | 效果 |
|---|---|---|
| 7/7 | 371 | **Fill** |
| 7/7 | 167 | **Lumetri Color** |
| 6/7 | 13765 | Slider Control（rig 载体） |
| 6/7 | 186 | **CC RepeTile** |
| 6/7 | 93 | **Deep Glow**（Plugin Everything） |
| 5/7 | 7247 | Transform（效果版，滚动/缩放 rig） |
| 5/7 | 4664 | **Motion Tile** |
| 5/7 | 2106 | Tint |
| 5/7 | 1228 | Glow |
| 5/7 | 960 | Shift Channels |
| 5/7 | 684/674 | Emboss / Unsharp Mask |
| 5/7 | 44 | Fractal Noise |
| 5/7 | 43/19 | BCC Prism / BCC Damaged TV |
| 4/7 | — | Exposure、Gaussian Blur、Curves、BCC Video Glitch、BCC Camera Shake、Invert、Solid Composite、Gradient Ramp |
| 3/7 | — | Optics Compensation、Displacement Map、Twirl、Compound Blur、Glitch 7in1 (AESweets)、Mosaic、Turbulent Displace、uni.Unmult、Audio Spectrum |

第三方插件真实构成：**BCC (Boris) 故障/棱镜/摄像机抖动系 + Deep Glow + AESweets Glitch 7in1 + Universe Unmult**。

## 发现 3 — 招牌效果链（同层有序栈，跨工程频次）

| 次数 | 广度 | 栈 |
|---|---|---|
| **2037** | 5/7 | **Motion Tile → Transform**（静止画MAD 核心：画面无缝平铺 + 滚动/推拉 rig） |
| 629 | 4/7 | Tint → Emboss（纹理化/做旧） |
| 614 | 2/7 | Tint → Glow → Gaussian Blur → Transform |
| 607 | 3/7 | Glow → Transform |
| 261 | 2/7 | Motion Tile → Shift Channels |
| 99/76/36 | | Motion Tile → Wave Warp / Displacement Map / Optics Compensation(→Twirl) |
| 88 | 1/7 | Curves → Fill → Transform |
| 73/50 | 2/7 | Slider → Wave Warp → Noise HLS Auto；Slider → Noise HLS Auto → Noise |
| 66 | 3/7 | Compound Blur → Shift Channels |
| 24 | 3/7 | Motion Tile → Transform → CC Scale Wipe |

开栈头部：Motion Tile(2747) / Tint(1331) / Glow(607)；收栈尾部：Transform(3418) / Emboss(629) / Shift Channels(339)。

## 发现 4 — Trapcode 是点缀，不是骨干

hibana：tc Particular ×20 + tc Shine ×6 + CC Particle World ×7；Datte：tc Form ×7；
Sick-（进行中）：tc Particular ×3；其余四部为零。粒子用于高潮段落的火花/光尘点缀，
版面主体由平铺/故障/发光/调色承担。

## 发现 5 — 素材画像 = 静止画MAD

.mp3 音乐 + .psd/.png 插画为主，实拍视频极少；Sick- 出现 **.obj**（3D 模型，与本仓库
OBJ 发射器工作线呼应）。表达式惯用法：checkbox 开关门(76) > wiggle(44) > random(31) >
marker 同步(15) > loopOut(12) > linear 映射(10)。

## 对产品的推论（按行动价值排序）

1. **原生栈 recipes 优先扩容**：真实 AMV 骨干 = Motion Tile/Transform/Tint/Glow/
   Shift Channels/Wave Warp/Fill/Curves 等原生效果组合——恰好是 LLM 最易驾驭、跨版本
   跨语言最稳的地带。招牌链表就是现成的 recipe 蓝图（无许可问题）。
2. **个人风格挖掘是可行的moat**：`aep_scan.py --chains` 已能从用户自己的工程提取签名栈
   →「把你的历史工程变成你的个人 recipe 库」是差异化卖点，且天然规避模板版权。
3. **Brownfield 感知静态可达**：无需开 AE 即可读出工程结构/效果/表达式——planner 的
   「编辑现有工程」上下文有了第一块地基。
4. Trapcode 线保持"高级点缀"定位：与调查一致（华彩段落用粒子）；recipe 库应两条腿走路。
5. 输出规格现实：交付默认 1080p（一部 4K 特例）。

## 扫描器现状与已知局限

- cdta 宽高 = 偏移 140 的 u16 对（7 工程全票验证）；fps 未解码。
- 效果计数可能含群组重复计入的系统性放大（相对量级与广度不受影响）。
- 参数**取值**未提取（tdb4/cdat 解码未做）——hibana 的 20 个真实 Particular 实例参数
  是下一个高价值目标（艺术家真实设置 → recipe 素材）。
- XMP: AE 22.x 的 CreatorTool 字段写的是 Photoshop 工具链字符串（怪但无害）；
  create/modify 日期与保存次数已按元素形式解析。

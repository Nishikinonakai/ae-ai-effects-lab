# Native-stack recipes (batch 1, 2026-07-18)

The AMV survey (`brownfield/AMV_SURVEY.md`) showed the artist's real backbone is NATIVE
effect stacks — Motion Tile→Transform alone appears 2037× across 5/7 projects. This
batch turns the survey's signature chains into 12 original, self-contained recipes:
no vendor content, no licensing burden, maximum cross-version stability (native
matchNames), and the exact vocabulary a 静止画MAD/AMV planner needs.

Every recipe builds its own stand-in artwork (Fractal Noise + Tint / Gradient Ramp)
so the stack semantics render without external footage. All 12 validated headless
2026-07-18: 158/158 params applied, full coverage, real frame-to-frame motion
(expressions verified by t1↔t4 pixel deltas of 17–100 mean-abs).

| recipe | survey stack (count) | idiom | validation |
|---|---|---|---|
| native-loop-scroll | Motion Tile→Transform (2037×) | 无缝平铺+无限滚动（Tile Center 表达式驱动，比移层稳健） | ok |
| native-tint-emboss | Tint→Emboss (629×) | 做旧纸纹 | ok |
| native-glow-pulse | Glow→Transform (607×) | 辉光+呼吸缩放 | ok |
| native-tile-wavewarp | Motion Tile→Wave Warp (99×) | 平铺+流动波浪 | ok |
| native-tile-displace | Motion Tile→Displacement family (76×) | 平铺+湍流置换 | ok |
| native-duotone-stutter | Posterize Time + wiggle | 硬双色调+8fps卡帧抖动 | ok |
| native-chroma-glitch | Motion Tile→Shift Channels (261×) | 通道对调错色+细波撕裂（需彩色基底——灰底上通道交换是恒等!） | ok |
| native-fisheye-twirl | Motion Tile→Optics Comp→Twirl (36×) | 鱼眼膨胀+旋涡 | ok |
| native-noise-flicker | Noise HLS Auto rigs (73×) | 胶片噪点闪烁 | ok |
| native-radial-sky | Gradient Ramp (4/7 projects) + FN veil | 径向天空+云霭+压边 | ok |
| native-speedlines | Directional Blur + fast tile scroll | 速度线/冲刺感 | ok |
| native-wave-banner | Wave Warp large + Glow | 绸带波浪横幅 | ok |

Authoring gotchas learned in this batch (they generalize):
- **Transform-effect Position scroll slides the content out of its own layer bounds** —
  the loop-scroll idiom must animate **Motion Tile's Tile Center** instead: tiling
  recomputes around the moving center = infinite seamless travel.
- **Channel-swap glitches need a chromatic base**: on greyscale (R=G=B) Shift Channels
  is the identity map.
- Fractal Noise overlays composite via **0029 Opacity / 0030 Blending Mode** (0018 is
  Sub Scaling, not blend).

Cards for all 15 native effects used here were introspected into
`introspect/cards/` the same night (Tile, Geometry2, Emboss, Glo2, Wave Warp,
Turbulent Displace, Fill, Shift Channels, Optics Compensation, Twirl, Noise HLS
Auto2, Compound Blur, Posterize Time, Ramp, Exposure2).

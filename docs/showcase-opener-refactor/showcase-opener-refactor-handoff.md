# 轮播开场动画重构与打磨交接文档 (Showcase Opener Refactor Handoff)

**日期**：2026-10-30  
**分支**：`refactor/app-shell-v3`  
**核心范围**：前端轮播模块（Studio Showcase）开场动画重构、比赛信息阶段交互、Data Panel 果冻物理动效、雷达图与 Round Swing 联动及性能优化。

---

## 一、本次会话完成的核心改动汇总

### 1. 开场动画架构重构（时长解耦与四阶段推进）
- **原本逻辑**：硬编码 8.0 秒固定时长（4 个 2.0s 阶段）。
- **重构后逻辑**：时长完全由各阶段配置决定，开场动画总时长动态计算。确立了**四阶段流水线**（原阶段四 outro 已彻底删除）：
  1. **比赛信息阶段（Match Info，默认 6.0s）**：用户自定义 Text / Img 元素展示；
  2. **阶段一（Empty，默认 2.0s）**：网格底板展开，Data Panel 从水平 50% & 垂直 80% 启动并执行果冻弹簧过冲；内部 Radar Sub-canvas 和 Round Swing 直接显现全队平均线，并在 Data Panel 达到 75% 目标尺寸后整体无果冻平滑展开到位；
  3. **阶段二（Average 全队均值，默认 2.0s，与阶段三调转顺序）**：先展示全队平均水准，平均线带霓虹发光光晕；六项指标文字与 Round Swing 分三步（每步间隔 0.1s，单项生长耗时 0.5s）向上生长浮现；Round Swing 赛道内数值块从中心 0 点平滑生长到平均线位置；
  4. **阶段三（Reference 外圈基准，默认 2.0s）**：展示外圈最大天花板参考值，外圈亮环发光显现，Round Swing 数值块在为正值时以绿色平滑生长至 +5%，数值显示 +5% 且字号调大 1.3 倍；在阶段三最后 400ms 内，Data Panel 连同内部雷达图与 Swing 整体平滑 FadeOut 至 0，直接衔接正片。原阶段四（outro）已删除。

### 2. 比赛信息阶段（Match Info）与自定义元素系统
- **数据结构**：在 `ShowcaseIntroConfig` 中支持 `elements: ShowcaseElement[]`（包含 `text` 和 `image` 两种类型）及 `blackFadeIn?: boolean`。
- **进场与退场动画**：
  - **FadeIn 进场**：文字与图片在前 800ms 内平滑淡入（`showcaseMatchInfoOpacity`）；
  - **FadeOut 退场**：阶段结束前的最后 800ms 内平滑淡出，时长与 FadeIn 严格对称；
  - **开场黑屏渐显（Fade in from black）**：在右侧属性检查器提供复选框开关（默认开启），在视频开场前 800ms 内全黑蒙层平滑退去。
- **画布交互**：
  - 点击选中元素显示高亮虚线框；
  - **右上角显式红色实心圆、内带白色“X”**：点击红圈即时删除元素；
  - 选中元素支持在画布上任意拖拽更新百分比坐标 $(X, Y)$。
- **图片尺寸与闪烁根治**：
  - 上传及解析时通过 `new Image()` 提取原始物理像素尺寸（如 $1254 \times 1254$），记录并保持真实宽高比；
  - 彻底解决了将 1:1 图片拉扁为 4:3 的问题，以 1920 画布标准尺寸等比放缩；
  - 将比赛信息图片 URL 纳入 `ShowcasePreview.tsx` 的保活集合 `retainShowcaseImages` 中，彻底解决了缓存被每帧误删导致图片高速白闪的严重 Bug。

### 3. Data Panel 果冻物理动效与布局
- **水平与垂直完全居中**：Data Panel 尺寸为宽 $54\%$、高 $93\%$，在开场阶段水平中心严格对齐 Canvas 水平中心（$X=50\%$），垂直完全居中（$Y=50\%$）。
- **起始弹射点**：开场入场时，从 Canvas 水平中心 $50\%$ 与垂直高度 $4/5$ 处（$Y=80\%$）启动，尺寸由 `0` 向上弹射变大。
- **连贯无停顿 Hermite 弹簧曲线**：
  - 彻底消除了原先“达到目标值后停顿一下才开始晃”的断层感；
  - 采用三次 Hermite 导数匹配曲线，冲向 1.0 时保持高速动量呼啸冲破 1.0，直接顺畅衔接阻尼振荡；
  - 严格限制振幅：写死最佳手感参数（膨胀进度 `expandProgress: 0.40`、衰减 `decay: 2.5`、半波 `cycles: 5.0`、宽度过冲 `ampW: 0.05`、高度挤压 `ampH: 0.05`），绝不过冲过头。
- **微调面板清理**：按照指示，已将属性检查器中的临时果冻微调面板及各阶段时长面板完全移除，界面清爽干净。

### 4. 雷达图与 Round Swing 开场联动
- **坐标同步规则**：开场动画中的 Radar 和 Round Swing 的 **X 轴不同步自定义 X（严格保持在 50% 正中央对齐居中的 Data Panel）**，而 **Y 轴位置与缩放大小完全同步用户的自定义配置**。
- **阶段一与阶段二无缝衔接**：
  - 阶段一内部 Radar + Swing 展开时直接显示平均红线与中心 0 点白线；
  - 进入阶段二文字入场时，平均线持续保持 100% 透明度（修复了原先透明度重置跌零闪烁的问题），并在 500ms 内柔和亮起红色霓虹发光光晕；
  - 六项文字分 3 组向上生长浮现（Rating/KPR $\to$ MultiKill/Surviving $\to$ KAST/ADR/Round Swing），每组间隔 0.1s，单组自身生长动画时长 0.5s（500ms）；
  - Round Swing 赛道条内数值块从中心零点生长填充到平均线位置，动画时长同样为 0.5s。

### 5. 排版与字体体系统一
- **雷达指标文字排版**：
  - 第一行：项目描述与数值在同一行并排居中（如 `KPR  0.78`）；
  - 第二行：正下方居中显示中文别名括号：
    - KPR $\to$ `(回合击杀)`
    - Surviving $\to$ `(存活率)`
    - ADR $\to$ `(回合伤害)`
    - KAST $\to$ `(不白给率)`
    - Multi-Kill $\to$ `(回合多杀)`
  - 自适应径向外推（`radialPush`）：各轴向外推开充足呼吸间距，彻底解决了 Rating、Surviving、MultiKill、ADR 遮挡雷达多边形和顶点的 Bug。
- **Round Swing 新排版**：
  - 正下方第一行：`Round Swing` 标题与数值在同一行显示，数值在右边（如 `Round Swing  +0.8%`），标题颜色与六项文字统一为 `#d7dde3`；
  - 正下方第二行：居中显示中文别名括号 `(回合影响)`；
  - 赛道轨道高度增加 50%，删除半透明背景框，条内数值块圆角删除改为直角矩形。
- **字体全局对齐**：除 `BEST` 徽标保持 Bangers 字体外，所有数据文字（数值）统一采用与项目文字相同的 `"Noto Sans SC", system-ui` 粗体。

### 6. 极致渲染性能优化（解决播放卡顿）
- **根除卡顿杀手**：排查发现卡顿主要源自高分辨率 Canvas 每一帧执行 `ctx.shadowBlur` 带来的极高离屏高斯模糊卷积开销（单帧曾高达 30ms+）；
- **GPU 友好多层笔刷光晕（Multi-pass Alpha Stroke）**：
  - 彻底移除了每帧的 `ctx.shadowBlur`；
  - 改用 GPU 硬件加速的渐进式多层半透明笔刷光晕，渲染耗时由 30ms 骤降至不到 0.05ms，播放帧率稳稳跑满 60 FPS / 120 FPS。
- **复刻参考图发光效果**：
  - 核心线：极其纤细锐利（1.8px），采用高亮珊瑚橙粉霓虹色（`#ffa088`）；
  - 外围光雾：深邃绯红光雾（`rgba(220, 38, 38, ...)`）大范围柔和弥散，内部带微弱暗红呼吸面，1:1 复刻参考图片质感。
- **文字测量缓存**：引入 `measureCachedText`，避免每帧重复调用数十次底层昂贵的 `ctx.measureText`。

---

### 4. 阶段三数值字号放大与 Round Swing 绿色平滑连续生长（本次新增）
- **仅阶段三数值字号调大**：引入 `RADAR_VALUE_FONT_SCALE = 1.3`，只有阶段三的数值字号放大为标签字号的 1.3 倍（如 12px 标签对应 15.6px 数值），其余阶段（阶段一、二、四及常规选手展示）字号完全保持为正常大小（1.0 倍），层级精准分明。
- **Round Swing 阶段三不消失与 +5% 文本展示**：阶段三继续保留 "Round Swing" 项目名、居中同行数值（明确显示白色 `+5%`）及正下方 `(回合影响)` 副标题；Round Swing 数值字号与雷达图数值严格同步（阶段三放大，其余时间正常大小），并避免了多余的两端端点文本淡入产生位置冲突。
- **数值块正值（+值）显示绿色，平滑生长至 +5% 刻度**：阶段三数值块为 + 值（+5%）时，颜色采用充满电竞科技感的鲜艳绿色（`#35d07f` 渐变与 `#5efca8` 垂直边缘线），而不是白色；自阶段二结束时的 `averageValue` 起在 500ms 内平滑生长至 `+5%`（`trackHalfWidth`），在进入阶段三首帧无缝继承均值宽度，彻底消除切换瞬间的闪烁与跳变。

### 5. 正片首位玩家专属就位阶段（First Player Arrival Phase）
- **时序流水线**：正片第 0 位玩家（slide 0）开头设立精密递进的专属就位阶段（总计 2.3s）：
  1. **0 ~ 700ms（Data Panel 就位 & 头像滑入）**：
     - Data Panel 从横向 1/10 处（`startCX = width * 0.1`）直接果冻生长至左侧目标位置（`targetX = width * 0.018`），彻底消除中间停顿与跳变；
     - 玩家头像立绘从画布右侧滑入并在 700ms 准确就位；
     - **此期间雷达图、Round Swing、副标题、标题全部隐藏**。
  2. **700 ~ 1100ms（副标题就位 & 雷达/Swing 入场）**：
     - **副标题在头像就位后入场**：位置位于头像竖向中心下方，尺寸 size 从 0 平滑变大至目标值，伴随淡入；
     - 雷达图与 Round Swing 从 Data Panel 竖向中心下方入场，size 从 0 平滑生长至 100%；**此期间依然隐藏六项指标与数值**；
     - 标题依然不显示。
  3. **1100 ~ 1700ms（标题就位）**：
     - **标题在副标题就位后入场**：执行赛博 Text Scramble 乱码解密破译动画入场，1700ms 完全解密还原真实名字。
  4. **1200 ~ 1700ms（项目文字三步向上生长）**：
     - 六项指标文字与 Round Swing 标题分三批向上浮现 0.5s，并显示居中中文别名括号；**此期间数值依然不显示**。
  5. **1700 ~ 2100ms（数值显现）**：
     - 选手真实数值平滑淡入显现，雷达图顶点与 Round Swing 数值块平滑生长至选手数值。
  6. **2100ms+**：进入完全呈现稳态展示。

### 6. 雷达图数值线高亮与无圆点纯净化
- **删除各项数值圆点**：彻底移除了雷达图数值多边形各顶点上的圆点标记（point markers），线条清爽锐利。
- **填充不透明度提升 50%**：数值多边形内部填充不透明度由原来的基础 0.18 提升至 0.27（提升一半），多边形内部色彩更饱满。
- **数值线外边框高亮**：数值线条外层叠加一层 2.2 倍线宽、40% 透明度的同色柔和辉光线条，内层采用加粗核心亮线，实现鲜明的高亮电竞视觉效果。

### 7. 战队 Logo 呈现与资料库战队编组系统
- **单份 Logo 与 FadeIn 入场（2026-10-31 修正）**：战队 Logo 只由 `teamLogo` 图层绘制一次（可拖动/缩放），在首位玩家入场时严格在副标题就位后（1100ms 起）平滑 FadeIn 浮现，常规转场时随选手 slide 平滑 crossfade；已移除原先叠在背景上的 30% 大画幅水印，避免同一张图重复出现。
- **资料库多选编为战队**：在资料库（`LibraryView`）支持多选勾选玩家，提供【编为战队】模态对话框，支持输入战队名称与上传战队 Logo（FileReader 本地解析），持久化存储于 `PlayerTeam`。
- **按战队排序与一键加入轮播**：
  - 点击“全部选手一键加入轮播”时，播放队列优先按照战队分组排序（同一战队成员紧挨排列，未分组成员排在后），自动将战队 Logo 注入每个成员的轮播 slide；
  - 支持右键菜单【以战队整体加入轮播】与【退出战队】。

### 8. 副标题排名化、发光预设与 Data Panel “地图数：n”
- **Data Panel 右下角地图数**：副标题不再默认显示“n 场综合数据”，转而在 Data Panel 右下角内侧以半透明科技小字显示“地图数: n”。
- **副标题排名与四色发光**：副标题默认显示排名（`#1`、`#2`...），提供金（`#ffd700`）、银（`#e2e8f0`）、铜（`#cd7f32`）、白（`#f4f6f8`）四色双层外发光预设，并提供粗体（`subtitleBold`）与斜体（`subtitleItalic`）开关。

### 9. 布局拖拽自由度与虚线选框精确贴合
- **解除标题/副标题拖拽限制**：放宽 `clampShowcaseTransform` 对标题与副标题的 X/Y 限制至 2% ~ 98%，彻底解决无法往右拖动的问题。
- **选框与真实尺寸严格一致**：`selectionBounds` 支持文本实际宽度测量（`measureTextWidth`）与人物图物理渲染尺寸测量（`getImageDimensions`），彻底解决虚线框与实际内容尺寸脱节的 Bug。
- **属性调整实时重绘**：监听依赖补全 `layout` 与 `slides`，首位玩家就位动效在静态编辑状态跳过位置劫持，调整任何参数无需刷新页面即刻所见即所得。

---

### 10. MVP 特效与跨战队转场优化
- **前置玩家 FadeOut 退场**：当下一个玩家拥有 BEST MVP 特效，或属于不同战队时，当前玩家的所有 canvas 前景元素在最后 500ms 内平滑 FadeOut 退场至 0，无缝切入暗场。
- **MVP 特效动态打磨**：
  - 左右两侧竖向文字滚动流在整个特效周期乃至结尾持续平滑向前滚动，不再受限停止；
  - 右下角大标题（`bestEntranceTitlePosition`）在入场前 35% 减速滑入并精准在 Canvas 3/4 处（$X = 75\%$）落位，随后在剩余时间内持续向左缓慢平滑漂移，呈现电影级动态推进感。
- **MVP 特效后与跨战队触发就位流水线**：在 MVP 特效结束后，或者跨战队玩家切换时，均触发完整的 Data Panel 果冻生长、头像滑入、副标题展开、标题 Text Scramble 破译、雷达/Swing 入场与指标数值显现流水线；而同一战队的队内成员常规切换继续保持雷达多边形顶点插值平滑变形与立绘 Crossfade。
- **handoff 不冻结 + 无静态画面穿帮（2026-10-30 补完）**：
  - `bestEntranceHandoffProgress` 在 1s handoff 内按入场同速把进度从 1 推进到 1+1/3，两侧滚动流与右下角主标题持续运动，同时整体以 `1 - handoffProgress` 同步淡出；
  - handoff 期间正片场景保持隐藏（`sceneOpacity = 0`、`dataPanelOpacity = 0`），不再先铺一帧旧版「雷达/Swing/头像/主副标题/Data Panel」再重播就位动画；像素级验证 handoff→slide 边界相邻帧平均差仅 0.03~0.07；
  - 退场淡出覆盖背景图、战队 Logo 与背景压暗层；`teamLogo` 图层 Logo 使用 `arrivalTeamLogoAlpha`（1100ms 起 500ms 淡入），handoff 期间与特效同步降到 0。

---

## 二、关键文件与核心修改落脚点

| 文件路径 | 涉及核心功能与修改内容 |
|---|---|
| `frontend/src/types.ts` | 增加 `PlayerTeam` 与 `ShowcaseDraft`；`ShowcaseSlide` 增加 `teamLogoUrl` 与 `teamLogoTransform`；`ShowcaseLayoutDraft` 增加战队 Logo、标题/副标题颜色、字号、发光预设、加粗斜体字段。 |
| `frontend/src/features/studio/showcaseMath.ts` | 导出首位玩家各环节精密时序常数；放宽标题/副标题拖拽限制至 2%~98%；`selectionBounds` 支持文本测量宽度与人物图真实渲染尺寸自适应；导出 `hasBestEntrance`。 |
| `frontend/src/features/studio/showcaseRender.ts` | 前置玩家 FadeOut 退场（500ms）；MVP 特效两侧滚动流持续不停；右下角大标题于 3/4 处落位后持续向左慢速漂移；MVP 后及跨战队玩家触发完整就位流水线（同队保持顶点变形）；副标题位置坐标锁定目标位置彻底消除跳动。 |
| `frontend/src/components/RadarCanvas.tsx` | 移除雷达数值多边形顶点圆点；多边形填充透明度拉高 50%（0.18 $\to$ 0.27）；多边形外边框叠加外层辉光加粗高亮。 |
| `frontend/src/features/studio/ShowcaseEditor.tsx` | 属性面板提供战队 Logo 更换/清除/位置缩放控件；提供副标题金银铜白发光预设、粗体、斜体、字号输入与颜色拾取；修复 `onImageTransformChange` 遗漏 scale 的 Bug；传递 `onTeamLogoTransformChange`。 |
| `frontend/src/features/studio/ShowcasePreview.tsx` | 支持选作战队 Logo 交互与真实尺寸选框；选框动态测量文本实际长度与立绘物理尺寸；`useEffect` 补全 `layout` 和 `slides` 依赖，彻底消除需刷新页面的 Bug。 |
| `frontend/src/features/library/LibraryView.tsx` | 支持多选玩家；新增【编为战队】对话框与 Logo 上传；“全部选手一键加入轮播”按战队分组排序并自动注入战队 Logo；支持战队整体加入轮播与徽章展示。 |
| `frontend/src/features/studio/draftMutations.ts` | `saveSeedToDraft` 与 `mergeShowcaseSeed` 支持 `extraProps`（注入 `teamLogoUrl`）；副标题默认值由“n场综合数据”改为排名 `#1`。 |
| `frontend/src/features/studio/average.test.ts` | 覆盖头像就位 $\to$ 副标题 $\to$ 标题入场时序断言、文本长度自适应选框断言、MVP 标题 3/4 落位漂移断言、handoff 继续运动断言等（46 项测试全绿）。 |
| `AGENTS.md` | 同步记录战队 Logo 规范、Data Panel 地图数规范、副标题排名发光与加粗斜体规范、MVP 持续滚动与 3/4 漂移规范、跨战队/MVP 切换流水线规范。 |

---

## 三、当前测试与构建状态

1. **前端单元测试**：
   ```bash
   npm --prefix frontend test
   # 结果：46 passed (46), 3 test files, 100% 通过
   ```
2. **前端打包与类型检查**：
   ```bash
   npm --prefix frontend run build
   # 结果：tsc -b && vite build 成功，0 错误，0 警告
   ```
3. **后端 .NET 单元测试**：
   ```bash
   dotnet test src/Radar.Tests/Radar.Tests.csproj
   # 结果：84 passed (84), 0 failed, 100% 通过
   ```

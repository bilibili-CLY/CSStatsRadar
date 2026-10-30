# Bilibili 视频动效拆解与复现方案

> 视频：[【EPL S24 数据雷达图】蜜蜂重回巅峰！世界线被重置回去了吗](https://www.bilibili.com/video/BV1W3pd6XEPd/)（约 6:07）。
>
> 这是基于浏览器中可播放的视频，在 00:04、00:14、00:21、00:52、00:57–00:59、01:29、02:29、03:28、04:27、04:55、05:28、06:02 等位置抽查得到的初版。时间是播放器显示时间，转场边界按抽帧估算，精度约 ±1–2 秒；未逐帧测量。弹幕是 B 站播放层叠加内容，不计作原片包装动画。

## 1. 视频概览与整体动效风格

这支视频以 CS 电竞选手数据展示为主体，主画面大多是固定的 16:9 版式：左侧深色数据面板、六轴雷达图及 Round Swing 条，右侧队伍主题背景、选手抠像、姓名和名次。多边形数据面板在选手之间切换；约 04:27 出现一次不同于常规卡片的全屏选手特写，随后回到数据卡片。开头和结尾有黑底文字/鸣谢类画面。

整体风格偏赛事包装：背景暗、绿色/队伍主题光效、选手抠像和大字号斜体名次建立视觉重心；图表使用高亮外环、半透明填充雷达面和短线性量尺。元素数量较多，动效主要服务于选手轮换和数据读数，适合用时间轴驱动的 Canvas 合成，而非把整段做成 DOM 属性动画。

**观测边界：**浏览器抽帧可以确认版式、若干状态和一处明显叠化；不能据此断言确切帧率、缓动曲线、图表每轴的精确起始值、静帧是否由视频剪辑造成，或每次转场都完全相同。以下以“观察”与“复现建议/假设”区分。

## 2. 技术栈假设与依赖

项目当前前端为 React 19、TypeScript 5.7、Vite 6；未发现 GSAP、Framer Motion、Lottie 或 Three.js 依赖。项目已有 Canvas 雷达组件、共享 Showcase renderer、动画时间轴/插值工具和 OffscreenCanvas Worker 导出路径：`frontend/src/features/studio/showcaseRender.ts`、`showcaseMath.ts`、`showcaseExportWorker.ts`。

因此首选在现有 Canvas 渲染与时间轴上复现，继续复用同一 renderer 供预览和导出。CSS 负责编辑器控件、卡片外框等 DOM UI；SVG 可用于静态装饰图标；视频素材只用于原始选手背景或剪影素材，不建议用整段视频覆盖交互式数据图。无需为了这组效果增加动画依赖。

项目已有的八秒片头、BEST 入口和常规选手切换属于产品自身动效规则，并非本视频必然存在的内容。若本方案进入产品实现，沿用项目现有时间轴和规则，不要把视频中的黑场/鸣谢段误作雷达片头。

## 3. 时间轴动效拆解表

| 时间戳（约） | 效果描述 / 观察 | 关键参数（观察与建议） | 推荐实现 / 优先级 |
|---|---|---|---|
| 00:00–00:05 | 黑底短开场/过渡；抽帧可见画面大面积黑色及局部文字。具体内容与是否有淡入待确认。 | 黑场占主导；建议 0.3–0.6s 亮度/透明度进入，具体时长待原帧确认。 | Canvas 背景层或视频片头素材；低；低风险。 |
| 00:05–00:18 | 鸣谢/用户名等多列文字占据画面，背景较暗；画面从黑场进入文字页。是否持续纵向滚动及滚动速度无法由抽帧准确确认。 | 若复现滚屏：每秒 30–60px 起调，匀速；文字淡入约 0.3s；片段时长约 10s。均为假设。 | Canvas 文字层或 CSS transform；中；长文本需裁切并控制字距/行高。 |
| 00:18–00:22 | 从文字/鸣谢画面切入选手数据卡；约 00:21 已出现常规布局和选手图。确切切换边界待确认。 | 建议 0.5–0.9s 叠化；卡片背景、选手抠像、标题和图表分层。 | Canvas 分层合成；高；以浏览器抽帧估时。 |
| 00:22–00:57 | 常规选手卡片持续展示：六轴统计围绕雷达图排布，右侧人像、昵称、排名；Round Swing 指示条位于下方。52 秒样帧可见完整数值状态。 | 16:9；图表外环固定；填充面约 0.2–0.4 不透明度为建议值；外环轻微辉光；静态展示时间由剪辑决定。 | Canvas 雷达/文字/条形图，背景图与人像分层；最高优先级；图表数值映射/标签避让是主要风险。 |
| 00:57–01:00 | 约 00:57 新选手画面已出现；00:58 可见前后选手内容短暂叠化；约 00:59 雷达/标签显著变淡，之后进入新卡片。抽帧不足以判断这是原片剪辑叠化还是雷达动画的一部分。 | 可见叠化区间约 1–2s（估算）；复现建议人像、背景、姓名跨淡 0.6–0.9s；六轴顶点使用 0.7–1.0s ease-in-out 插值；雷达边界持续可见。 | Canvas 时间轴；最高优先级；渲染预览/导出必须共用进度函数。 |
| 01:00–04:26 | 同一数据卡模板连续轮换选手。抽查 01:29、02:29、03:28 均为常规布局；人像、队伍色背景、标题、名次和数据值随选手变化。 | 假设每位选手保持数秒到数十秒；单次切换参数沿用上段建议。当前抽帧不能确定每位停留时长或每次是否都使用相同转场。 | 数据驱动的 `ShowcaseSlide[]` + 统一 transition；高；保证长昵称/名次及异常值可见。 |
| 04:27–04:55 | 从常规卡切到全屏人物强调页：大幅人物照片居中偏左；左右边缘有竖排描边文字，姓名/昵称以斜体大字靠近下方。约 04:55 已回到常规数据卡。此段具体文字循环方式和进出转场待确认。 | 约 28s 区间；切入/切出时长建议 0.5–0.8s；左右装饰文字可以静止或缓慢位移（≤20px/s，属于复现假设）；人像 1.0–1.08 倍轻微放大仅作建议。 | 独立 `SpotlightScene` Canvas 场景；中优先级；保留安全区，避免边缘文字被裁。 |
| 04:55–05:52 | 常规数据卡继续；抽查 04:55、05:28，图表、选手人像、名次和 Swing 数值均可见。 | 同 00:22–00:57；内容驱动，无交互触发证据。 | 复用常规卡片 renderer；高；不复制维护第二套图表绘制代码。 |
| 05:52–06:07 | 片尾黑底文字/鸣谢类画面；06:02 已见大面积黑底和评论文字。06:06 附近可见署名页。中间精确切换时间待确认。 | 预计淡出/黑场约 0.3–0.8s，属估计；文本持续时间以最终成片为准。 | 使用片尾 scene/视频片尾素材；低；动态内容和署名需人工核对。 |

## 4. 关键动画实现方案

### 4.1 常规雷达数据变化

六轴不是需要独立六次重播的动画：把相邻选手的六个原始数值作为起终态，在同一时间参数下逐轴线性插值，再由项目的雷达映射函数转换为顶点。对采样画面而言，图表读数在选手变化时更新；连续 morph 是与视频观感匹配、也符合项目架构的实现方案。

```ts
type Metrics = [number, number, number, number, number, number];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (t: number) => t * t * (3 - 2 * t);

function mixMetrics(from: Metrics, to: Metrics, elapsedMs: number, durationMs = 850): Metrics {
  const t = easeInOut(clamp01(elapsedMs / durationMs));
  return from.map((value, i) => value + (to[i] - value) * t) as Metrics;
}

// 每帧：使用项目现有 valueToRadarPoints() 与绘制函数。
function drawTransition(ctx: CanvasRenderingContext2D, elapsedMs: number) {
  const values = mixMetrics(previousMetrics, nextMetrics, elapsedMs);
  drawPersistentRings(ctx);        // 基准外环持续可见
  drawRadarPolygon(ctx, values);    // 多边形顶点直接从前一选手过渡到下一选手
  drawMetricLabels(ctx, values);    // 数值文本可同步插值或按策略切换
}
```

建议先沿用 `showcaseMath.ts` 的插值/segment 逻辑，避免再造一套 RAF 时间系统。时间值应来自播放时间轴而非墙钟，这样拖动预览、逐帧导出和 Worker 渲染得到同一帧。

### 4.2 人像、背景与文字跨淡

抽帧可见切换时前后画面短暂叠加。推荐只对选手图、队伍背景和主标题层做互补透明度跨淡；雷达外环保持持久，雷达面按上一节 morph。图表数值可以在 morph 时同步递增，避免旧多边形与新数值错配。

```ts
function drawCrossfade(ctx: CanvasRenderingContext2D, t: number) {
  const p = easeInOut(clamp01(t));
  drawPlayerBackground(ctx, previousSlide, 1 - p);
  drawPlayerBackground(ctx, nextSlide, p);
  drawPortrait(ctx, previousSlide, 1 - p);
  drawPortrait(ctx, nextSlide, p);
  drawPlayerTitle(ctx, nextSlide, p); // 标题进场；必要时旧标题按 1-p 淡出
  // 不把整个画布/雷达组的 alpha 乘以 p。
}
```

### 4.3 Round Swing 指示条

图中 Swing 是围绕中线向左/右扩展的水平条。红、绿代表两种方向，建议固定中线并从中线向目标端绘制，让条长按 `abs(value)` 变化。项目已有 ±5% 参照与外溢安全区规则，实施时直接调用对应 renderer 和几何工具，不要把条宽等同于雷达子画布宽度。

```ts
function drawSwing(ctx: CanvasRenderingContext2D, centerX: number, y: number,
                   value: number, halfSpanPx: number, trackHeight: number) {
  const ratio = Math.abs(value) / 5; // 不做固定 1.0 上限；越界按组合的安全边界外溢
  const width = ratio * halfSpanPx;
  ctx.fillStyle = value >= 0 ? "#54e47d" : "#ff4f59";
  ctx.fillRect(value >= 0 ? centerX : centerX - width,
               y - trackHeight / 2, width, trackHeight);
}
```

示例中 `5` 的单位是百分比值，须按实际存储格式换算。负值条从中点向左延伸，正值向右；±5% 基准跨度以及超界展示优先复用项目的 `showcaseSwingReferenceHalfWidth` / overflow 辅助逻辑，并只在组合的自然安全边界约束可见范围。项目要求 Swing 轨道高度为原高度的 225%，实际实现也应沿用对应 renderer 的几何定义。

### 4.4 全屏选手强调场景

04:27 抽帧观察到人物大图和竖排描边姓名，不足以确认是否有缩放/粒子/旋转。按静态构图加轻量叠化复现，人物使用 `cover` 裁切；两侧竖排描边名字受安全边界约束。若补充关键帧后确认文字移动，再把位移作为 scene 参数加入，不先添加粒子或 3D。

```ts
type SpotlightParams = {
  imageScale: number;       // 建议 1.0 → 1.04
  sideTextOffsetPx: number; // 未确认时保持 0
  alpha: number;
};

function drawSpotlight(ctx: CanvasRenderingContext2D, p: SpotlightParams) {
  ctx.save();
  ctx.globalAlpha = p.alpha;
  drawCoverPortrait(ctx, spotlightImage, p.imageScale);
  drawVerticalOutlinedName(ctx, leftName, "left", p.sideTextOffsetPx);
  drawVerticalOutlinedName(ctx, rightName, "right", -p.sideTextOffsetPx);
  drawItalicPlayerName(ctx, playerName);
  ctx.restore();
}
```

## 5. 关键转场实现方案

1. **片头/文字页 → 数据卡：**用统一的 0.5–0.9s 进场段控制背景层和数据层，数据值从中心参考值或项目设定基线过渡到首名选手。视频具体采用何种曲线/遮罩待确认，不建议复刻未经观察的推拉/旋转。
2. **普通选手 → 普通选手：**建议 0.7–1.0s。底图、人像、昵称/名次跨淡；六轴顶点直接从旧值 morph 到新值；Round Swing 从旧值过渡到新值。持久外环不消失。用一个 `progress` 同步 Canvas preview 和 worker export。
3. **普通卡 → 全屏人物强调：**以 0.5–0.8s 将卡片内容与 spotlight scene 交叉淡化；具体是否有缩放/遮罩待确认。优先保证抠像与边缘文字完整，不用整画布缩放来替代转场。
4. **强调页 → 普通卡：**镜像交叉淡化，建议 0.5–0.8s；新卡的六轴从前一常规选手的值直接转到当前选手，或若是片段独立场景则按业务设定起始值。该视频时间线上对应的前后选手和数据状态需确认。
5. **片尾：**逐渐降低画面亮度/淡至黑底，再显示署名文字。具体顺序/时长以片尾素材核对。

## 6. 可复用组件、工具函数与参数建议

- `PlayerSceneRenderer`：背景、头像/抠像、姓名、名次、队伍主题的分层绘制。
- `RadarMetricsLayer`：六轴数值、标签、雷达多边形、外环与异常值安全布局。
- `SwingTrackLayer`：中线、方向颜色、端点与 ±5% 参照跨度。
- `SpotlightScene`：全屏人物照、描边竖排装饰名、主姓名。
- `CreditsScene`：片头/片尾文字；片头鸣谢是否要滚动由用户确认后配置速度。
- `crossfadeProgress(startMs, durationMs, timeMs)` 与 `interpolateMetrics(a, b, progress)`：纯函数且可由 Canvas、预览和导出共用。

```ts
const motionDefaults = {
  playerTransitionMs: 850,
  spotlightTransitionMs: 650,
  creditsFadeMs: 450,
  spotlightImageScaleFrom: 1,
  spotlightImageScaleTo: 1.04, // 复现假设；可设为 1 禁用
  easing: "easeInOut",        // Canvas 中用同一纯函数，不依赖 CSS 名称
} as const;
```

以上是分析文档中的建议默认值，不声称是原片精确参数。项目样式的 DOM 交互仍沿用仓库规定的 CSS token 和 reduced-motion 行为；导出时间轴则由统一的毫秒时间函数驱动。

## 7. 性能、兼容性与降级方案

- Canvas 每帧只重绘必要图层；预加载并缓存背景、人像和字体，避免转场中同步解码或重复 `measureText`。
- 尽量只对 opacity/transform 做 DOM UI 动画。数据雷达、Swing 与精确文字排布留在现有 Canvas renderer；导出沿用已有 OffscreenCanvas Worker，不能调用 `document.*`。
- 同步预览和导出：动画状态由 `timeMs` 纯函数产生，禁止在两个 renderer 中分别用独立 `setTimeout`/CSS timing。
- 图片加载失败时用队伍色渐变和首字母占位；字体失败时回退系统无衬线；Worker/OffscreenCanvas 不可用时使用项目已有主线程导出路径。
- 低端设备降低背景模糊、辉光和装饰层重绘频率；不降低雷达数值精度/标签可读性。遵循 `prefers-reduced-motion` 与应用 `reduce_motion`，将转场缩短至最小或立即完成，但仍更新到正确终态。
- 不建议引入 WebGL/3D/粒子：当前抽帧没有足够证据表明它们是核心效果，额外复杂度会增加导出一致性和显存风险。

## 8. 待确认问题

1. 片头 00:00–00:18 的黑场、鸣谢文字出现顺序、是否纵向滚动及具体速度。
2. 普通选手切换的精确起止帧、是否每次都交叉淡化，以及雷达图真实的逐轴插值/短暂清空表现。
3. 04:27–04:55 全屏选手强调页的准确首尾时间、竖排姓名是否连续移动、是否有缩放或遮罩。
4. 05:52 之后的片尾字幕、署名页完整时长及进入方式。
5. 若追求视觉逐帧还原，请提供以上区间的关键帧截图或本地录屏（含时间码）；目前参数值是可调复现建议，不是从视频文件逐帧测得的精确数据。

## 9. 复现验收清单

- [ ] 画布始终保持 16:9，缩放只 letterbox，不拉伸。
- [ ] 普通选手切换时，旧/新人像、背景与标题产生平滑跨淡。
- [ ] 雷达六轴由前一选手对应指标直接 morph 到下一选手；外环保持可见，异常值和标签不被裁切。
- [ ] Swing 中线、正负方向、红绿语义和 ±5% 参照跨度正确，端点文本可见。
- [ ] 全屏选手强调页的肖像、侧边竖排名和底部姓名均不出安全边界。
- [ ] 拖动播放头、正常预览和导出同一时间点时，画面状态一致。
- [ ] 缺失图片/字体、Worker 不可用和 reduced-motion 下有可用降级。
- [ ] 所有未确认的滚动、缩放、遮罩等效果均先经关键帧核验，不把建议参数当作视频事实。

# 10 · 性能报告

> 测量环境：本机 Playwright 1.60 / Chromium headless，1440×900 与 390×844，
> 打生产站 `app.lokfeel.com`。**不是实验室 Lighthouse 的理想网络曲线**，
> 因此下面同时给出"多次采样"和"波动范围"—— 单次数字在这条链路上没有意义。

## 一、结果

| 页面 | 视口 | LCP | 预算 | 判定 | CLS | TTFB |
|---|---|---|---|---|---|---|
| `/`（落地页） | 1440×900 | 2292ms（同会话） / 2672ms（全量终跑） | ≤2500 | **PASS（暖）· ABOVE BUDGET（终跑，超 172ms）** | 0.000 | 4–5ms |
| `/`（落地页） | 1440×900 | 2912 / 3656 / 4308 → 中位 **3656ms**（三次冷上下文） | ≤2500 | **ABOVE BUDGET（冷启动）** | 0.000 | 4ms |
| `/`（落地页） | 390×844 | 176ms（暖） | ≤2500 | **PASS** | 0.001 | 5ms |
| `/workspace` | 1440×900 | 1072–1328ms | ≤2500 | **PASS** | 0.000 | 564–610ms |
| `/workspace` | 390×844 | 1208ms | ≤2500 | **PASS** | 0.001 | 674ms |
| `/console` | 1440×900 | 620–1204ms | ≤2500 | **PASS** | 0.000 | 526–1096ms |
| `/console` | 390×844 | 1064ms | ≤2500 | **PASS** | 0.001 | 620ms |

**结论：工作台两页（真正的主产品）稳在 0.6–1.2s；落地页冷启动仍在 3–4s 区间**，
原因是首屏主图（65KB WebP，此前 228KB PNG）在这条测量链路上要 ~2s 才能传输+解码完成，
而 HTML 的 TTFB 只有 4ms —— 瓶颈在**资产传输**，不在渲染。

## 二、已经做掉的两件事（都有前后对照）

### 1. rAF 装饰动画推迟启动

| 条件 | LCP |
|---|---|
| 原实现（rAF 从挂载起持续跑） | **7008ms** |
| `reducedMotion: reduce`（代码早退，不起 rAF） | 4476ms |
| 改后（idle 后才启动漂浮） | **4280ms → 后续采样 2292–3656ms** |

差异的根因不是"动画慢"，而是**每帧都在改写 preserve-3d 子树里芯片的 transform，
而 LCP 元素（主平面截图）就在同一子树内** → 每帧重绘把 LCP 的最终绘制往后推。

### 2. 主图从 PNG 换 WebP

| 资源 | 大小 |
|---|---|
| `showcase/studio.png` | 228KB |
| `showcase/studio.webp` | **65KB**（−71%） |

同时 `unoptimized`：228KB 的 PNG 再经 `/_next/image` 动态转码，冷启动反而更慢。

## 三、CLS

全部采样 ≤ **0.003**（预算 0.1）。落地页与工作台都没有可感知的布局抖动 ——
这点值得强调：`prefers-reduced-motion` 与延后动画没有引入任何位移。

## 四、横向溢出（响应式）

13 屏 × 桌面/移动 **26 个组合，全部 `overflow = 0`**（终跑复核：0/26）：

```
mobile 390×844   ws×6  + console×7   溢出 0
desktop 1440×900 ws×6  + console×7   溢出 0
```

## 五、INP 与"真实用户数据"

- **INP：UNKNOWN**。实验室测不出 INP（需要真实交互的用户样本）。不拿 TBT 冒充。
- **CrUX / RUM：无**。站点未接真实用户监控；CF Web Analytics 只看访问量，不给 Core Web Vitals。
  下一步建议接 `web-vitals` 上报（`onLCP/onINP/onCLS` → 自建端点），否则"上线后是否达标"永远只能靠实验室推断。

## 六、下一步（按性价比排序）

| 优先 | 动作 | 预期 |
|---|---|---|
| 1 | 落地页首屏图再从 65KB 压到 ~40KB（AVIF，或按视口出两档尺寸） | 冷启动 LCP −0.3~0.6s |
| 2 | 给主图加 `<link rel="preload">`（`priority` 已生成 preload，需确认未被 CSP/顺序打断） | 早 100–300ms 开始下载 |
| 3 | 接 `web-vitals` 上报，拿到真实 P75 | 从"猜"变成"知道" |
| 4 | 工作台首屏的租户端点并行化（现在 proposals/jobs/outcomes 分三路） | `/workspace` LCP 已 1.0s，收益有限 |

## 七、复跑

```bash
npm run audit:release                        # 全量：13 屏 × 2 视口 + 6 次 perf + reduced-motion
node scripts/qa/v16-release-audit.mjs --only=mobile
node .lcp-3x.mjs                             # 三次冷上下文取中位（临时脚本，未入库）
```

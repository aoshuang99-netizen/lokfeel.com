# 12 · 端到端与门禁证据

> 纪律：**「测试文件存在」不算通过**。下表每一行都必须能给出"跑了什么命令、输出是什么"。
> 本轮的判据一律是生产站（`app.lokfeel.com`）或本地可复算的纯函数，不用 mock 代替。

## 一、本轮实际跑过的命令

| # | 命令 | 覆盖 | 结果 |
|---|---|---|---|
| 1 | `npm run verify:brand-scan` | 19 个公开路由文件 × 禁词表 | **PASS** 0 命中（含 `--self-test` 自证：注入旧文案会判红） |
| 2 | `npm run verify:contrast` | 5 个调色板块 × 15 组令牌 = 75 组 WCAG 比值 | **PASS** 全达标（首跑抓出 3 个不达标令牌，已修） |
| 3 | `npm run audit:ux13` | 13 屏 × 桌面/移动：HTTP、标题、H1、按钮、console error、失败请求、截图 | **PASS** 26/26 屏 HTTP 200、0 pageerror |
| 4 | `npm run audit:release` | 13 屏 × 2 视口：横向溢出、触控目标、hydration；3 页 × 2 视口 LCP/CLS/TTFB；reduced-motion | 见 §二（首跑：溢出 0、hydration 0、LCP 1 项超预算） |
| 5 | `tsx scripts/qa/v16-unit-runner.mts tests/living/adaptive-stages.test.ts` | 阶段条纯函数 13 例 | **PASS** 13/13 |
| 6 | 同上（T01 两套） | Admin 订阅归一化 + 功能开关 27 例 | **PASS** 27/27 |
| 7 | 变异测试（4 次） | 把 `null` 折成 `0`、用 `ready` 顶替 `attention`、未知状态回退 `active`、时间退回 `toLocaleString` | **全部判红**（说明用例真的在守） |

## 二、`audit:release` 首跑原始结果（2026-10-21，`194acc4`）

```
mobile 390×844        overflow=0   hydration=0
desktop 1440×900      overflow=0   hydration=0
reduced-motion         main transition-duration=0s（两页）
LCP  landing  desktop 3720ms  (IMG)   ← 超预算
LCP  workspace desktop 788ms  (P)
LCP  console  desktop 1676ms  (P)
```
26 个「屏 × 视口」组合**全部零横向溢出**；hydration 错误 **0**。

触控目标首跑：console 七屏 **0/8 ~ 0/16 达标**（导航 36px、"个人模式" 30px），
工作区 12/15 达标（主题按钮 36px、编译按钮 30px）。→ 已在 `1e0a2bd` 统一补到 44px，见 §三。

## 三、LCP 的定位过程（不是猜的）

用同一个页面做对照实验（1440×900，冷上下文）：

| 条件 | LCP | 元素 |
|---|---|---|
| 正常（rAF 视差开启） | 7008ms | IMG |
| `reducedMotion: reduce`（代码里早退，不起 rAF） | 4476ms | IMG |
| 正常 + 暖缓存 | 2396ms | IMG |

差异 2532ms 直接指向"装饰性漂浮动画每帧重绘 preserve-3d 子树，而 LCP 图片就在这个子树里"。
对应修法（`1e0a2bd`）：

1. 漂浮动画延后到 `requestIdleCallback`（兜底 1.2s）才启动；页面隐藏时暂停；
2. 主平面截图 `unoptimized`：228KB 的 PNG 再经 `/_next/image` 转码反而更慢。

> 复测数据写在 `10_PERFORMANCE_REPORT.md`。若复测未达标，仍按 ABOVE BUDGET 记录，不修饰。

## 四、既有门禁（本轮未改动，作为回归基线）

| 命令 | 内容 | 结果 |
|---|---|---|
| `npm run verify:llm:live` | 登录 → 诚实块 → 真实调用一次 → `PROPOSED` + token>0 | **PASS** 9/9 |
| `npm run verify:agent:connectivity:server` | provider / probeUrl / 诊断与 usage 口径一致 | **PASS** 28/28 |
| `npm run verify:payment-off` | 7 个收费入口在未配置时统一 503 | **PASS** 18/18 |
| `node scripts/qa/refund-e2e.mjs` | 退款协议层 5 场景 19 断言 | **PASS** |
| `npm run verify:landing` | 落地页 23 断言（叙事/禁词/交互/data-gate） | **PASS**（本轮改动后复跑，见 §五） |
| CI | lint 棘轮 + jest + schema drift + 依赖门禁 + secret scan | 待本轮 CI |

## 五、未覆盖 / BLOCKED

| 场景 | 状态 | 原因 |
|---|---|---|
| 组织 A 越权访问组织 B 的 Mission | **BLOCKED** | 生产无第二个有数据的组织；步骤与断言写在 `08_SECURITY_AND_TENANCY.md` §四 |
| 真实扣款（AC-25） | **BLOCKED** | 4 个支付凭据缺失 |
| INP | **UNKNOWN** | 需要真实用户交互采样（field data）；实验室里只能测 TBT 之类近似值，这里不冒充 |
| 视觉回归（像素级） | **未做** | 未接 Playwright 的 `toHaveScreenshot` 基线；当前用"改版前/后截图人工对照"代替 |

# 04 · 13 屏 UX 与技术接线审计（T03）

> 基线 `9ba9075` + 本分支修复 · 审计时间 2026-10-21 · 生产 `app.lokfeel.com`
> 方法：Playwright 真实登录态（`admin@lokfeel.com` / ADMIN），逐屏采集 HTTP 状态、
> 标题、可见文本量、可交互元素、console/pageerror、失败请求，并截图桌面与移动。
> 原始数据：`docs/v16/_audit-raw.json` · 截图：`docs/v16/screenshots/before/`
> 脚本：`node scripts/qa/v16-ux-audit.mjs`（只读，不点击写操作）

## 1. 总体结论

| 维度 | 结论 |
|---|---|
| 可达性 | 13 屏 × 2 设备全部 HTTP 200，无登录重定向，无白屏 |
| 数据真实性 | **优秀**：每个数字都标注来源端点；空状态写明"这是真实结果"；未接线能力显式禁用并写原因 |
| 崩溃 / hydration | 未发现 pageerror；唯一 console error 是全局 CSP 违规（见 F-01） |
| 首屏信息密度 | **偏弱**：Now/Studio 在 1440×900 下约 60-70% 为空白 |
| 文案 | 存在多处"实现细节泄漏"（见 F-02/F-03） |
| 移动端 | 13 屏可用，无横向溢出；详见 §4 |

**一句话**：这是一个"诚实但内向"的 13 屏 —— 骨架和数据可信度高于预期，主要差距不在功能真假，而在信息密度、视觉层级与文案口径。三套设计方案的发力点应放在**密度与层级**，而不是重做数据层。

## 2. 缺陷清单

| 编号 | 严重 | 位置 | 现象 | 修复建议 |
|---|---|---|---|---|
| F-01 | **P1** | 全站 | CSP 阻止 `static.cloudflareinsights.com/beacon.min.js`，13/13 屏各 1 条 console error；Web Analytics 数据同时丢失 | 二选一：CSP `script-src` 加入 `static.cloudflareinsights.com`；或关闭 CF Web Analytics beacon。不应保持现状 |
| F-02 | **P1** | `/workspace` Studio | 首段文案直接写 "zod 严格校验""白名单组件""不允许产出 HTML/React 代码" —— 实现细节当产品文案 | 改为用户语言：产出什么、有什么约束、失败会怎样。技术口径放 tooltip/文档 |
| F-03 | P2 | `/workspace` Now | 底部输入框旁 "编译在本地完成（规则版，纯函数）" 是开发者口径 | "编译在本地完成" 即可；规则版/云端版差异属于运维页 |
| F-04 | **P1** | `/console/*` 七屏 | H1 全部为 "LokFeel Preview"，无屏级标题；书签、屏幕阅读器、浏览器历史无法区分七屏 | 每屏 metadata + 语义 H1（任务列表 / 成员 / 连接…） |
| F-05 | P2 | `/workspace` Now | 首屏三卡全是计数器（未读通知 0 / 未读消息 0 / 我的匹配 0），对首次使用者信息量为 0 | Now 应回答"今天该做什么"：待批授权、停滞连接、最近成果 —— 而不是三个 0 |
| F-06 | P2 | `/workspace` 全部 | Evidence Lens（右侧 GET 列表）常驻，对普通用户是噪音 | 默认折叠为"数据来源"角标，展开才见 GET 清单 |
| F-07 | P3 | `/console` 首页 | 文案 "任务列表、状态过滤与可选连接（发布/暂停/恢复/关闭）都在「任务」里。" 标点/表述混杂 | 重写为一句 |
| F-08 | P3 | `/workspace` Studio | 主操作（目标输入框 + 编译按钮）在折叠线以下，空态画布占据首屏 | 空态时输入框上移，或给画布区一个引导性插画 + CTA |
| F-09 | **P1** | `/workspace` 移动端 | 底部悬浮输入框与页面尾部内容重叠（`ws-consent-mobile.png` 可见"提案说明"区块被盖住，输入框说明文字与 Netlify 角标互相挤压） | 移动端把输入框改为随滚动收起，或给 main 加 `padding-bottom` 预留悬浮条高度 |

**未发现**：假按钮（未接线动作全部显式禁用并写原因）、假进度（无 setTimeout 伪造成功）、
假数据（空/失败三态真实）—— 与 `check:ui-invariants` 门禁声称的一致，实测成立。

## 3. 逐屏摘要（桌面 1440×900）

| 屏 | 文本量 | 按钮 | 观察 |
|---|---|---|---|
| ws-now | 641 | 9 | 三卡全 0；空状态诚实；Mission 中心缺失（F-05） |
| ws-studio | 643 | 9 | 实现细节泄漏（F-02）；主操作在折叠线下（F-08） |
| ws-field | 277 | 11 | 画布为主，文本少属正常；无空态引导 |
| ws-consent | 515 | 11 | 逐字段披露结构清晰，是六屏中信息设计最好的 |
| ws-outcomes | 833 | 9 | 时间轴+指标完整 |
| ws-agents | 1336 | 18 | 信息量最大；运行/待批/阻断三态齐全 |
| console-home | 369 | 0(主区) | 布局成熟；F-07 文案 |
| console-missions | 244 | 6 | 空 + 少量操作 |
| console-connections | 268 | 7 | 同上 |
| console-agents | 1133 | 7 | 内容充实 |
| console-members | 294 | 7 | 偏空 |
| console-outcomes | 247 | 4 | 偏空 |
| console-settings | 449 | 1 | 表单为主 |

移动端（390×844）结果见 `_audit-raw.json` 的 `device:"mobile"` 条目；13 屏均 200、无横向溢出报告。

## 4. 与设计方案的对接（T04）

审计结论直接变成三套方案的评分权重依据：

1. **密度问题（F-05/F-08）** 是最大痛点 → 方案 C 的 "Canvas + Inspector" 与方案 A 的
   "Mission 星群" 都把"当前该做什么"作为视觉中心，直接针对此点。
2. **Evidence Lens（F-06）** → 方案 C 把它变成右侧 Inspector 的"证据链"分区，默认收纳。
3. **文案口径（F-02/F-03）** → 三套方案的原型文案均已改为用户语言，可作为落地时的文案基准。

## 5. 复验方式

```bash
node scripts/qa/v16-ux-audit.mjs            # 重新采集
node scripts/qa/v16-unit-runner.mjs tests/admin/*.test.ts   # T01 回归
node scripts/qa/verify-brand-scan.mjs       # T02 门禁
```

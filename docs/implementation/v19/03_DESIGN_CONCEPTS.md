# V19-03 · 三套设计方向（DESIGN_CONCEPTS）

> 三案共用同一条**真实产品流程**（Intent → WorkspaceSpec → Mission → Agent → Consent → Outcome），
> 差异只在视觉与信息架构 —— 这样评审比的是设计，不是流程完成度。
> 每套都是**可编辑 HTML/CSS 源文件 + 真实 Chromium 走通的自证**（`ALL_PROTOTYPES_INTERACTIVE_OK`，0 pageerror）。

| 方案 | 文件 | 一句话 |
|---|---|---|
| A · Living Intelligence | `design/v19/concept-a-living-intelligence.html` | 深色沉浸式 AI 工作区，Agent 星座图谱 |
| B · Precision Workspace | `design/v19/concept-b-precision-workspace.html` | 浅色极简企业级，队列与表格优先 |
| C · Adaptive Dual World | `design/v19/concept-c-adaptive-dual-world.html` | **工程推荐**：继承 V16 Deep Field ⇄ Paper，随阶段切换 |

## 1. 各案要点与成本

### A · Living Intelligence
- **视觉**：`#070a14` 底 + 双径向渐变 + 蓝紫渐变强调色；Agent 星座 SVG；玻璃拟态面板。
- **强项**：品牌辨识度最高，"AI 原生"氛围直接可见；Workspace 画布/Agent 协作屏表达力强。
- **代价**：整套深色令牌从零建；发光/动效与 V18.3 实测的**主线程瓶颈正面冲突**（`/login` 暖态 LCP 3172ms 无改善）；Console 高密度场景反而吃亏。
- **实施成本：高** · 复用度：低 · 性能风险：中高

### B · Precision Workspace
- **视觉**：`#f6f7f9` 底 + 白面板 + `#2563eb` 单强调色；统计条 + 队列表 + 抽屉式 Consent。
- **强项**：信息密度最高、认知负担最低；性能几乎零负担；企业采购审美安全。
- **代价**：辨识度弱（"像 Linear/Asana"）；缺少"生成式"的阶段感与 AI 原生气质。
- **实施成本：中** · 复用度：中 · 性能风险：低

### C · Adaptive Dual World（推荐）
- **视觉**：`[data-world]` 令牌作用域 —— Intent/Outcome 是 **Paper**（暖纸面对话与可读记录），Workspace/Consent 切入 **Deep Field**（深场画布）。与 V16 的 `living-shell` + `dualWorld` 实现同构。
- **强项**：**界面阶段感即产品逻辑**（对话 → 结构 → 成果）；直接继承 V16 资产与 15 组 WCAG 对比度门禁；世界切换是令牌替换，运行时开销 ≈0。
- **代价**：需要把"阶段→世界"映射做成显式规则（原型已给出：`AUTO={intent:paper, workspace:field, consent:field, outcome:paper}`，并保留手动切换）。
- **实施成本：中低** · 复用度：高 · 性能风险：低

## 2. 对比矩阵（评审用）

| 维度 | A | B | C |
|---|---|---|---|
| 与"Connection OS"定位匹配 | 强 | 中 | **强且准确** |
| 13 屏一致性 | 需另配浅色 Console | 一致但平淡 | **天然双态** |
| 移动端 | 图谱需重设计 | 表格降密度 | **继承 V16 断点** |
| 无障碍存量 | 全部重测 | 全部重测 | **继承对比度门禁** |
| 与 V18.3 性能结论兼容 | ✗（动效 vs 主线程瓶颈） | ✓ | ✓ |
| 实施成本 | 高 | 中 | **中低** |

## 3. 共同的"诚实约束"（三案都遵守，也是第二轮实现的红线）

1. 编译/执行过程显式标注 `prototype · simulated compile` —— 设计稿不制造"假成功"的预期。
2. Outcome 一律带 evidence 行；证据不足显示"缺口"（如"4 条回复无引用授权——只计数不引用"），不编置信度。
3. Consent 面写清**授权对象、字段范围、后果、可撤销**；拒绝路径与批准路径同等可达。
4. 画布节点注明"对应真实记录，不是装饰图形"。
5. 桌面（1440）/移动（390）双态实测（自证脚本含视口切换）。

## 4. 与生产基线的对照（设计审查的起点）

| 面 | 生产（📷 `screenshots/production-dc102cd/`） | 三案的共同升级 |
|---|---|---|
| `/` 首页 | Connection OS 表达已就位，CTA 割裂 | 统一 Hero→Composer 结构 |
| `/pricing` | 307 → Hlua（R-01 可见） | HEAD 已修；定价页文案进 Copy Deck |
| `/login` | 一致浅色 | 保持，仅换文案 |
| Workspace/Console | 📷 BLOCKED（D-06） | 方案 C 直接给出目标态，发布后逐屏对照 |

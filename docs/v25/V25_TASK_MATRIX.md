# V25 任务矩阵（V25-00~14 无授权依赖部分）

**来源诚实声明**：用户下发的 V25 总令要求执行 `V25-00` 至 `V25-14`，并提到「29 张工程任务卡 CSV/JSON / V25 完整作战包 ZIP」，但**本次实际收到的唯一机器可读卡表是 V24 的 23 张（`V24_WORKBUDDY_TASKS.csv`，SHA256 `404c492d…`）**。本矩阵不虚构 V25 专卡：以 V24 真实卡表为底座，按 V25 总令六组（A–F）重排为 15 个本地可执行工作包 `V25-00`~`V25-14`，并逐项标注授权边界。若 Owner 补发 V25 原卡，以原卡为准重映射。

纪律：所有项只在 feature branch；生产迁移、扣款、对外消息、正式发布、许可证变更、第三方私聊对接均**不自动执行**。

## 分组映射

| 包 | 对应 V24 卡 | V25 组 | 本轮动作 | 授权 | 状态 |
|---|---|---|---|---|---|
| **V25-00** | A00 | A 事实 | 四 SHA + 支付风险 LIVE 复核（`A00_FACT_BASELINE.md`） | 只读 | **TESTED_LIVE**（本地工作产品） |
| **V25-01** | A01 | A 事实 | 七子系统 REUSE/ADAPT/BUILD/DEPRECATE 清单（`A01_ASSET_INVENTORY.md`） | 只读 | **CODE_COMPLETE** |
| **V25-02** | A02 + V25 §一 | A 战略 | 产品真值源 + 版本继承冲突表（`V25_PRODUCT_TRUTH.md`） | 只读；对外文案改动待 D-1 | **DRAFT · REVIEW_REQUIRED** |
| **V25-03** | A03 + V25 §二 | B/C IA | Personal（Chats/People/Spaces/My AI）与 Business（Spaces/Members/Connections/Agents/Insights）入口映射；不新增静态界面 | 只读映射 | **TODO**（下一批） |
| **V25-04** | A04 | B/C 身份 | 真人/AI 身份标注、设备配对盘点；botModule.enabled=true 风险登记 | 盘点 | **TODO** |
| **V25-05** | A05 | B 消息 | 1:1/群真实往返盘点；E2EE 方案 RFC（不宣称已实现） | 盘点/RFC | **TODO** |
| **V25-06** | A06 | B/E 记忆 | Local Vault 加密记忆 BUILD 契约（MISSING 项） | 契约草案 | **TODO** |
| **V25-07** | A07 | E AI | Social Intelligence Router 最小实现：规则 + 检索 + 现有模型强基线对照（禁止模型自评） | 本地代码 | **BLOCKED**（需模型后端授权 + 评测集） |
| **V25-08** | A08 + V25 §五 | E AI | 跨语言改写/误读提示评测协议（不自动发送） | 协议草案 | **TODO** |
| **V25-09** | A09 | B/C 安全 | 媒体档位 consent gate 执行点缺口（A01 §1/§5）；修复涉及发送行为 | 本地可逆工程 | **BLOCKED**（需产品确认语义：是 gate 还是仅展示过滤） |
| **V25-10** | A10 | B/C Spaces | Shared Capsule 双人/群空间契约；成员变更换密钥 | 契约草案 | **TODO** |
| **V25-11** | A11/A12 | B/C 结果 | 证据分级已有 REUSE；真实投递/Provider 回执需外部授权 | 盘点 | **PARTIAL** |
| **V25-12** | A13 | F 治理 | 举报/拉黑/未成年保护/申诉闭环盘点（V23 C-05 拉黑拦截 NOT FOUND） | 盘点 | **TODO** |
| **V25-13** | B19 + V25 §三/§四 | D 开放 | License RFC（AGPLv3 → Apache-2.0 诉求冲突）+ Community Edition 可运行定义 + SDK/SBOM BUILD 清单 | RFC（不单方改许可证） | **TODO**（下一批） |
| **V25-14** | A14/A15/A16/A17 + V25 §六 | F 验收 | i18n/a11y、9 页性能、独立审查、发布门禁继承清单（不放水、不重置） | 门禁登记 | **TODO**（下一批） |

## 本轮实际完成（可核验）

- **V25-00**：`docs/v25/A00_FACT_BASELINE.md`（四 SHA + 生产 LIVE 支付风险，2026-11-17T04:17Z）。
- **V25-01**：`docs/v25/A01_ASSET_INVENTORY.md`（8 子系统逐项判定 + 文件行号 + 副作用边界）。
- **V25-02**：`docs/v25/V25_PRODUCT_TRUTH.md`（唯一 Claim 表、禁词表、不可混用映射、V22→V25 继承冲突）。
- 输入归档：`docs/v25/spec/`（V24 ZIP 原件 + 解压文件 + SHA256；V25 总令全文）；本矩阵。

## 真实工程阻断点（按总令「直到阻断点出现」即停）

1. **生产泄价（A00）**：`/pricing` 与 plans API 仍暴露未批价格与 `checkoutReady=true` ⇒ 需 Owner D-4 二选一批复，工程不得自行热修生产。
2. **V25 原卡缺失**：29 张卡 CSV/JSON 未提供 ⇒ V25-00~14 为重排映射，不是原卡逐条执行。
3. **V25-07/09 语义未定**：SIR 需模型后端授权与真实评测样本；consent 缺口是「发送 gate」还是「展示过滤」需产品确认。
4. **许可证变更**：仓库现为 AGPLv3 + 商业双许可，V25 期望 Apache-2.0 ⇒ 须 RFC + 法务/Owner 批准，不单方改。
5. **对外真实投递 / 真实扣款 / 生产迁移 / 正式发布**：全部需逐项授权，本轮零执行。
6. **独立 Reviewer / 10 人真人**：无已授权独立主体与真人样本，不得自签或模拟充数。

## 验收状态机（继承 V23，不跨级）

`TODO → CODE_COMPLETE → TESTED_LOCAL → TESTED_PREVIEW → INDEPENDENTLY_VERIFIED → PRODUCTION_VERIFIED`。
本轮最高到 `TESTED_LIVE`（V25-00 只读取证）与 `CODE_COMPLETE`（文档级），**无任何生产态结论**。

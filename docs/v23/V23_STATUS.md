# V23_STATUS | 唯一状态页（Relationship-first Reset）

更新：2026-11-16 · 分支 `v23/relationship-reset`（本地，未推送 / 未部署 / 未改生产）｜生产 `b50e53e`、远端 main `cad717e`（`git ls-remote` 复核）。
**整体判定：NO_GO。** 本页是 V23 进度的唯一权威；禁止用旧 V21/V22 状态页或口头描述替代。

## 版本对应

| 项 | SHA | 来源 |
|---|---|---|
| 本分支基线 | `6bab34c`（V22 第一批） | `git log` |
| 远端 main | `cad717e` | `git ls-remote`（LIVE） |
| 生产 | `b50e53e` / healthy / `commitSource=env` | `GET /api/health`（LIVE，`BASELINE.json`） |
| 本批提交 | `2767ede`（证据）→ `c814cc4`（第一批）→ `487fbe5`（e2e 断言修复） | `git log` |

## 第一批任务卡（按总令 §09 格式）

### R00 / 战略映射 — `OWNER_REVIEW_REQUIRED`
- **交付**：`STRATEGY_LOCK.md`（V23 冻结定位）、`STRATEGY_DIFF.md`（12 维四栏差异表）、`V23_PRODUCT_TRUTH.md`（C-01~09 允许 / X-01~08 禁止 / 5 组不可混用映射）、`capability-register.yaml`、`OWNER_DECISIONS.md`（D-1~D-7 集中决策单）。
- **验证**：交叉引用全部指向真实文件与 LIVE 取证；未把「关系」默默换回「通用目标」。
- **BLOCKER**：D-1（一级定位）与 D-2（首个场景）待 Owner 批复。

### R01 / 代码资产盘点 — `TESTED_LOCAL`
- **交付**：`ASSET_INVENTORY.md` / `.json`（REUSE/MODIFY/BUILD/DEPRECATE 逐项）、`BASELINE.json`（四 SHA + 作战包 SHA256 清单）。
- **验证**：`BASELINE.json` 全部字段来自 `git ls-remote` / 生产 GET 实测（capturedAt 2026-11-16 15:09 GMT+8）。
- **NEXT**：R04 真人访谈任务书（`DISCOVERY_PROTOCOL.md`）尚未编写。

### R02 / 制止扩散 — `TESTED_LOCAL`
- **交付**：`ARCHITECTURE_ADR.md`（Relation-first ADR：Mission/AgentRun/WorkspaceSpec 降为技术底座，禁止作用户价值 KPI）。

### R03 / 现网保护 — `TESTED_LOCAL`（生产仍未修复）
- **代码**：`src/lib/payments/commercial-gate.ts` 商业批准升级三重合取：`PRICING_APPROVED`（Owner 显式开关，`src/config/pricing-gate.ts:21`）AND 目录 `APPROVED` AND 真实 `approvalRef`。
- **测试**：`tests/billing/commercial-gate.test.ts`（+1 负控：目录 APPROVED + 凭据齐备 + Owner 开关未签 ⇒ 门仍关）、`tests/billing/p0-02-rc-checkout-gate.test.ts`（改钉当前真实态：恒关）。billing 目录 374/374。
- **诚实边界**：生产 `b50e53e` 仍在泄价（`/pricing` $89/$199/$449 + plans API `checkoutReady:true`），**本地修复未部署**；处置方式待 D-4 批复（发布热修复 或 摘除生产支付密钥）。
- **根因记录**：`LIVE_RISK_AUDIT.md`（P0-1~P0-5）。

### U01 / 关系优先 IA（第一批部分）— `TESTED_LOCAL`
- **代码**：`src/app/workspace/living-workspace.tsx` NAV 一级 4 主任务改「发现适合的人 / 我的介绍 / 等待双方确认 / 关系进展」，二级「引荐方案 / 关系网络 / AI 辅助记录」；**7 个 `?view=` key 与深链全部保留**（改名不改 key）。
- **测试**：`tests/e2e-ci/workspace-tabs.spec.ts` 标签同步更新；本地 e2e **16/16**（390×844 与 360×800 × 7 视图 + 结构断言），7 个 `?view=` key 全实测。

### U02 / 官网首页（第一批部分）— `TESTED_LOCAL`
- **代码**：`src/app/(landing)/page.tsx` 重写为 relationship-first（Hero `Meet people worth knowing. Both people choose. Real connections follow.`；唯一主动作 = 关系意图输入；**sessionStorage 草稿、私密偏好不进 URL**（U06 前置）；truth gate 同屏声明「无真实介绍样本、无客户结果」）；`src/app/layout.tsx` 根 metadata + OG/Twitter 卡全部去 `Connection OS` 叙事；`src/config/brand.ts` 冻结 V23 品类/标语，禁词表增 `Agent-Native Connection OS` / `Every outcome verified`。
- **测试**：jest 2926/2926、tsc 0、eslint 改动面 0、build 0（见下）。
- **未做**：7 视口截图、axe、真人 5 秒测试（Q05）；公开六页仍是 V22 通用叙事（U07 范围，含 6 处 `Try with a goal` 残留）。

## 本批门禁读数（本地实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `env -u NODE_OPTIONS npx tsc --noEmit` | exit 0 |
| 改动面 lint | `env -u NODE_OPTIONS npx eslint <6 个改动文件>` | exit 0 |
| 单元 | `env -u NODE_OPTIONS npx jest --silent` | **162 suites / 2926 tests** 全过 |
| 构建 | `env -u NODE_OPTIONS npm run build` | exit 0（沙箱外执行，`prisma generate` 需重写 `src/generated`） |
| 品牌扫描 | `env -u NODE_OPTIONS node scripts/qa/verify-brand-scan.mjs` | 27 页 / 0 命中 |
| e2e（分批） | `bash /tmp/lf-e2e-run.sh <spec 分组>` | **全部分批通过**：smoke+register-form、workspace-now / -race / -tabs（16/16）、auth-dialogs 11/11、mobile / legacy-mobile / authed-mobile / dialogs / cache-headers |
| 单次全量 e2e | `bash /tmp/lf-e2e-run.sh` | 未成功一次跑完：先被沙箱 `unlink` 拦截（提权后重试）、再遇进程僵死 `SQLITE_IOERR`（已清理）、最后 exit 137 被系统终止 ⇒ **按套件分批实测**，不把单次全量宣称通过 |
| 7 视口 / axe / 真人测试 | — | **未跑**（U08 / Q05 后续批次） |

e2e 过程中的三个真实问题及处置（不掩盖）：
1. `smoke ⑥` 两处断言停留在旧契约（`Connection OS` 文案、`commercialApproval.status`）⇒ 修为 V23 品牌 + `pricingPublished`，见 `487fbe5`。
2. `auth-dialogs ⑥` 焦点恢复在一次并发批次中失败，单独复跑通过（时序敏感，非本批改动）。
3. `auth-dialogs ⑦` 二次跑撞 24h 举报去重的陈旧行 ⇒ 清理隔离库 `UserReport`（`reporterId` 为 QA chat A）后 11/11 通过；本批未改举报代码。

## 已知未闭合（不因本批收窄）

1. **D-1~D-7 Owner 决策单待批复**（D-4 生产泄价最紧急）。
2. U03~U08、D01~D12、B01~B05、Q01~Q07 全部未开工或部分开工（见 `02_V23_WORKBUDDY_TASKS.md` 37 卡）。
3. C-05（拒绝后不受打扰：拉黑拦截 NOT FOUND）与 C-07（verified 徽章无 provider 证据）为 BLOCKER 级 GAP（`V23_PRODUCT_TRUTH.md`）。
4. 公开面 `proxy.ts` 冻结门维持关闭（解冻需 Owner 批准，涉 D1/D8）。

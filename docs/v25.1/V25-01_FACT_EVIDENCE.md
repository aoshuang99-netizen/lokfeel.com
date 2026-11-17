# V25-01/02/33 · 生产支付风险独立重取证（LIVE 只读）

- **取证时间**：2026-11-17（本轮实时 curl，非引用旧报告）
- **基线 SHA**：本地 `d920b42`（分支 `v25/open-ai-social`）· 远端 main `cad717e` · 生产 `b50e53e`（`commitSource=env`，构建 `2026-11-14T08:38:05.985Z`）
- **取证方式**：`curl --noproxy '*'` 只读 GET，无凭据、无 cookie、无写操作
- **状态**：`DISCOVERY_COMPLETE`（事实只读）；**Hotfix 候选未部署**，等 U-1 授权

## 1. 生产实际响应（铁证）

### `/api/health`
```json
{ "commit": "b50e53e", "commitSource": "env", "builtAt": "2026-11-14T08:38:05.985Z" }
```

### `/api/payments/dodo/plans`（HTTP 200）
```json
{
  "ok": true, "provider": "dodo", "currency": "USD",
  "catalogVersion": "2026-11-13.1", "approvedAt": "2026-11-13",
  "checkoutReady": true,
  "commercialApproval": {
    "status": "APPROVED",
    "ref": "PRICING_APPROVAL 2026-11-13.1 · 所有者重新定价指令（对标 Circle/Notion/Skool，采集 2026-11-13）"
  },
  "environment": "live_mode", "missing": []
}
```
### `/pricing`（HTTP 200，64KB）
- `<title>Pricing · LokFeel Connection OS | LokFeel</title>`
- 页面文本：`订阅起价 From $89/mo · 支持在线开通`
- RSC payload：`PlanCards` 收到 `checkoutReady:true, showPrices:true, bound={STARTER/GROWTH/...}`
- OG/Twitter 元数据仍为旧叙事 `Connection OS for AI-native teams`（V23 已在本地修，生产未同步）

## 2. 管理裁决对齐（V25.1 总令 §1）

| 卡 | 结论 |
|---|---|
| V25-01 | 生产支付风险 **实证成立**：未批定价暴露 + checkout 可用 + live_mode。这是 P0，不以"其他模块未完成"为由推迟止损 |
| V25-02 | 四 SHA 版本图已溯源（本地/远端/生产真实值，Preview NA）。目录自填 `APPROVED` 不算 Owner 授权——本地 `PRICING_APPROVED=false` 才是 V23 起的真值源 |
| V25-33 | 本地已具备 fail-closed 代码（V23 `readCheckoutGate` 三重合取 + 契约测试），但**生产运行的是旧 commit**，热修复未部署。发布行为需 Owner U-1 明确授权，不因本包生成即执行 |

## 3. 为什么现在不改生产

- 总令 §7 与本包 `release_policy` 明确：`NO_GO until Owner approves production SHA`；未授权不得改生产凭据、执行生产迁移。
- 命令行可选路径 A（发布本地 fail-closed 热修复）或路径 B（Netlify 摘除 `DODO_PAYMENTS_API_KEY` 止血）都涉及生产写，**必须 U-1 批**。
- 本轮遵守：0 推送、0 部署、0 生产写、0 真实扣款、0 对外消息。

## 4. 负向测试现状（诚实）

- 本地 `tests/billing/commercial-gate.test.ts` + `p0-02-rc-checkout-gate.test.ts` 已覆盖：目录自设 APPROVED + 凭据齐备 + Owner 开关未签 ⇒ 门仍关；无凭据不能开卖。
- **生产环境下的未登录 401 / 无审批拒绝 / 零 Provider session 负向实测 NOT_TESTED**（只读 GET 不触发 checkout，且需 Owner 授权方可在生产构造未批场景）。
- verdict：`DISCOVERY_COMPLETE` / `INDEPENDENTLY_VERIFIED=未做`（本 Agent 非独立审查人，不自签）。

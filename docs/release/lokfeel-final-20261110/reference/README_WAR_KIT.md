# LokFeel 线上发布作战包（证据驱动 / 不自动部署）

内容：

- `docs/LOKFEEL_B6_G13_RELEASE_ORDER.md`：WorkBuddy 最终任务总令、G0–G13 验收门禁、D1–D8 批准、B6/G13 顺序。
- `examples/lokfeel_visual_reference.html`：3 个可在浏览器打开的 UI 视觉参考（官网、套餐、Workspace），不是真实截图和 Figma 文件。
- `scripts/release-preflight.mjs`：只读生产 `health`/`plans` + 远端 main 对比；若 live checkout 仍开通以 exit 2 标记风险。
- `scripts/release-preflight.test.mjs`：6 条纯函数测试；真实生产错误不判成功。
- `scripts/check-release-manifest.mjs`：RC manifest 结构 fail-closed 检查，**不替代真实人工批准检查**。
- `examples/release_manifest.template.json`：发布清单空模板，所有占位均不能当作实值。
- `examples/dodo_payment_event_reducer.example.ts`：幂等/状态转移的设计示例，不能直接替换当前 Prisma 业务实现。
- `.github/workflows/lokfeel-release-readiness.example.yml`：只含手工触发的 read-only CI 示例，不能进行生产部署。

## 本地查看 UI

打开 `examples/lokfeel_visual_reference.html`，可切换 Website / Pricing / Workspace，并在 390px/1440px 调整窗口查看排版。

## 运行自测

```sh
node --test scripts/release-preflight.test.mjs
node scripts/check-release-manifest.mjs examples/release_manifest.template.json  # 应故意失败，证明模板不能误发布
```

## 在 WorkBuddy 的真实仓库运行（只读）

```sh
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
node scripts/release-preflight.mjs --base=https://app.lokfeel.com --out=/tmp/lokfeel-preflight.json
```

应先将上述脚本通过代码审查复制进对应的 `scripts/` 目录。`RISK_OPEN` 是待处理的安全风险，不代表准许自动关闭或部署。用户要求完整验收、生产发布仍需按特定 SHA 显式批准。

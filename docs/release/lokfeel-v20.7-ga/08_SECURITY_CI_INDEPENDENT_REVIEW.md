# 08 · 安全、CI 与独立复核（T8）

## 1. 本地门禁（本轮实际执行，附退出码）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **exit 0**（先 `rm -rf .next` 清陈旧类型，否则 `.next/types/validator.ts` 报假错） |
| Build | `npm run build` | **exit 0**（2m14s，含 `/holding` 与新页面冻结） |
| 公开面冻结单测 | `npx jest tests/release/public-surface-frozen.test.ts` | **10/10** |
| 公开面声明审计 | `node scripts/qa/ga-public-claims-audit.mjs` | **PASS 12/12** |
| CI 浏览器冒烟（本地构建产物） | `npx playwright test --config=playwright.ci.config.ts tests/e2e-ci/smoke.spec.ts` | **5/6**：⑥ `/pricing` 由 **FAIL→PASS**；① 因本地无 CI 的 sqlite 基线库而失败（与本轮改动无关） |

## 2. 远端 CI

- 本轮候选尚未推送（提交后推 `release/v20.7-ga`，**不推 main**）；
- 上一条已知状态：`c97c893` → 12 PASS / 1 FAIL / 2 SKIP，唯一失败是 `/pricing`（本轮已在本地复现为 PASS）；
- **不改写"远端全绿"**：required checks 未配置，且新候选的远端结果以 `git ls-remote` + check-run 为准。

## 3. 安全项

| 项 | 状态 | 说明 |
|---|---|---|
| gitleaks | 由远端 CI 跑 | 本地无二进制（代理阻断）；不写"已扫描" |
| CodeQL | 由 `codeql.yml` 跑 | 同上 |
| 依赖审计 | 既有 CI job | 本轮未新增依赖 |
| 产物/客户端包密钥扫描 | **`NOT_TESTED`** | 需对 `.next` 产物做模式扫描 |
| 鉴权/租户隔离 | 既有套件 + S-03 实测 | 本轮改动不触及鉴权 |

## 4. 本轮改动的安全性质（供复核者快审）

- 只改了**公开面渲染与文案**、一个配置开关、两个样式类；**未**改支付路由、未改 prisma、未改 `next.config`、未加依赖。
- 冻结是 **fail-closed**：`NEXT_PUBLIC_PUBLIC_SURFACE_FROZEN !== 'false'` 即冻结；拼错的任何值都保持冻结。
- 法律文案是**删减**未核实断言（删 `Inc.`/`Delaware`），不是新增承诺。

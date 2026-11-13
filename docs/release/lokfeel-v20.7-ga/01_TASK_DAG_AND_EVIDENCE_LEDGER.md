# 01 · 任务 DAG 与证据台账（T0 → T15）

> 一行一卡：状态 / 证据 / 下一动作。`PASS_CODE_ONLY`、`PARTIAL`、`BLOCKED`、`NOT_TESTED` 不计通过。

| 卡 | 状态 | 实际产出 | 证据 | 下一动作 |
|---|---|---|---|---|
| **T0** 实时取证 | **DONE** | 生产 `0e16959`、`checkoutReady=false`、五页 200、CF→Netlify | `00_CURRENT_FACTS.md`、`evidence/s04-post-deploy-verify.json` | 每次发布后重采 |
| **T1** 发布治理 | **PARTIAL** | 分支 `release/v20.7-ga`；根因定性；规则集/Netlify 配置清单 | `02_...md` | 管理员开 ruleset + 停自动发布 |
| **T2** 公开面封存 | **DONE（代码）** | 渲染层冻结 + 导航/页脚/sitemap + noindex + 金额商业门 + 触控 24px + 法人断言清除 | `03_...md`、`evidence/t2-public-claims.json`（12/12，0 金额 0 主体） | 四档视口 + axe（下一轮） |
| **T3** OWNER 503 | **NOT_TESTED** | 匿名 401 已证、路由级 7/7；缺生产 QA 会话 | `04_...md` | 给 Preview 会话或授权建 QA OWNER |
| **T4** Dodo 全链路 | **BLOCKED** | 事件覆盖矩阵 14/14（代码侧）；provider 订阅清单不可读 | `05_...md` | D4 test_mode 凭据 |
| **T5** 定价/法务 | **BLOCKED** | 已删未核实主体断言；Starter/Growth/Scale 唯一数据源存在 | `HUMAN_APPROVAL_PACKET.md` | D1/D3/D8 |
| **T6** Figma/G5 | **BLOCKED / NOT_TESTED** | 触控目标修复；Import Kit 仍在 | `06_...md` | F1 凭据 + D7 真人 |
| **T7** TBT | **FAIL** | 未动（避免半成品性能改动） | `07_...md` | 8 页×5 轮基线 → 归因 → 拆包 |
| **T8** 安全/CI | **PARTIAL** | tsc/build/jest/审计/冒烟 本地全跑，⑥ 转绿 | `08_...md` | 本候选远端 CI + 产物密钥扫描 |
| **T9** 人工输入 | **DONE（材料）** | 9 项集中签字单 | `HUMAN_APPROVAL_PACKET.md` | 你逐项勾 |
| **T10** 冻结 RC | **PENDING** | manifest 已建，`rcSha` 待本分支提交后回填 | `09_RELEASE_MANIFEST.json` | 提交后回填并锁 |
| **T11** PR/CI/Preview | **BLOCKED** | 无 token 建 PR；已给 Compare URL | `02_...md` §3.3 | 管理员开权限 |
| **T12** 集中 GO/NO-GO | **NO_GO** | 4/13 严格 PASS | `10_RC_GO_NO_GO.md` | 门禁转绿 |
| **T13** 受控发布 | **N/A** | 未发布 | — | F2 授权 |
| **T14** G13 | **N/A** | — | `11_...md` | 发布后 |
| **T15** 48h 观察 | **N/A（Hotfix 观察另计）** | 哨兵每小时 CLOSED | `12_...md`、`evidence/checkout-sentinel-*.log` | 发布后启动 |

## 依赖关系（实际执行顺序）

```
T0 ─> T2 ─> T8 ─> T10 ─> T11 ─> T12 ─> T13 ─> T14 ─> T15
       └─ T3/T4/T5/T6/T7 可并行，但都卡在人工输入或凭据上
```

## 本轮"未做"的诚实说明

T4/T6/T7 不是"忘了"，是**缺输入**：test_mode 凭据、Figma 权限、真人、以及一轮完整性能采集窗口。
T5 的法律主体只能由你提供；我不会用"看起来合理"的公司名填进去。

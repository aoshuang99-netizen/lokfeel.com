# 11 · 生产 G13 证据（T14）

**状态：`N/A` —— 未发布，因此没有 G13。**

G13 的语义是"**已发布版本**的全链路生产复验"。在未取得对具体 SHA 的发布授权前，
任何"G13 通过"的表述都是把 Hotfix 复验（`s04-post-deploy-verify`）冒名成 GA 验收。

## 发布后我会逐项跑（同一 SHA，`--base=https://app.lokfeel.com`）

| # | 项 | 判据 |
|---|---|---|
| 1 | 部署一致性 | `health.commit` = 批准 SHA = manifest `rcSha` |
| 2 | 结账门 | 未批准：匿名 401、OWNER 503；已批准：受控测试后核验 |
| 3 | 公开面 | 若解冻：12 路由声明审计 0 命中；若仍冻结：五页只输出占位 |
| 4 | Dodo | 真实 endpoint + 签名 + 幂等 + 账本/权益四方一致 |
| 5 | 产物密钥 | 客户端包与 `.next` 产物 0 泄漏 |
| 6 | 回滚 | 回滚点不重开收银台，dry-run 真实有效 |
| 7 | 监控 | 5xx / 会话失败 / webhook 401-5xx / 版本漂移 |

只有 1–7 全部适用项 PASS，才写 `RELEASED_AND_VERIFIED`；否则 `RELEASED_NOT_VERIFIED`。

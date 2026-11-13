# 12 · 48 小时观察（T15）

**GA 观察窗：`N/A`** —— 未发布，观察期不存在。不写"0 异常"这类空集假绿。

## 当前真实在跑的只有一件事：Hotfix 只读哨兵

| 项 | 值 |
|---|---|
| 频率 | 每小时（已 ACTIVE，调度任务） |
| 判定 | `CLOSED`（`checkoutReady=false`）持续 |
| 最近记录 | `2026-11-13T03:48:39Z` · `CLOSED` · `commit=0e16959` |
| 翻转历史 | `11:33:50Z RISK_OPEN/5a161c4` → `13:38:05Z CLOSED/0e16959` |
| 一次 ERROR | `15:48:41Z`（哨兵自身 fetch 失败，不是生产故障） |

日志：`../lokfeel-final-20261110/evidence/checkout-sentinel-2026-11-12.log`、`-11-13.log`

## 发布后 48h 采集口径（GA）

每小时：uptime · `checkoutReady`/审批状态 · 版本漂移（`git ls-remote` vs `health.commit`）· 关键接口 5xx · Auth/Provider 错误 · webhook 验签失败率 · 账本-权益对账差异。
阈值触发即通知，不自动改生产数据/退款/调价/切流。

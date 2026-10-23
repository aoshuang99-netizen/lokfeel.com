# V19-17 · 390px 真实 Mission 闭环（WB19-41）

> **状态：BLOCKED（2026-10-23）。** 缺两个前置：① 可登录的隔离环境（`D-06` 生产测试账号未批；本地依赖装不完 ⇒ `next dev` 无法起）；② 隔离测试数据库（Turso 远程，`db push` 不可用，不能在生产库造 Mission 数据）。
> 本文档把"解锁当天怎么跑"固化成可执行流程，避免解锁后现想。

## 1. 已经真实验证过的部分（不等解锁）

| 环节 | 证据 | 边界 |
|---|---|---|
| Intent 输入（390px） | `screenshots/v194-audit/_hlua__390x844.png` 等公开面截图 + `/` demo 编译器（`demo · runs in your browser` 明示非真实执行） | demo 是浏览器端演示，**不冒充真实 Mission** |
| Intent → WorkspaceSpec（真实 API） | 代码级：`/api/v1/intents` + Schema 白名单（`workspace-spec-drift` 门禁在 CI） | 无浏览器级真实调用证据 |
| 认证门 | 16 审计：`/workspace` 与 7 条 `/console/*` 在两视口均干净重定向 `/login`，0 控制台错误 | 只证明门，不证明业务流 |

## 2. 解锁后的执行流程（WB19-41 定义）

前置：`D-06` 账号 + 隔离库（或 shadow 库）。

1. 390×844 真实 Chromium，登录测试账号；
2. composer 输入真实目标 → 触发 `/api/v1/intents` → 断言返回 WorkspaceSpec 通过 Schema 校验（非法字段被拒）；
3. 创建 Mission → 断言 `POST /api/v1/missions` 201 + **刷新后仍存在** + 重复提交不产生第二条（幂等断言）；
4. Agent 区断言状态来自 `/api/v1/agents/runs`（等待/执行/失败/完成四态各有断言；**禁止 setTimeout 假进度**）；
5. Consent：批准 → 服务端 `execution.available` 变化；拒绝/撤销 → 受保护动作 403；
6. Outcome：区分 verified / unverified / 未执行；缺失数据显示「—」不为 0；
7. 全程录控制台与网络；每关键状态截图（稳定 DOM 后）；
8. 清理：测试数据按 id 删除（外键清单见 QA 记忆：39 个外键指向 User），删后逐表计数差值 = 预期。

## 3. 当前对验收矩阵的影响

UX-02（390px 主流程可操作）= **BLOCKED**；UX-07/08/09/10 的 UI 侧证据由 `18` 的四向核验部分承担，端到端证据等本任务解锁。

# 生产部署申请（待 Owner 精确批准 · 本会话未部署、未迁移、未改密钥、未扣款）

> 这是一份**申请**，不是执行记录。当前生产 main = `cad717e92542395e4346e49d388f09be78ec1557`，本会话全程未改动。
> 按上线令的分波原则：**安全 Hotfix（S）/ 基础 WebChat（W）/ 真实 AI Alpha（A）分批独立发布**，不捆在一起。

## 一、候选制品（git ls-remote 权威）

| 项 | 精确值 |
|---|---|
| UI+CI 整改源码候选 | `7b03a843ae1079f0cc6d9eb1e635e9244f451fd9` |
| 远端 `rc/ui-remediation-20261121` | `7b03a84`（CI/Preview 已在此 SHA 跑过） |
| 远端 `ui-remediation/20261121` | `7b03a84` |
| 生产 main | `cad717e`（未动） |
| CI Run | `44888177078` |
| Preview 部署 Run | `44888176984`（job success，运行时未验证） |

## 二、每波次的精确批准项

### W 波（基础 WebChat + UI 整改）—— 本次申请主体
- **部署 SHA**：`7b03a843ae1079f0cc6d9eb1e635e9244f451fd9`
- **数据库迁移**：**无 schema 变更**（本候选只改 UI/测试/依赖 override，`prisma/schema` 未改）。W 波可独立发布，不需要迁移窗口。
- **回滚锚点**：`cad717e92542395e4346e49d388f09be78ec1557`（当前生产，安全版本）——但注意回滚目标不得是"开放付费 Checkout"的旧不安全版本，需 Owner 确认 `cad717e` 满足该约束。
- **已知残留（不隐瞒）**：
  - E2E 2 条 race 用例 CI 红（本地 4/4 过，CI 时序特定，非功能缺陷）——需 Owner 决定是否接受带此残留发布，或先修测试手法。
  - Preview 运行时未在本环境验证（出网阻断）——发布前需在有权限环境独立复核 8 路由。

### S 波（安全 Hotfix · 支付 fail-closed）—— 独立申请
- **源码**：`230a21b9c035b89e371024df0697887125128658` / 审批包 `77bbb222b117537249777f4c5f2e6a5277cfc5ad`（上一冲刺已备）。
- 本会话未对其做新改动。需 Owner 独立批准，不与 W 波捆绑。

### A 波（真实 AI 私人 Alpha）—— BLOCKED，不在本次申请
- 本地/生产均无 `WORKBUDDY_LLM_*` 真实 Provider trace；AI 入口如实显示"私人测试·暂不可用"。
- 无真实模型证据时**不宣称 AI 已上线**，不阻塞 W 波受控发布。

## 三、发布前必须满足（当前未全部满足，故为申请而非执行）

- [ ] Owner 对精确 SHA `7b03a84` + 回滚策略 `cad717e` 明确批准
- [ ] 人类独立 Reviewer 复核（当前无 gh/token，GitHub Reviewer 未打通；上一轮 Agent 独立复核 verdict=PARTIAL，不等于人类 Reviewer）
- [ ] Preview 运行时独立复核（8 路由 / 登录 / API / 部署 SHA）——出网阻断，待有权限环境
- [ ] E2E 2 条 race CI 残留的处置决策（接受或先修）
- [ ] 分支保护 + required checks 生效（当前 main_protected=false，未在会话中变更）

## 四、发布后生产复验清单（仅批准后执行）

1. 只读 `GET /api/health`，核对 `commitSource` 与部署 SHA。
2. 真实浏览器打开 `/`、`/workspace`、`/dashboard/chats`（320/390）、`/console` 八路由，截图存档。
3. 真实测试账号走黄金路径：邀请按钮→邀请码→创建 Mission→刷新读回。
4. 安全负例回归：未授权 401、跨租户 0 成功、未审批 Checkout 0 创建。
5. 审计数据脱敏（set-cookie / 密码不落盘）。

## 五、明令禁止（本会话已遵守）

- 未 push `main`；未部署生产；未做生产迁移；未改任何密钥；未发起真实扣款；未发外部消息。
- 所有 CI/Preview 证据来自 `rc/**` 候选分支，生产 `cad717e` 未受影响。

# 06 · Figma 可编辑交付与真人测试（T6）

| 子项 | 状态 | 缺什么 |
|---|---|---|
| Figma 可编辑节点（G3） | **`BLOCKED`** | Figma PAT 或官方 connector 授权（F1） |
| 静态 Import Kit | ✅ 已有 | `figma-import-kit/`（33 token / 3 systems），但它**不能冒充**可编辑节点 |
| 5 名真人测试（G5） | **`NOT_TESTED`** | D7：真人参与；智能体不可模拟 |
| 四档视口验收 | **`NOT_TESTED`** | 本轮未跑 360/390/768/1440 截图与 CTA trace |
| axe serious/critical = 0 | **`NOT_TESTED`** | 未对构建产物注入 axe |

## 我做了什么 / 没做什么

- **做了**：触控目标从 20px 提到 ≥24px（WCAG 2.2 AA 2.5.8），修的是 CI 里真实红的那两个链接；
- **没做**：不伪造 Figma 节点、不编造真人测试记录、不在没跑 axe 的情况下写"0 问题"。

## 拿到权限后我会输出的三样东西

1. Figma File URL + 每个组件的 **Node ID**（可编辑，不是截图）；
2. Component → code 的映射表（哪个 React 组件对应哪个 node）；
3. 5 份真人会话的原始记录（录屏/时长/问答）+ 4/5 判据汇总。

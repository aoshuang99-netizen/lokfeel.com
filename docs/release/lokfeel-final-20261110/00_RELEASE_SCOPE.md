# 00 · 发布范围与基线（lokfeel-final-20261110）

- **目标**（总令 §1）：陌生目标客户看得懂、敢试、会用、能完成真实协作并核验结果、明确理解订阅权益的正式商业版本。
- **范围声明**：本轮为「已知缺口完整收口」，不新增产品支线。候选包含：R-15 账本缺陷修复、R-14 假设显式化、G12 商业门禁机制化与代填审批回退。官网八页（G1/G2）、Figma（G3）、CF 迁移（G9）、用户测试（G5）**不在本候选内**，按 RELEASE_STATUS §5 批次推进。
- **版本与部署事实**（G0，实测）：
  - 基线 T0：2026-11-10 18:59:43 CST
  - 生产：`https://app.lokfeel.com` = `5a161c4`（deploy `6af2d9afb8e9`，Netlify）
  - 远端 main at T0：`a8ca968`（文档提交，`[skip netlify]`，产物=5a161c4）
  - 候选：见 git log（本目录随提交生成），**未发布**
- **验收字段**：见 `07_ACCEPTANCE_MATRIX.csv`（本目录）。
- **审批引用**：无（G12 处于待批准状态，见 RELEASE_STATUS §4/D1）。
- **回滚点**：线上 `5a161c4`（未变更）；候选发布后的回滚点 = 发布前 SHA，写入 08_RELEASE_MANIFEST.json（READY_FOR_APPROVAL 时生成）。

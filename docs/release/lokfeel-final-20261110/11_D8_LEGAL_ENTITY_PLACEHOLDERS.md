# P0-08 · D8 法律主体与联系方式占位清单

> 状态：**BLOCKED（D8 未批）** · 2026-11-12 · 依据 V20.7 作战包 §2 / §4 / §6
> 这份是**待用户一次性批复的占位清单**，不是已核实的法律信息，也不构成法务意见。
> 按总令「法律主体不能代填」：本轮不擅自新增、删除或改写任何主体声明，只登记出现位置与缺口。

## 1. 为什么必须用户批

源码里已存在大量具体法律主张，但 D8 至今没有产品所有者的真实输入。其中影响最大的是：

| 位置 | 现有表述 | 风险 |
|---|---|---|
| `src/app/(public)/terms/page.tsx:36` | `LokFeel Inc.`，**a Delaware corporation** | 未核实的注册地/公司形态，属于对外法律陈述 |
| `src/app/(public)/privacy/page.tsx:36` | **a company registered in the State of Delaware, USA** | 同上；且隐私政策的"数据控制者"身份须真实 |
| `src/config/brand.ts:23` | `legalName: 'LokFeel Inc.'` | 全站单一来源，改动会牵连所有页面 |
| `src/components/layout/footer.tsx:105` | `© 2026 LokFeel Inc. All rights reserved.` | 版权主体 |
| 邮件模板 3 处 / 法务页 5 处 | `LokFeel Inc. • hello@lokfeel.com`、`noreply@lokfeel.com` | 客服与发件地址是否真实可达未验证 |

**若实际主体与上述表述不符，发布即构成虚假陈述**；若完全一致，也仍需用户提供可查证的批准记录，代理不能自行确认。

## 2. 全量出现位置（12 处，`grep` 实测）

| 文件 | 行 | 用途 |
|---|---|---|
| `src/config/brand.ts` | 23 | `legalName` 单一事实源 |
| `src/components/layout/footer.tsx` | 105 | 全站页脚版权 |
| `src/lib/email.ts` | 201 / 343 / 427 | 交易邮件落款（hello@ / noreply@） |
| `src/app/(public)/terms/page.tsx` | 36 / 135 / 199 / 290 | 服务条款：主体声明、知识产权、赔偿、联系 |
| `src/app/(public)/privacy/page.tsx` | 36 / 294 | 隐私政策：注册地声明、联系 |
| `src/app/(public)/contact/page.tsx` | 110 | 联系页主体名 |
| `src/app/(public)/dmca/page.tsx` | 88 | DMCA 联系 |
| `src/app/(public)/refunds/page.tsx` | 154 | 退款政策联系 |
| `src/app/(public)/cancellations-policy/page.tsx` | 146 | 取消政策联系 |
| `src/app/(public)/content-removal-appeals-policy/page.tsx` | 164 | 申诉政策联系 |

> 计数口径：按**文件**去重为 10 个文件；按出现行计 16 行。全部为对外可见文案或邮件正文，不是注释。

## 3. 需要用户一次性提供的字段（D8 签字项）

| # | 字段 | 用途 | 当前 |
|---|---|---|---|
| 1 | 法定实体全称（与注册证书一致） | 替换/确认 `legalName` | 未批 |
| 2 | 注册地、注册号、公司形态 | 验证/修正 "Delaware corporation" | 未批 |
| 3 | 适用法律与管辖法院 | terms 一致性 | 未批 |
| 4 | 数据控制者名称与隐私联系邮箱 | privacy / DPA | 未批 |
| 5 | 官方客服邮箱 / 工单入口可达性证据 | contact / 邮件落款 | 未批 |
| 6 | 退款与账单的收款主体（Dodo merchant of record 名称） | refunds / 账单 | 未批 |
| 7 | 版权声明主体与年份 | 页脚 | 未批 |
| 8 | 法务确认记录（谁、何时、依据哪份文件批准） | G2/G12 证据链 | 未批 |

## 4. 本轮已做 / 未做

- **已做**：全量定位并登记；把 D8 作为 G2 的阻断项写入验收矩阵与最终签字单；不编造主体。
- **未做（需用户）**：不代填任何字段，不擅自删除 "Delaware" 声明，不把隐私政策的注册地改成"待定"后标 PASS，不验证邮箱可达性（需真实收发）。
- **C-31 关联**：社媒链接可达性另见 `03_FIGMA_IMPLEMENTATION_MAP.md` / `evidence/p0-01-production-risk.json`；`blog.lokfeel.com` 已确认无 DNS 记录并从页脚移除，其余三条记 NOT_TESTED。

## 5. 解锁条件

用户集中批复 D8 的 8 个字段后，按 `brand.ts` 单一事实源统一替换 10 个文件，跑 `verify:brand-scan` + 法务页一致性表 + G2 复验，才可将 G2 从 `BLOCKED` 改判。**批复本身不等于页面已改，改完必须复验。**

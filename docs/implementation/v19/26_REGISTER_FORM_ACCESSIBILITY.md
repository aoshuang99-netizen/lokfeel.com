# V19.5-26 · 注册表单可访问性（WB19-53）

> 文件：`src/app/(auth)/register/page.tsx`｜改造前基线 `6fe9ece`
> 验证：`tests/e2e-ci/register-form.spec.ts`（7 例，公开面，无需登录）

## 1. 改造前的真实状态（读码 + 改造前 DOM 断言）

| 字段 | label | 可访问名 | `aria-describedby` | `aria-invalid` | 错误可达 |
|---|---|---|---|---|---|
| `#reg-name` | ✅ | Name | → `#reg-error`（**不分字段**） | ❌ | 只有页面级横幅 |
| `#reg-email` | ✅ | Email | → `#reg-error` | ❌ | 同上 |
| `#reg-password` | ✅ | Password | → `#reg-error` | ❌ | 同上 |
| `#dob-year` | ✅（`htmlFor` 只指向它） | Date of Birth | ❌ | ❌ | ❌ |
| `#dob-month` | ❌ | **Month**（首个选项文本） | ❌ | ❌ | ❌ |
| `#dob-day` | ❌ | **Day** | ❌ | ❌ | ❌ |
| `#reg-agreeToTerms` | ✅ | I agree to the… | ❌ | ❌ | ❌ |
| `#reg-confirmAge` | ✅ | I confirm… | ❌ | ❌ | ❌ |

三个具体缺陷：

1. **描述张冠李戴**：所有错误都进同一个 `#reg-error`，三个输入框同时指向它。用户填对了姓名、只因密码太短失败时，
   读屏会把「Password must be at least 8 characters」念给**姓名框**听；而真正出错的 DOB 与两个勾选框**完全没有关联**。
2. **`htmlFor` 只能标一个控件**：`Date of Birth` 的 `label` 指向年份，月/日的可访问名退化成一月/二号之类的选项文本。
3. **校验失败不送焦点**：只有红框，键盘用户要从提交按钮一路 Shift+Tab 摸回去找第一个错误。

另有一处**分流逻辑是死的**：`error.includes("X")` 把「带字母 X 的错误」渲染到社交登录按钮下面并从主错误区移除。
全仓没有任何 `setError` 产出含 `X` 的文案，这个分支从未被执行过 —— 但它对任意含 X 的报错都会误判。

## 2. 改造后

| 能力 | 实现 |
|---|---|
| 字段级错误 | `fieldError: {field, message}`；`validateForm()` 返回**字段 + 文案**，不是一句字符串 |
| 错误节点 | 每个字段一个 `<p id="reg-*-error" role="alert">`，**只在有错时渲染** |
| 关联 | 该字段 `aria-describedby` → 自己的错误节点；`aria-invalid` 同时置 `true` |
| 密码帮助 | 常驻 `#reg-password-help`（"At least 8 characters."）；有错时 `describedby="reg-password-help reg-password-error"`（**帮助 + 错误都在**，因为两条信息都对用户有用） |
| DOB 组 | `role="group"` + `aria-labelledby="reg-dob-label"`（可见标题）；三个 `select` 各自 `aria-label="Birth year/month/day"` |
| 勾选框 | 两个 checkbox 各自关联自己的错误节点 |
| 焦点引导 | 校验失败 → `requestAnimationFrame` 后把焦点送到该字段（放到下一帧是必须的：错误节点要等这次渲染提交后才存在，先 focus 会让读屏读到上一帧的 `aria-describedby`） |
| 撤错 | 改动该字段即清除它的错误（`handleChange` + `clearDobError`），不长期挂红字 |
| 页面级错误 | 只剩服务端/网络错误，单一 `#reg-error`，删除 `includes("X")` 分流 |

## 3. 字段 × 关联对照（改后）

| 字段 | 错误节点 id | 帮助节点 id | 触发条件 |
|---|---|---|---|
| name | `reg-name-error` | — | 空 |
| email | `reg-email-error` | — | 空 / 格式 |
| password | `reg-password-error` | `reg-password-help` | < 8 字符 |
| dob（组） | `reg-dob-error` | — | 未选全 / < 18 岁 |
| agreeToTerms | `reg-terms-error` | — | 未勾 |
| confirmAge | `reg-age-error` | — | 未勾 |

## 4. 多步流程

两阶段：`form` → `verify`（6 格验证码）。

| 流程 | 断言 |
|---|---|
| 前进 | 填全 → 点 Send Verification Code → 出现 `Verify Your Email` 标题 + 6 个带名字的 OTP 格 |
| 输入推进 | 第 1 格填 `1` → 焦点自动到第 2 格 |
| 返回 | 点 `← Back to registration` → 回表单，且 `Name` / `Birth year` 的值仍在（`localStorage` 恢复） |
| 提交失败 | 页面级 `#reg-error` 以 `role="alert"` 播报（服务端错误路径） |

> 发码接口在用例里用 `page.route` 拦截：本组测的是**客户端多步语义**，不是邮件服务。
> 真实发信需要 SMTP 凭据，属另一条链路（其自身门禁不在本文件射程内）。

## 5. 未做 / 遗留

| 编号 | 事项 | 原因 |
|---|---|---|
| R1 | 错误摘要（error summary）替代逐字段跳转 | 逐字段跳转已满足 WCAG 3.3.1；摘要对 6 字段的表单收益有限，等真实用户反馈再决定 |
| R2 | `gender` / `sexuality` 两步在旧版注册流里存在，本页已并入单页 | 本次未改结构，仅补语义；若恢复多步再补对应关联 |
| R3 | 服务端返回的字段级错误（如「邮箱已注册」）未映射到 `#reg-email` | 服务端目前只回整句 message；映射需要接口层提供 `field` 字段，属接口契约变更 |

/**
 * ⚠️ 兼容别名 —— 本文件**不含实现**，转发到规范实现。
 *
 * 规范实现：`src/app/api/auth/oauth/twitter/signin/route.ts`
 *
 * ## 为什么这条路径不能删
 *
 * `/api/auth/twitter/signin` 是**当前实际在用**的入口，至少 4 处引用它：
 *   - `src/app/(auth)/register/page.tsx`（注册页 Twitter 注册）
 *   - `src/components/auth/quick-login-modal.tsx`
 *   - `src/components/auth/quick-signup-modal.tsx`
 *   - `src/app/api/auth/[...nextauth]/route.ts`（signin 转发目标）
 *   - `scripts/check-oauth.sh`（断言该端点返回 302）
 * 而登录页走的是 `/api/auth/oauth/twitter/signin`。**两条路径都必须可用。**
 *
 * ## 为什么改成转发
 *
 * 历史上这两条路径各有一份**独立实现**（119 行 × 2），只差语句顺序。
 * 在 OAuth 这种「授权侧声明的 `redirect_uri` 必须与换取侧逐字一致」
 * （RFC 6749 §4.1.3）的流程里，双实现是净负债：只改一份就会产生不一致，
 * 表现为「用户授权成功却登录失败」—— 本项目真的踩过这个坑，
 * 见 `src/lib/auth/twitter-oauth.ts` 中 `DEFAULT_TWITTER_CALLBACK_PATH` 的注释。
 *
 * 现在这里是**同一函数对象**的转出，两条路由共用一份逻辑，不可能再漂移。
 *
 * @see src/lib/auth/twitter-oauth.ts —— redirect_uri 的单一来源
 */
import { GET as canonicalGET } from "@/app/api/auth/oauth/twitter/signin/route";

export const dynamic = "force-dynamic";

export const GET = canonicalGET;

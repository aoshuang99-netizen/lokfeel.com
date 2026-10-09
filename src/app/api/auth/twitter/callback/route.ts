/**
 * ⚠️ 兼容别名 —— 本文件**不含实现**，转发到规范实现。
 *
 * 规范实现：`src/app/api/auth/oauth/twitter/callback/route.ts`
 *
 * ## 为什么这条路径不能删
 *
 * 它是 `TWITTER_OAUTH_CALLBACK_PATH` 环境变量的**可选取值**：
 * `lib/auth/twitter-oauth.ts` 的 `twitterCallbackPath()` 在 env 命中
 * `/api/auth/twitter/callback` 时就要求这条路由存在。生产当前**未设**该变量
 * （生效默认 `/api/auth/oauth/twitter/callback`），所以这条路由暂时不可达 ——
 * 但只要有人在 Twitter 开发者后台登记了旧地址并设上 env，它就必须能接住。
 *
 * ⚠️ 也正因为「授权侧与换取侧的 `redirect_uri` 必须逐字一致」，历史上
 * signin 声明 `oauth/twitter/callback` 却落到这条回调、用另一个 `redirect_uri`
 * 换令牌 → **该链路永远换不到令牌**。见 `lib/auth/twitter-oauth.ts` 注释。
 *
 * ## 为什么改成转发
 *
 * 本文件原为 312 行**独立实现**，与规范实现**逐字节相同**（diff 为空）。
 * 双份实现意味着改一处忘一处。改为转出后，两条路由共用一份逻辑。
 *
 * @see src/lib/auth/twitter-oauth.ts —— redirect_uri 的单一来源
 */
import { GET as canonicalGET } from "@/app/api/auth/oauth/twitter/callback/route";

export const dynamic = "force-dynamic";

export const GET = canonicalGET;

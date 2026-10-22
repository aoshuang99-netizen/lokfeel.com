/**
 * 构建身份 —— 「线上跑的到底是哪个提交」（OPS-11）
 * ═══════════════════════════════════════════════════════════════════════
 * 起因（真实事故形状，不是假想）
 * ------------
 * 2026-10-22 复测生产 `/api/health`，`version` 字段返回 `"unknown"`：
 *
 *     version: process.env.npm_package_version || "unknown"
 *
 * `npm_package_version` 只在 **通过 npm 脚本启动** 时存在。Netlify 的函数运行时
 * 直接起 Node，不走 npm ⇒ 这个字段在生产上**永远是 unknown**。
 *
 * 后果不是"少一个字段"，而是**无法回答最基本的问题**：
 *   · 刚发的那版上去了吗？
 *   · 线上这个 bug 是旧代码还是新代码？
 *   · 回滚该回哪个提交？
 * 只能靠"我记得我刚才 push 了"来判断 —— 而记忆不是证据。
 *
 * 为什么不用运行时读文件
 * ------------
 * Netlify 的函数包是构建产物，`package.json` 与 `.git` 都不一定在里面。
 * 唯一可靠的时机是**构建时**：在 `next.config.ts` 里把值算好，
 * 通过 `env` 内联进产物。所以本模块只负责**读与校验**，
 * 计算发生在 `next.config.ts`（见其中 `BUILD_INFO`）。
 *
 * 🔴 校验而不是照抄
 * ------------
 * 构建环境里 `COMMIT_REF` 可能是空串、`"HEAD"`、或一整个 ref 路径。
 * 照抄进 JSON 就会得到"看起来像提交号、其实不是"的东西 —— 比 unknown 更糟。
 * 因此这里只接受 7–40 位十六进制，其余一律回落 `unknown`，并如实标注来源。
 */

/** 只读环境视图（便于单测注入，不依赖全局 process.env） */
export type BuildEnv = Readonly<Record<string, string | undefined>>;

export interface BuildInfo {
  /** `package.json` 的 version；缺失时 `unknown` */
  version: string;
  /** 7 位短提交号；**无法确认时 `unknown`**，绝不猜 */
  commit: string;
  /** 构建时间（ISO 8601）；无法确认时 `unknown` */
  builtAt: string;
  /**
   * 这个 commit 值是从哪儿来的 —— 出问题时能判断"是构建没给"还是"我读错了"。
   * `env` = 平台注入（Netlify `COMMIT_REF` / CI `GITHUB_SHA`）
   * `git` = 构建机上直接读 `.git`
   */
  commitSource: 'env' | 'git' | 'none';
}

const SHA = /^[0-9a-f]{7,40}$/i;

/** `COMMIT_REF` 可能是 `refs/heads/main`、`HEAD`、空串 —— 只认真正的 sha */
export function normalizeCommit(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const short = v.slice(0, 7).toLowerCase();
  if (!SHA.test(v) || !SHA.test(short)) return null;
  return short;
}

/** ISO 时间校验：能 `new Date()` 且不是 Invalid Date，同时要求是 ISO 形状 */
export function normalizeBuiltAt(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * 从环境视图读出构建身份。
 *
 * 优先级：`NEXT_PUBLIC_BUILD_COMMIT`（构建设置的最终值）→ `COMMIT_REF`（Netlify）
 * → `GITHUB_SHA`（GitHub Actions）。三者都没有 ⇒ `unknown` + `commitSource: 'none'`。
 */
export function readBuildInfo(env: BuildEnv = process.env): BuildInfo {
  const commitFromEnv =
    normalizeCommit(env.NEXT_PUBLIC_BUILD_COMMIT) ??
    normalizeCommit(env.COMMIT_REF) ??
    normalizeCommit(env.GITHUB_SHA);

  const version = (env.NEXT_PUBLIC_BUILD_VERSION ?? env.npm_package_version ?? '').trim();
  const declared = (env.NEXT_PUBLIC_BUILD_COMMIT_SOURCE ?? '').trim();

  return {
    version: version || 'unknown',
    commit: commitFromEnv ?? 'unknown',
    // 构建时间必须是**构建时**写死的那一个，而不是运行时 now() —— 后者会让每次探活
    // 都返回"刚刚"，等于告诉运维"这版很新"。
    builtAt: normalizeBuiltAt(env.NEXT_PUBLIC_BUILD_TIME) ?? 'unknown',
    commitSource: !commitFromEnv
      ? 'none'
      : declared === 'git' || declared === 'env'
        ? declared
        : 'env',
  };
}

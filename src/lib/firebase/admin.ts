/**
 * Firebase Admin SDK — Server-side only
 *
 * Verifies Firebase ID tokens from the bridge API.
 * Uses service account credentials from environment variables.
 *
 * NEVER import this file in client components.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 设计约定一：firebase-admin 一律**惰性加载**，绝不在模块顶层 import/require
 * ════════════════════════════════════════════════════════════════════════════
 * 本文件被 `/api/diagnostic/firebase` 与 `/api/health` import，而这两个 import 点
 * 都**没有** try/catch 兜底。只要模块求值阶段抛错，整条路由立刻 500。
 *
 * 线上真实事故（2026-09-29，firebase-admin 13 → 14）：
 *   旧代码在模块顶层 `import * as admin from 'firebase-admin'` 并立即
 *   `initFirebaseAdmin()`；升级到 v14 后 `/api/diagnostic/firebase` 从 **403 变成 500**
 *   —— 本地（tsc 0 错误、Node 22 + 生产真实凭证跑冒烟全通过）无法复现，
 *   属于"函数包/运行时"层面的加载问题。这类问题在 firebase-admin 被列入
 *   next.config.ts 的 `serverExternalPackages`（不进打包器）时尤其隐蔽：
 *   **构建期不报错，只有运行时才炸**。
 *
 * 因此这里的约定是：把"包能不能加载"从**模块加载期**推迟到**调用期**，
 * 并把它显式收敛成一个可上报的状态（`FirebaseAdminStatus`）。
 * 这样无论 firebase-admin 是否可用，路由都不会被拖垮。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 设计约定二：firebase-admin 14 的破坏性变更（升级时勿改回 v13 写法）
 * ════════════════════════════════════════════════════════════════════════════
 * v14 把根入口的导出收窄为 11 个成员：
 *   initializeApp, getApp, getApps, deleteApp, applicationDefault,
 *   cert, refreshToken, FirebaseError, FirebaseAppError, AppErrorCode, SDK_VERSION
 *
 *   · `admin.apps`             → `getApps()`（根入口）
 *   · `admin.credential.cert`  → `cert`（已提升为根入口的顶层函数）
 *   · `admin.auth()`           → `getAuth()`，来自子路径 `firebase-admin/auth`
 *   · `admin.auth.DecodedIdToken` / `admin.auth.UserRecord`
 *                              → `firebase-admin/auth` 的具名类型导出
 */

// 纯类型导入：编译后被完全擦除，不会产生任何运行时 require
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";

export interface FirebaseAdminStatus {
  /** firebase-admin 包本身是否加载成功（false = 函数包里缺包/加载报错） */
  sdkLoaded: boolean;
  /** 凭证是否齐全（FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY） */
  configured: boolean;
  /** 是否已完成 initializeApp */
  initialized: boolean;
  /** 已初始化的 app 数量（v14 用 getApps() 取，不再有 admin.apps） */
  appCount: number;
  /** 加载或初始化失败的原因摘要（仅供服务端日志/管理员诊断，勿公开） */
  error?: string;
}

const status: FirebaseAdminStatus = {
  sdkLoaded: false,
  configured: false,
  initialized: false,
  appCount: 0,
};

let loadPromise: Promise<FirebaseAdminStatus> | null = null;

function readCredentials(): { projectId?: string; clientEmail?: string; privateKey?: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  status.configured = Boolean(projectId && clientEmail && privateKey);
  return { projectId, clientEmail, privateKey };
}

async function loadAndInit(): Promise<FirebaseAdminStatus> {
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<FirebaseAdminStatus> => {
    const { projectId, clientEmail, privateKey } = readCredentials();

    try {
      // 动态导入：只有真正被调用时才加载 firebase-admin。
      // 注意**无论是否配置凭证都要尝试加载** —— 这样 sdkLoaded 才是纯粹的
      // "这个包在当前运行时能不能加载"信号，而不是"有没有配环境变量"。
      // 这两种情况的排查方向完全不同（缺包 vs 忘配 env），必须能区分开。
      const adminSdk = await import("firebase-admin");
      const { cert, getApps, initializeApp } = adminSdk;
      status.sdkLoaded = true;

      // 显式逐项判空（而不是只看 status.configured）：这样 TS 才能把下面三个变量
      // 收窄成 string，cert() 的参数类型才成立。status.configured 已在
      // readCredentials() 里同步维护，两者不会不一致。
      if (!projectId || !clientEmail || !privateKey) {
        console.warn(
          "[Firebase Admin] Missing env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY). Firebase Auth bridge will be disabled."
        );
        return status;
      }

      if (getApps().length === 0) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            // 环境变量里常把换行写成字面量 \n（Vercel/Netlify 面板常见），这里还原
            privateKey: privateKey!.replace(/\\n/g, "\n"),
          }),
        });
      }

      status.appCount = getApps().length;
      status.initialized = status.appCount > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.sdkLoaded = false;
      status.initialized = false;
      status.appCount = 0;
      status.error = message;
      console.error("[Firebase Admin] SDK load/init failed:", message);
    }

    return status;
  })();

  return loadPromise;
}

/**
 * Firebase Admin 的加载/初始化状态。
 *
 * 这是本模块**唯一**的对外状态口径：调用方不再直接触碰 firebase-admin 的任何
 * 根成员（v14 已删除 `admin.apps` / `admin.credential` / `admin.auth`）。
 */
export async function getFirebaseAdminStatus(): Promise<FirebaseAdminStatus> {
  // 必须 await（即使加载已完成也要走一遍）：并发调用时后到的一方如果直接读 status，
  // 可能读到"加载中"的中间态（sdkLoaded=false），从而给出误导性的诊断结论。
  // loadAndInit() 内部对 loadPromise 做了缓存，重复调用不会重复加载。
  await loadAndInit();
  return { ...status };
}

/**
 * Verify a Firebase ID token and return decoded user info.
 * Returns null if verification fails or Firebase Admin is not configured.
 */
export async function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken | null> {
  try {
    const adminStatus = await getFirebaseAdminStatus();
    if (!adminStatus.initialized) {
      console.error("[Firebase Admin] Not initialized — missing env vars or SDK unavailable");
      return null;
    }
    const { getAuth } = await import("firebase-admin/auth");
    return await getAuth().verifyIdToken(idToken);
  } catch (error) {
    console.error("[Firebase Admin] Token verification failed:", error);
    return null;
  }
}

/**
 * Get Firebase user record by UID.
 * Returns null if Firebase Admin is not configured or user not found.
 * Use this as fallback when DecodedIdToken lacks email.
 */
export async function getFirebaseUser(uid: string): Promise<UserRecord | null> {
  try {
    const adminStatus = await getFirebaseAdminStatus();
    if (!adminStatus.initialized) return null;
    const { getAuth } = await import("firebase-admin/auth");
    return await getAuth().getUser(uid);
  } catch (error) {
    console.error("[Firebase Admin] getUser failed:", error);
    return null;
  }
}

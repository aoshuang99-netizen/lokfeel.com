/**
 * Firebase Admin SDK — Server-side only
 *
 * Verifies Firebase ID tokens from the bridge API.
 * Uses service account credentials from environment variables.
 *
 * NEVER import this file in client components.
 *
 * ⚠️ firebase-admin 14 的破坏性变更（本文件已适配，升级时勿改回旧写法）
 * ---------------------------------------------------------------------------
 * v14 收窄了根入口 `firebase-admin` 的导出，只保留 11 个成员：
 *   initializeApp, getApp, getApps, deleteApp, applicationDefault,
 *   cert, refreshToken, FirebaseError, FirebaseAppError, AppErrorCode, SDK_VERSION
 *
 * 也就是说下面这些 v13 的用法在 v14 **全部失效**（且是运行时才炸，不是编译期）：
 *   · `admin.apps`             → 改用 `getApps()`（根入口）
 *   · `admin.credential.cert`  → 改用 `cert`（已提升为根入口的顶层函数）
 *   · `admin.auth()`           → 改用 `getAuth()`，来自子路径 `firebase-admin/auth`
 *   · `admin.auth.DecodedIdToken` / `admin.auth.UserRecord`
 *                              → 变为 `firebase-admin/auth` 的具名类型导出
 *
 * 注意本文件在**模块顶层**就会调用 initFirebaseAdmin()，因此上面任何一处用错都会
 * 让整个模块 import 阶段抛错 —— 而 import 它的路由没有 try/catch 兜底，会直接 500。
 */

import { cert, getApps, initializeApp } from "firebase-admin";
import { getAuth, type DecodedIdToken, type UserRecord } from "firebase-admin/auth";

function initFirebaseAdmin() {
  if (getApps().length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[Firebase Admin] Missing env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY). Firebase Auth bridge will be disabled."
    );
    return;
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // Handle \n escape in env vars (Vercel stores literal \n)
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

initFirebaseAdmin();

/**
 * Firebase Admin 是否已初始化。
 *
 * v14 移除了 `admin.apps`，改为用 `getApps()` 判断；对外暴露成函数，
 * 避免调用方再去触碰已不存在的根入口成员。
 */
export function isFirebaseAdminInitialized(): boolean {
  return getApps().length > 0;
}

/**
 * 已初始化的 Firebase App 数量（供诊断端点展示）。
 */
export function getFirebaseAdminAppCount(): number {
  return getApps().length;
}

/**
 * Verify a Firebase ID token and return decoded user info.
 * Returns null if verification fails or Firebase Admin is not configured.
 */
export async function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken | null> {
  try {
    if (!isFirebaseAdminInitialized()) {
      console.error("[Firebase Admin] Not initialized — missing env vars");
      return null;
    }
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
    if (!isFirebaseAdminInitialized()) return null;
    return await getAuth().getUser(uid);
  } catch (error) {
    console.error("[Firebase Admin] getUser failed:", error);
    return null;
  }
}

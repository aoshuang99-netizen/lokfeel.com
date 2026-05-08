/**
 * Firebase Admin SDK — Server-side only
 *
 * Verifies Firebase ID tokens from the bridge API.
 * Uses service account credentials from environment variables.
 *
 * NEVER import this file in client components.
 */

import * as admin from "firebase-admin";

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[Firebase Admin] Missing env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY). Firebase Auth bridge will be disabled."
    );
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      // Handle \n escape in env vars (Vercel stores literal \n)
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

initFirebaseAdmin();

export const firebaseAdmin = admin;

/**
 * Verify a Firebase ID token and return decoded user info.
 * Returns null if verification fails or Firebase Admin is not configured.
 */
export async function verifyFirebaseToken(idToken: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    if (!admin.apps.length) {
      console.error("[Firebase Admin] Not initialized — missing env vars");
      return null;
    }
    return await admin.auth().verifyIdToken(idToken);
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
export async function getFirebaseUser(uid: string): Promise<admin.auth.UserRecord | null> {
  try {
    if (!admin.apps.length) return null;
    return await admin.auth().getUser(uid);
  } catch (error) {
    console.error("[Firebase Admin] getUser failed:", error);
    return null;
  }
}

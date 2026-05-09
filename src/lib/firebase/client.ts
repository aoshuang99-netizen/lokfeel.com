/**
 * Firebase Client SDK — Auth only (Runtime Config)
 *
 * Fetches Firebase config from /api/config/firebase at runtime.
 * This is necessary because NEXT_PUBLIC_* env vars may be empty at build time
 * on Vercel (the build process sometimes cannot read encrypted env vars).
 * Server-side env vars are always available at request time.
 *
 * Only initializes Firebase Auth module to keep bundle size minimal.
 * Supported providers: Google, Twitter/X
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, TwitterAuthProvider, type Auth } from "firebase/auth";

// ─── Runtime config fetch (cached after first call) ───
let cachedConfig: Record<string, string> | null = null;
let configPromise: Promise<Record<string, string> | null> | null = null;

async function fetchFirebaseConfig(): Promise<Record<string, string> | null> {
  if (cachedConfig) return cachedConfig;
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const res = await fetch("/api/config/firebase");
      const data = await res.json();
      if (data.valid && data.config) {
        cachedConfig = data.config;
        return cachedConfig;
      }
      console.warn("[Firebase Client] Config API returned invalid config");
      return null;
    } catch (e) {
      console.error("[Firebase Client] Failed to fetch config from API:", e);
      return null;
    }
  })();

  return configPromise;
}

// ─── Lazy initialization ───
let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _googleProvider: GoogleAuthProvider | null = null;
let _twitterProvider: TwitterAuthProvider | null = null;
let initPromise: Promise<boolean> | null = null;

/**
 * Initialize Firebase with runtime config.
 * Returns true if initialization succeeded.
 */
async function ensureInitialized(): Promise<boolean> {
  if (_app) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Try runtime config first
    const runtimeConfig = await fetchFirebaseConfig();

    // Build config: prefer runtime config, fallback to NEXT_PUBLIC_ env vars
    const firebaseConfig = {
      apiKey: runtimeConfig?.apiKey || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
      authDomain: runtimeConfig?.authDomain || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
      projectId: runtimeConfig?.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
      storageBucket: runtimeConfig?.storageBucket || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: runtimeConfig?.messagingSenderId || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
      appId: runtimeConfig?.appId || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
    };

    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.error("[Firebase Client] No valid Firebase config available (apiKey and projectId are required)");
      return false;
    }

    try {
      _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      _auth = getAuth(_app);
      _googleProvider = new GoogleAuthProvider();
      _googleProvider.addScope("email");
      _googleProvider.addScope("profile");
      _twitterProvider = new TwitterAuthProvider();
      return true;
    } catch (e) {
      console.error("[Firebase Client] Initialization failed:", e);
      return false;
    }
  })();

  return initPromise;
}

// ─── Public async getters ───

export async function getFirebaseAuth(): Promise<Auth | null> {
  const ok = await ensureInitialized();
  return ok ? _auth : null;
}

export async function getGoogleProvider(): Promise<GoogleAuthProvider | null> {
  const ok = await ensureInitialized();
  return ok ? _googleProvider : null;
}

export async function getTwitterProvider(): Promise<TwitterAuthProvider | null> {
  const ok = await ensureInitialized();
  return ok ? _twitterProvider : null;
}

/**
 * Check if Firebase is available (non-blocking).
 */
export function isFirebaseAvailable(): boolean {
  return _app !== null;
}

/**
 * LokFeel Admin — Permission Middleware
 *
 * withPermission() — Higher-order function for Next.js Route Handlers
 * Checks RBAC permissions before allowing API access.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getToken } from "next-auth/jwt";
import { getDb } from "@/lib/db";
import { forbidden, unauthorized, serverError } from "@/lib/api-response";
import { ALL_PERMISSION_CODES, PERMISSIONS, type PermissionCode } from "@/lib/admin-permissions";
import { ROLE_PERMISSIONS } from "@/lib/admin-roles";
import { writeAudit } from "@/lib/admin-audit";

// ============================================================================
// Types
// ============================================================================

interface PermissionOptions {
  dangerous?: boolean;    // Mark as dangerous for audit logging
  confirmation?: boolean; // Requires frontend confirmation
}

type HandlerFunction = (req: NextRequest, context: { userId: string; session: any; params?: any }) => Promise<NextResponse>;

// Next.js 15 compatible route handler type
type Nextjs15RouteHandler = (
  request: NextRequest,
  context: { params: Promise<any> }
) => Promise<Response | void> | Response | void;

// WrappedHandler is now compatible with Next.js 15
type WrappedHandler = Nextjs15RouteHandler;

// ============================================================================
// Permission Check Cache (in-memory, resets per server restart)
// ============================================================================

const permissionCache = new Map<string, { permissions: Set<string>; expiresAt: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

// ============================================================================
// admin_session Cookie 解析 — 支持 demo 管理员登录
// ============================================================================

interface AdminSessionData {
  username: string;
  role: string;
  exp: number;
}

/**
 * 从 admin_session cookie 中解析出用户信息
 */
function parseAdminSession(req: NextRequest): AdminSessionData | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );

  const adminSession = cookies["admin_session"];
  if (!adminSession) return null;

  try {
    const data = JSON.parse(Buffer.from(adminSession, "base64").toString()) as AdminSessionData;
    if (!data.username || !data.role || !data.exp) return null;
    if (data.exp < Date.now()) return null; // 已过期
    return data;
  } catch {
    return null;
  }
}

/**
 * 从 admin_session 获取权限（demo 管理员走此路径）
 */
function resolveDemoAdminPermissions(role: string): Set<string> {
  if (role === "SUPER_ADMIN") {
    return new Set(ALL_PERMISSION_CODES);
  }
  const rolePerms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  if (rolePerms) {
    return new Set(rolePerms);
  }
  return new Set();
}

const DEMO_ADMIN_SESSION_KEY = "demo:";

// ============================================================================
// Core Permission Resolution
// ============================================================================

/**
 * Resolve all permissions for a given user.
 * Checks AdminUserRole (roles) + AdminRolePermission (role→permissions) + CustomRole.
 * Also supports demo admin sessions via admin_session cookie.
 */
export async function resolveUserPermissions(userId: string, role?: string): Promise<Set<string>> {
  // Demo admin: username 前缀为 "demo:" 表示使用 admin_session cookie 的权限
  if (userId.startsWith(DEMO_ADMIN_SESSION_KEY)) {
    return resolveDemoAdminPermissions(role || "SUPER_ADMIN");
  }

  // Check cache
  const cached = permissionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const db = getDb();

  try {
    // 1. Get all admin roles assigned to this user
    const userRoles = await db.adminUserRole.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: {
        role: true,
        customRole: {
          select: {
            permissions: true, // JSON string of permission codes
          },
        },
      },
    });

    const permissions = new Set<string>();

    for (const userRole of userRoles) {
      // SUPER_ADMIN gets everything
      if (userRole.role === "SUPER_ADMIN") {
        for (const perm of ALL_PERMISSION_CODES) {
          permissions.add(perm);
        }
        // No need to check further
        break;
      }

      // Get permissions from role definition (in-memory)
      const rolePerms = ROLE_PERMISSIONS[userRole.role];
      if (rolePerms) {
        for (const perm of rolePerms) {
          permissions.add(perm);
        }
      }

      // Get permissions from custom role
      if (userRole.customRole?.permissions) {
        try {
          const customPerms: string[] = JSON.parse(userRole.customRole.permissions);
          for (const perm of customPerms) {
            permissions.add(perm);
          }
        } catch {
          // Invalid JSON in custom role permissions — skip
        }
      }
    }

    // Cache the result
    permissionCache.set(userId, {
      permissions,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return permissions;
  } catch {
    // On error, return empty permissions (deny by default)
    return new Set();
  }
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(userId: string, permission: string, role?: string): Promise<boolean> {
  const permissions = await resolveUserPermissions(userId, role);
  return permissions.has(permission);
}

/**
 * Check if a user has any of the given permissions.
 */
export async function hasAnyPermission(userId: string, permissions: string[], role?: string): Promise<boolean> {
  const userPerms = await resolveUserPermissions(userId, role);
  return permissions.some(p => userPerms.has(p));
}

/**
 * Clear the permission cache for a user (call after role changes).
 */
export function clearPermissionCache(userId?: string): void {
  if (userId) {
    permissionCache.delete(userId);
  } else {
    permissionCache.clear();
  }
}

// ============================================================================
// withPermission — Higher-Order Function
// ============================================================================

/**
 * Wraps a Next.js Route Handler with permission checking.
 *
 * Usage:
 * ```ts
 * export const GET = withPermission('user.view')(async (req, ctx) => {
 *   // Only reached if user has 'user.view' permission
 *   return success(users);
 * });
 *
 * export const DELETE = withPermission('user.delete', { dangerous: true })(
 *   async (req, ctx) => {
 *     // Permission check + audit logging
 *     return success({ deleted: true });
 *   }
 * );
 * ```
 */
export function withPermission(
  permission: string,
  options: PermissionOptions = {}
): (handler: HandlerFunction) => Nextjs15RouteHandler {
  return (handler: HandlerFunction): Nextjs15RouteHandler => {
    return async (req: NextRequest, _context?: { params: Promise<any> }) => {
      // 1. Check authentication
      // IMPORTANT: For admin API routes (/api/admin/*), prioritize admin_session cookie
      // over NextAuth JWT to avoid auth identity conflicts

      let userId: string | undefined;
      let userRole: string | undefined;
      let session: any = null;
      const isAdminRoute = req.nextUrl.pathname.startsWith("/api/admin");

      // Admin routes: check admin_session cookie FIRST
      if (isAdminRoute) {
        const adminSession = parseAdminSession(req);
        if (adminSession) {
          userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
          userRole = adminSession.role;
          session = { user: { id: userId, role: userRole, name: adminSession.username } };
        }
      }

      // Method 1: getToken() from next-auth/jwt — reads JWT from cookie, works everywhere
      if (!userId) {
        try {
          // Try multiple cookie names: next-auth (v4), authjs (v5), and Secure variants
          const cookieNames = [
            "authjs.session-token",          // NextAuth v5 (Auth.js)
            "__Secure-authjs.session-token", // NextAuth v5 Secure
            "next-auth.session-token",       // NextAuth v4
            "__Secure-next-auth.session-token", // NextAuth v4 Secure
          ];

          let token = null;
          for (const cookieName of cookieNames) {
            const found = await getToken({ req, secret: process.env.AUTH_SECRET, cookieName });
            if (found) {
              token = found;
              break;
            }
          }
          if (token) {
            // next-auth/jwt stores the `id` from jwt() callback at token.id
            userId = (token as any).id || (token as any).sub;
            userRole = (token as any).role;
            session = {
              user: {
                id: userId,
                role: userRole,
                name: (token as any).name,
                email: (token as any).email,
                image: (token as any).picture,
              }
            };
          }
        } catch {
          // getToken() failed — continue to next auth method
        }
      }

      // Method 2: auth() fallback — reads from session (may not have user.id in API routes)
      if (!userId) {
        try {
          const sess = await auth();
          if (sess?.user) {
            const uid = (sess.user as any)?.id || (sess.user as any)?.sub;
            if (uid) {
              userId = uid as string;
              userRole = (sess.user as any)?.role;
              session = sess;
            } else {
              // Session exists but no user.id — try to get from token directly
              const tokenFromSess = (sess as any)?.token;
              if (tokenFromSess) {
                userId = tokenFromSess.id || tokenFromSess.sub;
                userRole = tokenFromSess.role;
                session = sess;
              }
            }
          }
        } catch {
          // auth() failed — continue to next auth method
        }
      }

      // Method 3: admin_session cookie (demo admin / 非 NextAuth users) — for non-admin routes
      if (!userId) {
        const adminSession = parseAdminSession(req);
        if (adminSession) {
          userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
          userRole = adminSession.role;
          session = { user: { id: userId, role: userRole, name: adminSession.username } };
        }
      }

      if (!userId) {
        return unauthorized();
      }

      // 2. Check RBAC permission
      const hasAccess = await hasPermission(userId, permission, userRole);

      if (!hasAccess) {
        console.error(`[RBAC] Access denied: ${req.method} ${req.nextUrl.pathname} | userId=${userId} | role=${userRole} | required=${permission}`);
        // Log the denied access attempt
        await writeAudit({
          actorId: userId,
          category: "RBAC",
          action: "access_denied",
          targetType: "API",
          targetId: `${req.method} ${req.nextUrl.pathname}`,
          reason: `Missing permission: ${permission}`,
          request: req,
        }).catch(() => {}); // Don't let audit failure block the response

        return forbidden(`You do not have permission: ${permission}`);
      }

      // 3. Log dangerous operations
      if (options.dangerous) {
        await writeAudit({
          actorId: userId,
          category: "RBAC",
          action: "dangerous_operation",
          targetType: "API",
          targetId: `${req.method} ${req.nextUrl.pathname}`,
          reason: `Dangerous operation with permission: ${permission}`,
          request: req,
        }).catch(() => {});
      }

      // 4. Execute handler
      try {
        return await handler(req, { userId, session, ..._context });
      } catch (handlerError) {
        console.error(`[RBAC] Handler error: ${req.method} ${req.nextUrl.pathname}`, handlerError);
        return serverError("Internal server error");
      }
    };
  };
}

/**
 * Require any of the listed permissions (OR logic).
 */
export function withAnyPermission(
  permissions: string[],
  options: PermissionOptions = {}
): (handler: HandlerFunction) => Nextjs15RouteHandler {
  return (handler: HandlerFunction): Nextjs15RouteHandler => {
    return async (req: NextRequest, _context?: { params: Promise<any> }) => {
      // Admin routes: check admin_session cookie FIRST
      const isAdminRoute = req.nextUrl.pathname.startsWith("/api/admin");
      let session = await auth();
      let userId = (session?.user as any)?.id;
      let userRole = (session?.user as any)?.role;

      if (isAdminRoute && !userId) {
        const adminSession = parseAdminSession(req);
        if (adminSession) {
          userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
          userRole = adminSession.role;
          session = { user: { id: userId, role: userRole, name: adminSession.username } } as any;
        }
      }

      if (!userId) {
        try {
          const token = await getToken({ req, secret: process.env.AUTH_SECRET });
          if (token) {
            userId = (token as any).id;
            userRole = (token as any).role;
            session = { user: { id: userId, role: userRole } } as any;
          }
        } catch {
          // getToken() failed — continue to admin_session fallback
        }
      }

      // admin_session cookie fallback
      if (!userId) {
        const adminSession = parseAdminSession(req);
        if (adminSession) {
          userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
          userRole = adminSession.role;
          session = { user: { id: userId, role: userRole, name: adminSession.username } } as any;
        }
      }

      if (!userId) {
        return unauthorized();
      }
      const hasAccess = await hasAnyPermission(userId, permissions, userRole);

      if (!hasAccess) {
        console.error(`[RBAC] Access denied (anyOf): ${req.method} ${req.nextUrl.pathname} | userId=${userId} | required=${permissions.join(",")}`);
        return forbidden(`You do not have any of the required permissions: ${permissions.join(", ")}`);
      }

      try {
        return await handler(req, { userId, session, ..._context });
      } catch (handlerError) {
        console.error(`[RBAC] Handler error: ${req.method} ${req.nextUrl.pathname}`, handlerError);
        return serverError("Internal server error");
      }
    };
  };
}

/**
 * Super Admin only — no permission check needed, just auth.
 */
export function withAdmin(handler: HandlerFunction): Nextjs15RouteHandler {
  return async (req: NextRequest, _context?: { params: Promise<any> }) => {
    // Admin routes: check admin_session cookie FIRST
    const isAdminRoute = req.nextUrl.pathname.startsWith("/api/admin");

    // Auth check with getToken fallback
    let session = await auth();
    let userId = (session?.user as any)?.id;
    let userRole = (session?.user as any)?.role;

    if (isAdminRoute && !userId) {
      const adminSession = parseAdminSession(req);
      if (adminSession) {
        userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
        userRole = adminSession.role;
        session = { user: { id: userId, role: userRole, name: adminSession.username } } as any;
      }
    }

    if (!userId) {
      try {
        const token = await getToken({ req, secret: process.env.AUTH_SECRET });
        if (token) {
          userId = (token as any).id;
          userRole = (token as any).role;
          session = { user: { id: userId, role: userRole } } as any;
        }
      } catch {
        // getToken() failed — continue to admin_session fallback
      }
    }

    // admin_session cookie fallback
    if (!userId) {
      const adminSession = parseAdminSession(req);
      if (adminSession) {
        userId = DEMO_ADMIN_SESSION_KEY + adminSession.username;
        userRole = adminSession.role;
        session = { user: { id: userId, role: userRole, name: adminSession.username } } as any;
      }
    }

    if (!userId) {
      return unauthorized();
    }

    try {
      return await handler(req, { userId, session, ..._context });
    } catch (handlerError) {
      console.error(`[RBAC] Handler error: ${req.method} ${req.nextUrl.pathname}`, handlerError);
      return serverError("Internal server error");
    }
  };
}

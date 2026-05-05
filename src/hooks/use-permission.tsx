"use client";

/**
 * LokFeel Admin — Frontend Permission Hooks
 *
 * usePermission() — Check if current user has a specific permission
 * usePermissions() — Get all permissions for current user
 * useIsSuperAdmin() — Quick check for super admin
 */

import { useState, useEffect, useCallback } from "react";
import { ALL_PERMISSION_CODES, PERMISSIONS, DANGEROUS_PERMISSIONS, CRITICAL_PERMISSIONS, type PermissionCode } from "@/lib/admin-permissions";

// ============================================================================
// Types
// ============================================================================

interface PermissionState {
  permissions: Set<string>;
  roles: string[];
  isLoading: boolean;
  isSuperAdmin: boolean;
}

// ============================================================================
// Permission API (client-side)
// ============================================================================

async function fetchUserPermissions(): Promise<PermissionState> {
  try {
    const res = await fetch("/api/admin/rbac/my-permissions");
    if (!res.ok) {
      return { permissions: new Set(), roles: [], isLoading: false, isSuperAdmin: false };
    }
    const data = await res.json();
    return {
      permissions: new Set(data.data?.permissions || []),
      roles: data.data?.roles || [],
      isLoading: false,
      isSuperAdmin: data.data?.roles?.includes("SUPER_ADMIN") || false,
    };
  } catch {
    return { permissions: new Set(), roles: [], isLoading: false, isSuperAdmin: false };
  }
}

// ============================================================================
// usePermission Hook
// ============================================================================

/**
 * Check if current user has a specific permission.
 *
 * @example
 * const canBan = usePermission("user.ban");
 * return canBan && <BanButton />;
 */
export function usePermission(permission: string): boolean {
  const [state, setState] = useState<PermissionState>({
    permissions: new Set(),
    roles: [],
    isLoading: true,
    isSuperAdmin: false,
  });

  useEffect(() => {
    fetchUserPermissions().then(setState);
  }, []);

  if (state.isLoading) return false;
  if (state.isSuperAdmin) return true;
  return state.permissions.has(permission);
}

// ============================================================================
// usePermissions Hook
// ============================================================================

/**
 * Get all permissions and roles for the current user.
 *
 * @example
 * const { permissions, roles, isSuperAdmin, isLoading } = usePermissions();
 */
export function usePermissions(): PermissionState & {
  has: (permission: string) => boolean;
  hasAny: (permissions: string[]) => boolean;
  isDangerous: (permission: string) => boolean;
  isCritical: (permission: string) => boolean;
} {
  const [state, setState] = useState<PermissionState>({
    permissions: new Set(),
    roles: [],
    isLoading: true,
    isSuperAdmin: false,
  });

  useEffect(() => {
    fetchUserPermissions().then(setState);
  }, []);

  const has = useCallback(
    (permission: string) => {
      if (state.isLoading) return false;
      if (state.isSuperAdmin) return true;
      return state.permissions.has(permission);
    },
    [state.permissions, state.isSuperAdmin, state.isLoading]
  );

  const hasAny = useCallback(
    (perms: string[]) => {
      if (state.isLoading) return false;
      if (state.isSuperAdmin) return true;
      return perms.some(p => state.permissions.has(p));
    },
    [state.permissions, state.isSuperAdmin, state.isLoading]
  );

  const isDangerous = useCallback(
    (permission: string) => {
      return DANGEROUS_PERMISSIONS.includes(permission as PermissionCode);
    },
    []
  );

  const isCritical = useCallback(
    (permission: string) => {
      return CRITICAL_PERMISSIONS.includes(permission as PermissionCode);
    },
    []
  );

  return {
    ...state,
    has,
    hasAny,
    isDangerous,
    isCritical,
  };
}

// ============================================================================
// useIsSuperAdmin Hook
// ============================================================================

/**
 * Quick check if current user is a super admin.
 */
export function useIsSuperAdmin(): boolean {
  const { isSuperAdmin } = usePermissions();
  return isSuperAdmin;
}

// ============================================================================
// Permission Guard Component
// ============================================================================

interface PermissionGuardProps {
  permission: string | string[];
  mode?: "any" | "all";
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditionally render children based on permissions.
 *
 * @example
 * <PermissionGuard permission="user.ban" fallback={<span>No permission</span>}>
 *   <BanButton />
 * </PermissionGuard>
 */
export function PermissionGuard({
  permission,
  mode = "any",
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { has, hasAny } = usePermissions();

  const permissions = Array.isArray(permission) ? permission : [permission];
  const allowed = mode === "any" ? hasAny(permissions) : permissions.every(p => has(p));

  return <>{allowed ? children : fallback}</>;
}

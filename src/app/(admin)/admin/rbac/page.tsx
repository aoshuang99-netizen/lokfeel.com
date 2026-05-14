import { redirect } from "next/navigation";

/**
 * /admin/rbac → /admin/settings/rbac
 * Convenience redirect for RBAC management page.
 */
export default function RbacRedirectPage() {
  redirect("/admin/settings/rbac");
}

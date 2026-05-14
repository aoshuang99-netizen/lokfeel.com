import { redirect } from "next/navigation";

/**
 * /admin/audit → /admin/settings/audit
 * Convenience redirect for audit log page.
 */
export default function AuditRedirectPage() {
  redirect("/admin/settings/audit");
}

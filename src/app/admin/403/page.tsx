"use client";

import Link from "next/link";
import { ShieldX, ArrowLeft } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
      <div className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center mb-6">
        <ShieldX className="w-10 h-10 text-error" />
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-2">
        Access Denied
      </h1>

      <p className="text-foreground-muted max-w-md mb-6">
        You do not have permission to view this page. If you believe this is an error,
        please contact your administrator.
      </p>

      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="btn-primary flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

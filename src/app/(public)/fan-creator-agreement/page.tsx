import { Metadata } from "next";
import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { BRAND } from "@/config/brand";

/**
 * 已停用文档（V16 · T02）
 *
 * 背景：本路由原为「Fan / Creator Agreement」—— 付费粉丝订阅、独家内容分成那一套，
 * 属于早期内容平台的商业模型。Connection OS 不售卖创作者内容，该协议不适用。
 *
 * 保留路由、加 noindex、不 301（同 18-usc-2257 页的处理理由）。
 */
export const metadata: Metadata = {
  title: "Retired document",
  description: `This agreement has been retired. ${BRAND.name} does not operate a fan/creator paid-content marketplace.`,
  robots: { index: false, follow: false },
};

export default function RetiredDocPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            This agreement has been retired
          </h1>
          <p className="text-foreground-muted">
            {BRAND.name} does not operate a fan/creator paid-content marketplace.
          </p>
        </div>

        <div className="glass-card p-8 lg:p-10 space-y-5 text-foreground-muted leading-relaxed">
          <p>
            The previous version of this page governed payments between a &quot;fan&quot; and a
            &quot;creator&quot; for access to exclusive content. That business model is not part of
            the Service. {BRAND.name} is an {BRAND.category}: organizations compile a goal into a
            structured workspace and execute it with consent gates and agents.
          </p>
          <p>
            Billing that does exist — workspace subscriptions and seats — is covered by the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and the{" "}
            <Link href="/refunds" className="text-primary hover:underline">
              Refunds Policy
            </Link>
            .
          </p>
          <p>
            The page is kept online so that existing links do not break, and is excluded from search
            indexing.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2">
            Back to home <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

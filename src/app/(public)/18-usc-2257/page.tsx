import { Metadata } from "next";
import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { BRAND } from "@/config/brand";

/**
 * 已停用文档（V16 · T02）
 *
 * 背景：本路由原为 18 U.S.C. § 2257 合规声明 —— 那是**成人内容平台**的年龄记录义务，
 * 与 Connection OS（B2B 协作工作区）毫无关系。留着它不是"多一页法务文本"，
 * 而是会让访问者与尽调方误判产品性质，属于公开叙事中的边界泄漏。
 *
 * 处理方式（遵循 T07「非破坏性治理」）：
 *   · 不删除路由（外部链接/书签仍在），改为"已停用"说明；
 *   · 加 noindex，避免继续被搜索引擎当作产品页面收录；
 *   · 不 301（未经验证的全量跳转会伤到已有链接）。
 */
export const metadata: Metadata = {
  title: "Retired document",
  description: `This document has been retired. ${BRAND.name} is an agent-native workspace and does not operate a user-generated adult content platform.`,
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
            This document has been retired
          </h1>
          <p className="text-foreground-muted">
            It described a business {BRAND.name} no longer operates.
          </p>
        </div>

        <div className="glass-card p-8 lg:p-10 space-y-5 text-foreground-muted leading-relaxed">
          <p>
            {BRAND.name} is an {BRAND.category}: a workspace that compiles a stated goal into a
            structured, permissioned plan and records the outcome. We do not operate a
            user-generated adult content platform, and the record-keeping obligations referenced by
            the previous version of this page do not apply to the Service.
          </p>
          <p>
            The page is kept online rather than deleted so that existing links do not break. It is
            excluded from search indexing.
          </p>
          <p className="text-foreground">
            For the documents that do govern the Service, see the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>
            , the{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            and the{" "}
            <Link href="/community-guidelines" className="text-primary hover:underline">
              Community Guidelines
            </Link>
            .
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

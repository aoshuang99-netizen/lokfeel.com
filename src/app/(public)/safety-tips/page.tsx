import { Metadata } from "next";
import { Shield, AlertTriangle, Eye, Lock, UserCheck, Bot } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "Trust & Safety",
  description: `How ${BRAND.name} enforces consent, scopes agent permissions, and handles reports.`,
  openGraph: {
    title: `Trust & Safety · ${BRAND.name}`,
    description: BRAND.shortDescription,
  },
};

/**
 * 说明（V16 · T02）：本页原为"线上约会安全提示"（不要透露住址、首次见面选公共场所…），
 * 与 Connection OS 的信任模型无关。现改为产品的真实控制项 —— 同意、权限、数据边界、
 * 举报路径。每一条都能对应到系统中的具体行为，不是泛泛建议。
 */
const controls = [
  {
    icon: UserCheck,
    title: "Consent is explicit, and scoped",
    desc: "Approval is granted per field and per action, not once for everything. Revoking an approval stops the next action that depended on it — the API rejects it rather than trusting the UI.",
  },
  {
    icon: Bot,
    title: "Agents propose; they do not decide",
    desc: "A model can draft a spec, rank candidates or suggest a message. It cannot move data or contact a person without a server-side permission check and, where required, a human approval.",
  },
  {
    icon: Lock,
    title: "Your workspace stays inside your organization",
    desc: "Every read and write is scoped to an organization on the server. There is no row-level security in the database, so isolation lives in application code and is covered by cross-tenant negative tests.",
  },
  {
    icon: Eye,
    title: "Every action leaves a trace",
    desc: "Approvals, executions and reversals are recorded with the actor and timestamp. If a change cannot be traced, it should not have happened — and we treat it as a defect.",
  },
  {
    icon: Shield,
    title: "You can leave with your data",
    desc: "Export is available before deletion, and deletion removes the account plus the workspace data it owns. Billing records are retained only as long as tax law requires.",
  },
  {
    icon: AlertTriangle,
    title: "Reports reach a person",
    desc: "Report impersonation, phishing or an agent behaving outside its scope. Reports are reviewed by a human, and an agent can be suspended immediately while the review runs.",
  },
];

export default function SafetyTipsPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Trust & <span className="text-gradient">Safety</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            An agent that can act on your behalf is only useful if you can bound what it does.
            These are the bounds, and where to check them.
          </p>
        </div>
      </section>

      {/* Controls */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              The controls that exist today
            </h2>
            <p className="text-foreground-muted max-w-xl mx-auto">
              Each item describes behaviour you can verify in the product — not a policy promise.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {controls.map((item) => (
              <div key={item.title} className="glass-card p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{item.title}</h3>
                  <p className="text-foreground-muted text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reporting */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8 md:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Report a security or safety issue
            </h2>
            <p className="text-foreground-muted mb-8 max-w-xl mx-auto">
              If you see an agent acting outside its approved scope, a workspace exposing another
              organization&apos;s data, or someone impersonating {BRAND.name}, tell us. We will
              suspend the relevant execution path first and investigate second.
            </p>
            <a href="mailto:safety@lokfeel.com" className="btn-primary text-lg px-8 py-4">
              Contact the safety team
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            The written commitments
          </h2>
          <p className="text-foreground-muted mb-8">
            The controls above are implemented in code; the commitments are in the{' '}
            <a href="/privacy" className="text-blue-400 underline">
              Privacy Policy
            </a>{' '}
            and the{' '}
            <a href="/community-guidelines" className="text-blue-400 underline">
              Community Guidelines
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}

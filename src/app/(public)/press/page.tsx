import { Metadata } from "next";
import { Newspaper, Mic, Award, TrendingUp, FileText } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "Press",
  description: `Press resources and media contacts for ${BRAND.name}, an agent-native workspace that compiles intent into structured, permissioned work.`,
  openGraph: {
    title: `Press · ${BRAND.name}`,
    description: BRAND.shortDescription,
  },
};

/**
 * 事实清单：只写可核实的内容。
 *
 * 说明（V16 · T02）：本页此前列了三条"媒体报道"（TechCrunch / Wired / VentureBeat，
 * 含 500K 会员等数字），这些报道并不存在 —— 属于虚构背书，商业发布前必须清除。
 * 现在改为产品事实卡 + 明确的"暂无公告"空状态：没有新闻时，诚实地没有。
 */
const factSheet = [
  {
    label: "Category",
    value: "Agent-Native Connection OS",
  },
  {
    label: "Core mechanism",
    value: "Intent → validated workspace spec → missions, consent gates, agents, outcomes",
  },
  {
    label: "Machine surface",
    value: "MCP server (5 tools), A2A task API, published OpenAPI contract",
  },
  {
    label: "Data isolation",
    value: "Organization-scoped, enforced in the application layer (no row-level security in libSQL)",
  },
];

const mediaContacts = [
  { name: "Press Inquiries", email: "press@lokfeel.com" },
  { name: "Partnerships", email: "partners@lokfeel.com" },
];

export default function PressPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Newspaper className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Press & <span className="text-gradient">Media</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            {BRAND.subheading}
          </p>
        </div>
      </section>

      {/* Fact sheet */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">About {BRAND.name}</h2>
          <p className="text-foreground-muted mb-8 max-w-2xl">
            A short, verifiable fact sheet for coverage. Nothing here is a projection.
          </p>
          <div className="glass-card divide-y divide-white/5">
            {factSheet.map((fact) => (
              <div key={fact.label} className="flex flex-col sm:flex-row gap-2 sm:gap-6 p-5">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 sm:w-40 flex-shrink-0">
                  {fact.label}
                </span>
                <span className="text-foreground-muted text-sm leading-relaxed">{fact.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* News — honest empty state */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10">Latest News</h2>
          <div className="glass-card p-8 md:p-10 text-center">
            <FileText className="w-8 h-8 text-foreground-subtle mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No press releases yet
            </h3>
            <p className="text-foreground-muted text-sm max-w-md mx-auto">
              We publish announcements only when there is something verifiable to announce. For
              background, use the fact sheet above; for anything else, ask us directly.
            </p>
          </div>
        </div>
      </section>

      {/* Media Resources */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10">Media Resources</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="glass-card p-6 text-center">
              <Award className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Brand Assets</h3>
              <p className="text-sm text-foreground-muted">
                Logo and product screenshots — request the current pack by email.
              </p>
            </div>
            <div className="glass-card p-6 text-center">
              <TrendingUp className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Product Facts</h3>
              <p className="text-sm text-foreground-muted">
                Architecture, protocol support and data-isolation model, on request.
              </p>
            </div>
            <div className="glass-card p-6 text-center">
              <Mic className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Interviews</h3>
              <p className="text-sm text-foreground-muted">
                Request an interview with the engineering team.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 lg:py-20 bg-background-secondary/30 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">Media Contact</h2>
          <p className="text-foreground-muted mb-8">For press inquiries, partnerships, or media assets:</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {mediaContacts.map((contact) => (
              <a
                key={contact.name}
                href={`mailto:${contact.email}`}
                className="btn-secondary text-sm px-6 py-3"
              >
                {contact.name}: {contact.email}
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

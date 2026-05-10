import { Metadata } from "next";
import Link from "next/link";
import { Newspaper, Mic, Award, TrendingUp } from "lucide-react";

export const metadata: Metadata = {
  title: "Press - LokFee!",
  description: "Latest news, press releases, and media resources for LokFee!.",
};

const pressItems = [
  {
    date: "2026-03",
    title: "LokFee! Reaches 500K+ Members Worldwide",
    source: "TechCrunch",
    type: "Feature",
    excerpt: "The relationship matching platform hits a major milestone as its science-backed approach gains traction globally.",
  },
  {
    date: "2026-01",
    title: "Why Swiping Fails: The Science Behind LokFee!'s Matching",
    source: "Wired",
    type: "Feature",
    excerpt: "A deep dive into how relationship psychology is reshaping online dating.",
  },
  {
    date: "2025-11",
    title: "LokFee! Launches Global Rollout",
    source: "VentureBeat",
    type: "Press Release",
    excerpt: "Officially expanding beyond North America with localized experiences.",
  },
];

const mediaContacts = [
  { name: "Press Inquiries", email: "press@lokfee.com" },
  { name: "Partnerships", email: "partners@lokfee.com" },
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
            Latest news, announcements, and stories about how LokFee! is changing the way people connect.
          </p>
        </div>
      </section>

      {/* Press Releases / Features */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10">Latest News</h2>
          <div className="space-y-6">
            {pressItems.map((item, i) => (
              <div key={i} className="glass-card p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <Mic className="w-6 h-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">{item.type}</span>
                    <span className="text-xs text-foreground-subtle">{item.date}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-foreground-muted mb-2">Source: {item.source}</p>
                  <p className="text-foreground-muted text-sm">{item.excerpt}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Media Resources */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10">Media Resources</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="glass-card p-6 text-center">
              <Award className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Brand Assets</h3>
              <p className="text-sm text-foreground-muted">Logos, screenshots, and brand guidelines for media use.</p>
            </div>
            <div className="glass-card p-6 text-center">
              <TrendingUp className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Stats & Facts</h3>
              <p className="text-sm text-foreground-muted">Key numbers and milestones at a glance.</p>
            </div>
            <div className="glass-card p-6 text-center">
              <Mic className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Interviews</h3>
              <p className="text-sm text-foreground-muted">Request an interview with our leadership team.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 lg:py-20 text-center">
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

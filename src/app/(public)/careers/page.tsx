import { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Globe, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Careers - LokFee!",
  description: "Join the LokFee! team and help us build the future of meaningful connections.",
};

const openPositions = [
  {
    title: "Senior Full-Stack Engineer",
    location: "Remote / Shenzhen",
    type: "Full-time",
    department: "Engineering",
  },
  {
    title: "Product Designer",
    location: "Remote / Shenzhen",
    type: "Full-time",
    department: "Design",
  },
  {
    title: "Community Manager",
    location: "Remote",
    type: "Full-time",
    department: "Community",
  },
  {
    title: "Data Scientist (Matching Algorithm)",
    location: "Remote",
    type: "Full-time",
    department: "Engineering",
  },
];

const benefits = [
  "Competitive salary + equity options",
  "Remote-first culture, work from anywhere",
  "Unlimited PTO, recharge when you need",
];

export default function CareersPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Briefcase className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Join the <span className="text-gradient">LokFee!</span> Team
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            We're building technology that helps people find real, lasting connections. Come build with us.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Why LokFee!?</h2>
          <p className="text-foreground-muted leading-relaxed max-w-2xl mx-auto mb-10">
            Most dating apps are designed to keep you swiping. We're designing LokFee! to help you stop swiping and start connecting. Our team is remote-first, mission-driven, and committed to building something that actually works.
          </p>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            {benefits.map((benefit, i) => (
              <div key={i} className="glass-card p-5 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                <span className="text-foreground-muted text-sm">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open Positions */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10 text-center">Open Positions</h2>
          <div className="space-y-4">
            {openPositions.map((pos, i) => (
              <div key={i} className="glass-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{pos.title}</h3>
                  <div className="flex items-center gap-3 text-sm text-foreground-muted mt-1">
                    <span>{pos.department}</span>
                    <span>•</span>
                    <span>{pos.location}</span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs">{pos.type}</span>
                  </div>
                </div>
                <Link
                  href="mailto:careers@lokfee.com?subject=Application"
                  className="btn-primary text-sm px-5 py-2.5 whitespace-nowrap"
                >
                  Apply
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">Don't see a fit?</h2>
          <p className="text-foreground-muted mb-8">
            We're always looking for talented people. Send us your portfolio and let's talk.
          </p>
          <a
            href="mailto:careers@lokfee.com"
            className="btn-primary text-lg px-8 py-4"
          >
            Contact Us
          </a>
        </div>
      </section>
    </div>
  );
}

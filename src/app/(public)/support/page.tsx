import { Metadata } from "next";
import Link from "next/link";
import { Mail, Shield, AlertTriangle, Lightbulb, BookOpen } from "lucide-react";

export const metadata: Metadata = {
  title: "Support - LokFee!",
  description: "Get help and support for your LokFee! experience.",
};

const supportTopics = [
  {
    icon: Mail,
    title: "Account & Login",
    desc: "Can't sign in? Forgot password? Email verification issues?",
    links: ["Reset your password", "Resend verification email", "Update email address"],
  },
  {
    icon: Shield,
    title: "Safety & Privacy",
    desc: "How we protect you, and what you can do to stay safe.",
    links: ["Privacy settings guide", "How to block or report", "Data download request"],
  },
  {
    icon: AlertTriangle,
    title: "Reporting Issues",
    desc: "Something not right? Let us know and we'll look into it.",
    links: ["Report a bug", "Report a user", "Appeal a decision"],
  },
];

const contactMethods = [
  { name: "General Support", email: "support@lokfee.com" },
  { name: "Safety & Abuse", email: "safety@lokfee.com", urgent: true },
  { name: "Billing", email: "billing@lokfee.com" },
];

export default function SupportPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            How Can We <span className="text-gradient">Help?</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Find answers, get support, or reach our team directly.
          </p>
        </div>
      </section>

      {/* Support Topics */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10 text-center">Common Topics</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {supportTopics.map((topic, i) => (
              <div key={i} className="glass-card p-6">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
                  <topic.icon className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{topic.title}</h3>
                <p className="text-foreground-muted text-sm mb-4">{topic.desc}</p>
                <ul className="space-y-1.5 list-none p-0 m-0">
                  {topic.links.map((link, j) => (
                    <li key={j} className="text-sm text-blue-400 hover:underline cursor-pointer">{link}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">Still Need Help?</h2>
          <p className="text-foreground-muted mb-10 max-w-xl mx-auto">Reach out to us directly. We typically respond within 24 hours.</p>
          <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {contactMethods.map((method, i) => (
              <a
                key={i}
                href={`mailto:${method.email}`}
                className="glass-card p-5 flex flex-col items-center gap-2 no-underline hover:border-blue-500/30 transition-all"
              >
                <span className="text-foreground font-medium text-sm">{method.name}</span>
                <span className={`text-xs ${method.urgent ? "text-red-400" : "text-blue-400"}`}>{method.email}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Link */}
      <section className="py-16 lg:py-20 bg-background-secondary/30 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-6 h-6 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Want to Learn More?</h2>
          <p className="text-foreground-muted mb-6">Visit our safety tips page for best practices on staying safe while connecting.</p>
          <Link href="/safety-tips" className="btn-secondary">
            Read Safety Tips
          </Link>
        </div>
      </section>
    </div>
  );
}

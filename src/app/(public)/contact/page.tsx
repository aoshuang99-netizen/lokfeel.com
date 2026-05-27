import { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, Globe, Send, HelpCircle, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact Us - LokFeel",
  description: "Get in touch with the LokFeel team.",
};

export default function ContactPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Contact Us</h1>
          <p className="text-foreground-muted">We'd love to hear from you</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          
          {/* General Inquiries */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">General Inquiries</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13 mb-4">
              For general questions about LokFeel, our matching algorithm, or partnership opportunities:
            </p>
            <div className="ml-13 glass border-card-border p-4 rounded-lg">
              <p className="text-foreground"><strong>Email:</strong> <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">hello@lokfeel.com</a></p>
              <p className="text-foreground-muted text-sm mt-1">Response time: Within 48 hours</p>
            </div>
          </section>

          {/* Support */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <HelpCircle className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Customer Support</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13 mb-4">
              Need help with your account, matching, or technical issues? Our support team is here to help:
            </p>
            <div className="ml-13 glass border-card-border p-4 rounded-lg">
              <p className="text-foreground"><strong>Email:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p className="text-foreground-muted text-sm mt-1">Response time: Within 24 hours</p>
            </div>
          </section>

          {/* Billing */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Billing & Subscriptions</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13 mb-4">
              Questions about payments, refunds, or subscription management:
            </p>
            <div className="ml-13 glass border-card-border p-4 rounded-lg">
              <p className="text-foreground"><strong>Email:</strong> <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a></p>
              <p className="text-foreground-muted text-sm mt-1">Response time: Within 48 hours</p>
            </div>
          </section>

          {/* Legal */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Legal & Privacy</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13 mb-4">
              For legal inquiries, privacy requests (GDPR/CCPA), or DMCA notices:
            </p>
            <div className="ml-13 space-y-3">
              <div className="glass border-card-border p-4 rounded-lg">
                <p className="text-foreground"><strong>Legal:</strong> <a href="mailto:legal@lokfeel.com" className="text-primary hover:underline">legal@lokfeel.com</a></p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <p className="text-foreground"><strong>Privacy:</strong> <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a></p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <p className="text-foreground"><strong>DMCA:</strong> <a href="mailto:dmca@lokfeel.com" className="text-primary hover:underline">dmca@lokfeel.com</a></p>
              </div>
            </div>
          </section>

          {/* Mailing Address */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Mailing Address</h2>
            </div>
            <div className="ml-13 glass border-card-border p-6 rounded-lg">
              <p className="text-foreground font-semibold mb-2">LokFeel Inc.</p>
              <p className="text-foreground">Wilmington, Delaware</p>
              <p className="text-foreground">United States</p>
            </div>
          </section>

          {/* Social Media */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Follow Us</h2>
            </div>
            <div className="ml-13 flex gap-4">
              <a href="https://twitter.com/lokfeel" target="_blank" rel="noopener noreferrer" className="glass border-card-border p-3 rounded-lg hover:border-primary/50 transition-colors">
                <p className="text-foreground font-semibold">Twitter / X</p>
                <p className="text-foreground-muted text-sm">@lokfeel</p>
              </a>
              <a href="https://instagram.com/lokfeel" target="_blank" rel="noopener noreferrer" className="glass border-card-border p-3 rounded-lg hover:border-primary/50 transition-colors">
                <p className="text-foreground font-semibold">Instagram</p>
                <p className="text-foreground-muted text-sm">@lokfeel</p>
              </a>
            </div>
          </section>

          {/* Contact Form Note */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Send className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Quick Response</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              For the fastest response, please email the appropriate department listed above. Include your account email (if applicable) and a detailed description of your inquiry. Our team typically responds within 24-48 hours.
            </p>
          </section>

        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/" className="btn-ghost">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

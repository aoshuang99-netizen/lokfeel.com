import { Metadata } from "next";
import Link from "next/link";
import { HelpCircle, Users, MessageSquare, CreditCard, Shield, Trash2, Smartphone, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "FAQ - LokFeel",
  description: "Frequently asked questions about LokFeel - your relationship matching platform.",
};

export default function FAQPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <HelpCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Frequently Asked Questions</h1>
          <p className="text-foreground-muted">Everything you need to know about LokFeel</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-10">
          
          {/* What is LokFeel */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">What is LokFeel?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              LokFeel is a relationship matching platform that helps you find meaningful connections based on relationship psychology principles. Unlike traditional dating apps that focus on photos, LokFeel analyzes your relationship blueprint — including attachment style, communication preferences, conflict resolution style, love language, and life priorities — to provide scientifically-backed match recommendations with detailed compatibility explanations.
            </p>
          </section>

          {/* How does LokFeel work */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">How does LokFeel work?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              LokFeel works in three simple steps: (1) Complete your Relationship Blueprint by answering questions about your relationship style and preferences. (2) Our algorithm analyzes your responses and identifies compatible matches. (3) Review your matches with detailed compatibility explanations, then connect and start meaningful conversations. Our paid messaging system allows you to engage with matches at your own pace.
            </p>
          </section>

          {/* Is LokFeel safe */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Is LokFeel safe?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              Absolutely! LokFeel is committed to creating a safe and respectful community. We verify user identities, moderate content, and provide safety tips throughout the app. Our reporting system allows users to flag inappropriate behavior, and we take immediate action on violations. We never share your personal data with third parties without your consent, and all messages are encrypted end-to-end.
            </p>
          </section>

          {/* How much does LokFeel cost */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-xl font-bold text-foreground">How much does LokFeel cost?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              LokFeel offers a free tier that allows you to create a profile, complete your Relationship Blueprint, and receive match recommendations. Premium subscriptions unlock additional features such as unlimited messaging, advanced filters, read receipts, and priority matching. Visit our <Link href="/pricing" className="text-primary hover:underline">Pricing page</Link> for current plans and pricing.
            </p>
          </section>

          {/* How to create an account */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-xl font-bold text-foreground">How do I create a LokFeel account?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              Creating a LokFeel account is free and simple. Visit <Link href="/register" className="text-primary hover:underline">app.lokfeel.com/register</Link> and follow the steps to create your account. You'll need to provide your email address, create a password, and complete your basic profile information. For enhanced security, you can also sign up using Google or GitHub OAuth.
            </p>
          </section>

          {/* How to cancel subscription */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-xl font-bold text-foreground">How do I cancel my subscription?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              To cancel your LokFeel subscription, log in to your account and navigate to 'Account Settings.' In this section, you'll find an option labeled 'Manage Subscription.' Follow the prompts to cancel your subscription. Your premium features will remain active until the end of the current billing period. For refund requests, please contact <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a>.
            </p>
          </section>

          {/* How to delete account */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-danger/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-danger" />
              </div>
              <h2 className="text-xl font-bold text-foreground">How do I delete my LokFeel account?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              To delete your LokFeel account, access your account settings after logging in. Within these settings, you'll find an option labeled 'Delete Account.' Follow the prompts to permanently delete your account. Please note that account deletion is irreversible. All your data, including your Relationship Blueprint, matches, and messages, will be permanently deleted within 30 days. For assistance, contact <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a>.
            </p>
          </section>

          {/* Who can join */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Who can join LokFeel?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              Anyone who is at least 18 years old can create a free LokFeel account. LokFeel is designed for individuals seeking meaningful relationships, whether dating, friendship, or long-term partnership. We welcome users of all genders, orientations, and backgrounds who are committed to respectful and authentic connections.
            </p>
          </section>

          {/* Mobile app */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Does LokFeel have a mobile app?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13">
              Yes! LokFeel is fully responsive and works great on mobile browsers. Our Progressive Web App (PWA) allows you to install LokFeel on your iOS or Android device for an app-like experience. Simply visit <strong>app.lokfeel.com</strong> in your mobile browser and follow the prompt to add LokFeel to your home screen. Native mobile apps for iOS and Android are currently in development.
            </p>
          </section>

          {/* Contact support */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Still have questions?</h2>
            </div>
            <p className="text-foreground leading-relaxed ml-13 mb-4">
              Our support team is here to help! Contact us at:
            </p>
            <div className="ml-13 space-y-2 text-foreground">
              <p><strong>Support:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p><strong>General:</strong> <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">hello@lokfeel.com</a></p>
              <p><strong>Billing:</strong> <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a></p>
            </div>
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

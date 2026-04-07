import { Metadata } from "next";
import Link from "next/link";
import { Shield, Lock, Eye, Users, Trash2, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy - Nexus",
  description: "Learn how Nexus protects your data and privacy while helping you find meaningful connections.",
};

export default function PrivacyPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Privacy Policy</h1>
          <p className="text-white/60">Last updated: January 15, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Introduction</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              At Nexus, we believe your personal information belongs to you. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our services.
            </p>
            <p className="text-white/80 leading-relaxed">
              We're committed to transparency and giving you control over your data. Dating apps shouldn't require you to sacrifice your privacy to find love.
            </p>
          </section>

          {/* Information We Collect */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">2. Information We Collect</h2>
            </div>
            
            <h3 className="text-lg font-semibold text-white mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 mb-6 ml-4">
              <li>Account information (name, email, date of birth)</li>
              <li>Profile information (photos, bio, relationship preferences)</li>
              <li>Relationship blueprint responses (attachment style, communication preferences)</li>
              <li>Match preferences and dealbreakers</li>
              <li>Messages and interactions with other users</li>
              <li>Payment information (processed securely by Stripe)</li>
            </ul>

            <h3 className="text-lg font-semibold text-white mb-3">2.2 Information Collected Automatically</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Device information (type, operating system, unique identifiers)</li>
              <li>Usage data (features used, interactions, session duration)</li>
              <li>Location data (general, not precise - for matching purposes)</li>
              <li>Log data (IP address, browser type, referral source)</li>
            </ul>
          </section>

          {/* How We Use Your Information */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Eye className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-white">3. How We Use Your Information</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">We use your information to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Create and maintain your account</li>
              <li>Generate personalized match recommendations</li>
              <li>Provide match explanations and compatibility insights</li>
              <li>Facilitate communication between matched users</li>
              <li>Improve our matching algorithm through aggregate data analysis</li>
              <li>Send you service-related notifications (with your consent for marketing)</li>
              <li>Prevent fraud, abuse, and security threats</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          {/* Data Sharing */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">4. Data Sharing</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We never sell your personal data. Here's who we share your data with:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Other Users:</strong> Your profile is shown to potential matches. You control what information is visible.</li>
              <li><strong>Service Providers:</strong> Companies that help us operate (hosting, analytics, payments). They are bound by strict data processing agreements.</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights and safety.</li>
            </ul>
          </section>

          {/* Data Protection */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-white">5. How We Protect Your Data</h2>
            </div>
            
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>End-to-end encryption for all messages</li>
              <li>AES-256 encryption for stored data</li>
              <li>Regular security audits and penetration testing</li>
              <li>Strict access controls and employee training</li>
              <li>Anonymization of data used for algorithm improvement</li>
              <li>GDPR and CCPA compliant data handling</li>
            </ul>
          </section>

          {/* Your Rights */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-white">6. Your Rights</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">You have the right to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and all associated data</li>
              <li>Export your data in a portable format</li>
              <li>Opt out of marketing communications</li>
              <li>Restrict certain data processing</li>
              <li>Object to processing based on legitimate interests</li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-white">7. Data Retention</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">
              We retain your data only as long as necessary:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Active accounts:</strong> Data retained while your account is active</li>
              <li><strong>Deleted accounts:</strong> Data deleted within 30 days of account deletion</li>
              <li><strong>Messages:</strong> Deleted when either sender or recipient deletes them</li>
              <li><strong>Anonymous analytics:</strong> Retained indefinitely for product improvement</li>
            </ul>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">8. Contact Us</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">
              If you have questions about this Privacy Policy or want to exercise your rights:
            </p>
            <p className="text-white/80">
              Email: <a href="mailto:privacy@nexus.dating" className="text-primary hover:underline">privacy@nexus.dating</a>
            </p>
          </section>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/" className="btn-ghost">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

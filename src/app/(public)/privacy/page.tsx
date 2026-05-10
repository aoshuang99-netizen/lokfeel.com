import { Metadata } from "next";
import Link from "next/link";
import { Shield, Lock, Eye, Users, Trash2, Mail, Globe, Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy - LokFee!",
  description: "Learn how LokFee! protects your data and privacy while helping you find meaningful connections.",
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
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Privacy Policy</h1>
          <p className="text-foreground-muted">Last updated: April 8, 2026</p>
          <p className="text-foreground-subtle text-sm mt-2">Effective Date: April 8, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Introduction</h2>
            <p className="text-foreground leading-relaxed mb-4">
              LokFee! ("we," "our," or "us") is operated by <strong>LokFee! Inc.</strong>, a company registered in the State of Delaware, USA. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our services at <strong>app.lokfeel.com</strong> and <strong>lokfeel.com</strong> (collectively, the &quot;Service&quot;).
            </p>
            <p className="text-foreground leading-relaxed">
              We&apos;re committed to transparency and giving you control over your data. Dating apps shouldn&apos;t require you to sacrifice your privacy to find meaningful connections.
            </p>
          </section>

          {/* Information We Collect */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">2. Information We Collect</h2>
            </div>
            
            <h3 className="text-lg font-semibold text-foreground mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside text-foreground space-y-2 mb-6 ml-4">
              <li>Account information (name, email, date of birth)</li>
              <li>Profile information (photos, bio, relationship preferences)</li>
              <li>Relationship blueprint responses (attachment style, communication preferences, conflict resolution style, love language)</li>
              <li>Match preferences and dealbreakers</li>
              <li>Messages and interactions with other users</li>
              <li>Payment information (processed securely by Stripe; we never store full card numbers)</li>
            </ul>

            <h3 className="text-lg font-semibold text-foreground mb-3">2.2 Information Collected Automatically</h3>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Device information (type, operating system, unique identifiers)</li>
              <li>Usage data (features used, interactions, session duration)</li>
              <li>Location data (general, not precise &mdash; for matching purposes only)</li>
              <li>Log data (IP address, browser type, referral source)</li>
              <li>Cookies and tracking technologies (see our <Link href="/cookies" className="text-primary hover:underline">Cookie Policy</Link>)</li>
            </ul>
          </section>

          {/* How We Use Your Information */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Eye className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">3. How We Use Your Information</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">We use your information to:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Create and maintain your account</li>
              <li>Generate personalized match recommendations based on our relationship compatibility algorithm</li>
              <li>Provide match explanations and compatibility insights</li>
              <li>Facilitate communication between matched users</li>
              <li>Improve our matching algorithm through aggregate data analysis</li>
              <li>Send you service-related notifications (with your consent for marketing)</li>
              <li>Prevent fraud, abuse, and security threats</li>
              <li>Comply with legal obligations</li>
              <li>Provide customer support</li>
            </ul>
          </section>

          {/* Legal Bases for Processing */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Scale className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">4. Legal Bases for Processing</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">
              We process your personal data under the following legal frameworks:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Consent:</strong> Where you have given us explicit consent (e.g., marketing emails, optional cookie preferences)</li>
              <li><strong>Contractual Necessity:</strong> To provide the Service you signed up for</li>
              <li><strong>Legitimate Interests:</strong> For security, fraud prevention, and service improvement</li>
              <li><strong>Legal Compliance:</strong> To comply with applicable laws and regulations</li>
            </ul>
          </section>

          {/* Data Sharing */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">5. Data Sharing</h2>
            <p className="text-foreground leading-relaxed mb-4">
              We <strong>never sell</strong> your personal data. Here&apos;s who we share your data with:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Other Users:</strong> Your profile is shown to potential matches. You control what information is visible through your privacy settings.</li>
              <li><strong>Service Providers:</strong> Companies that help us operate (Vercel for hosting, Stripe for payments, Neon for database, Google/GitHub for authentication). They are bound by strict data processing agreements and only process data on our instructions.</li>
              <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect the safety of our users or the public.</li>
              <li><strong>Business Transfers:</strong> In the event of a merger, acquisition, or asset sale, your data may be transferred to the acquiring entity.</li>
            </ul>
          </section>

          {/* Data Protection */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">6. How We Protect Your Data</h2>
            </div>
            
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>End-to-end encryption for all messages</li>
              <li>AES-256 encryption for stored data</li>
              <li>HTTPS/TLS encryption for all data in transit</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Strict access controls and employee training</li>
              <li>Anonymization of data used for algorithm improvement</li>
              <li>PCI DSS compliant payment processing via Stripe</li>
              <li>SOC 2 Type II compliant infrastructure via Vercel</li>
            </ul>
          </section>

          {/* International Data Transfers */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">7. International Data Transfers</h2>
            </div>

            <p className="text-foreground leading-relaxed">
              Our Service is hosted in the United States. If you access the Service from outside the US, your data may be transferred to and processed in the United States. We ensure appropriate safeguards are in place, including Standard Contractual Clauses approved by the European Commission, and comply with applicable data protection laws such as the EU General Data Protection Regulation (GDPR) and the UK GDPR.
            </p>
          </section>

          {/* Your Rights */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">8. Your Rights</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">Depending on your location, you have the right to:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4 mb-6">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Correct inaccurate or incomplete data</li>
              <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
              <li><strong>Portability:</strong> Export your data in a machine-readable format</li>
              <li><strong>Opt-out:</strong> Unsubscribe from marketing communications at any time</li>
              <li><strong>Restriction:</strong> Restrict certain data processing activities</li>
              <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
              <li><strong>Withdraw Consent:</strong> Withdraw consent where processing is based on consent</li>
            </ul>

            <p className="text-foreground leading-relaxed">
              To exercise any of these rights, contact us at <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a>. We will respond to your request within 30 days (or 45 days for California residents under CCPA).
            </p>
          </section>

          {/* CCPA Section */}
          <section className="glass border-warning/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">9. California Consumer Privacy Act (CCPA) Notice</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              This section applies to California residents as required by the California Consumer Privacy Act of 2018 (CCPA).
            </p>

            <h3 className="text-lg font-semibold text-foreground mb-3">9.1 Categories of Personal Information Collected</h3>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4 mb-6">
              <li><strong>Identifiers:</strong> Name, email address, account ID</li>
              <li><strong>Customer Records:</strong> Profile information, relationship preferences, communication data</li>
              <li><strong>Protected Classifications:</strong> Age (date of birth), gender (provided voluntarily)</li>
              <li><strong>Commercial Information:</strong> Subscription tier, payment records</li>
              <li><strong>Internet Activity:</strong> Usage patterns, feature interactions</li>
              <li><strong>Geolocation:</strong> General location (not precise GPS)</li>
              <li><strong>Inferences:</strong> Relationship compatibility scores, match recommendations</li>
            </ul>

            <h3 className="text-lg font-semibold text-foreground mb-3">9.2 Your CCPA Rights</h3>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4 mb-6">
              <li><strong>Right to Know:</strong> You can request information about the personal data we have collected, used, disclosed, and sold in the past 12 months.</li>
              <li><strong>Right to Delete:</strong> You can request that we delete your personal information, subject to certain exceptions.</li>
              <li><strong>Right to Correct:</strong> You can request that we correct inaccurate personal information.</li>
              <li><strong>Right to Opt-Out of Sale/Sharing:</strong> We do <strong>NOT</strong> sell or share your personal information for cross-context behavioral advertising.</li>
              <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising any CCPA rights.</li>
              <li><strong>Right to Limit Use of Sensitive Personal Information:</strong> You can request that we limit our use of your sensitive personal information.</li>
            </ul>

            <h3 className="text-lg font-semibold text-foreground mb-3">9.3 How to Exercise Your Rights</h3>
            <p className="text-foreground leading-relaxed mb-2">
              Submit a request via:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Email: <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a></li>
              <li>Subject line: &quot;CCPA Privacy Request&quot;</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-3">
              We will verify your identity before processing your request. You may also designate an authorized agent to submit requests on your behalf.
            </p>
          </section>

          {/* Data Retention */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">10. Data Retention</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              We retain your data only as long as necessary:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Active accounts:</strong> Data retained while your account is active</li>
              <li><strong>Deleted accounts:</strong> Data deleted within 30 days of account deletion (except where legal retention is required)</li>
              <li><strong>Messages:</strong> Deleted when either sender or recipient deletes them</li>
              <li><strong>Anonymous analytics:</strong> Retained indefinitely for product improvement</li>
              <li><strong>Legal holds:</strong> Data may be retained longer if required by legal proceedings</li>
            </ul>
          </section>

          {/* Children's Privacy */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">11. Children&apos;s Privacy</h2>
            <p className="text-foreground leading-relaxed">
              The Service is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child under 18, we will take steps to delete that information promptly. If you believe we have inadvertently collected information from a minor, please contact us at <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a>.
            </p>
          </section>

          {/* Changes to Policy */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">12. Changes to This Policy</h2>
            <p className="text-foreground leading-relaxed">
              We may update this Privacy Policy periodically. Material changes will be communicated via email or a prominent notice on our Service at least 30 days before the effective date. Continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">13. Contact Us</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              If you have questions about this Privacy Policy or want to exercise your data rights:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Data Protection Officer:</strong> <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a></p>
              <p><strong>General Inquiries:</strong> <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">hello@lokfeel.com</a></p>
              <p><strong>Support:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p className="text-foreground-muted text-sm mt-4">
                LokFee! Inc.<br />
                Wilmington, Delaware, USA
              </p>
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

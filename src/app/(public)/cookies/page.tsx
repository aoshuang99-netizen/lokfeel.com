import { Metadata } from "next";
import Link from "next/link";
import { Cookie, Shield, Eye, Lock, Settings, AlertCircle, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Cookie Policy - LokFee!",
  description: "Learn how LokFee! uses cookies and similar technologies to enhance your experience.",
};

export default function CookiePolicyPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Cookie className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Cookie Policy</h1>
          <p className="text-foreground-muted">Last updated: April 8, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Introduction</h2>
            <p className="text-foreground leading-relaxed mb-4">
              This Cookie Policy explains how LokFee! (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) uses cookies and similar tracking technologies when you visit our website at <strong>app.lokfeel.com</strong> and <strong>lokfeel.com</strong> (collectively, the &quot;Service&quot;).
            </p>
            <p className="text-foreground leading-relaxed">
              This policy should be read alongside our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>, which provides more detail on how we handle your personal data.
            </p>
          </section>

          {/* What Are Cookies */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Cookie className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">2. What Are Cookies?</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">
              Cookies are small text files stored on your device when you visit a website. They are widely used to make websites work more efficiently and to provide information to site owners. Similar technologies include:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Local Storage:</strong> Data stored in your browser for functionality purposes</li>
              <li><strong>Session Storage:</strong> Temporary data that exists only during your browser session</li>
              <li><strong>Pixel Tags:</strong> Small transparent images used to track page views and interactions</li>
              <li><strong>Fingerprinting:</strong> Device characteristics used for security and analytics</li>
            </ul>
          </section>

          {/* How We Use Cookies */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Eye className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">3. How We Use Cookies</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">We use cookies for the following purposes:</p>

            <h3 className="text-lg font-semibold text-foreground mb-3">3.1 Essential Cookies</h3>
            <p className="text-foreground leading-relaxed mb-2">
              These cookies are necessary for the Service to function properly. They enable core features such as authentication, security, and navigation.
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4 mb-6">
              <li><strong>Authentication:</strong> Maintains your logged-in session securely</li>
              <li><strong>Security:</strong> Protects against CSRF attacks and unauthorized access</li>
              <li><strong>Preferences:</strong> Remembers your settings and display preferences</li>
            </ul>

            <h3 className="text-lg font-semibold text-foreground mb-3">3.2 Analytics Cookies</h3>
            <p className="text-foreground leading-relaxed mb-2">
              These cookies help us understand how visitors interact with our Service, allowing us to improve the user experience.
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4 mb-6">
              <li>Pages visited and time spent on each page</li>
              <li>Navigation paths through the Service</li>
              <li>Error tracking and performance monitoring</li>
              <li>Aggregate usage statistics (anonymized)</li>
            </ul>

            <h3 className="text-lg font-semibold text-foreground mb-3">3.3 Functional Cookies</h3>
            <p className="text-foreground leading-relaxed mb-2">
              These cookies enable enhanced functionality and personalization, such as remembering your matching preferences and dashboard layout.
            </p>

            <h3 className="text-lg font-semibold text-foreground mb-3">3.4 Marketing Cookies (Optional)</h3>
            <p className="text-foreground leading-relaxed">
              With your consent, we may use marketing cookies from third-party partners to deliver relevant advertisements and measure advertising effectiveness. These are only activated if you explicitly consent.
            </p>
          </section>

          {/* Third-Party Cookies */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">4. Third-Party Services</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">
              We may allow certain third parties to set cookies on your device for the purposes described below:
            </p>

            <div className="space-y-4">
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Vercel (Hosting)</h4>
                <p className="text-foreground-muted text-sm">Performance and error monitoring cookies to ensure service reliability.</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Stripe (Payments)</h4>
                <p className="text-foreground-muted text-sm">Cookies for secure payment processing. Stripe is PCI DSS compliant.</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Google OAuth / GitHub OAuth</h4>
                <p className="text-foreground-muted text-sm">Cookies for third-party authentication services when you choose to sign in with Google or GitHub.</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Neon (Database)</h4>
                <p className="text-foreground-muted text-sm">Connection pooling cookies for database performance optimization.</p>
              </div>
            </div>
          </section>

          {/* Managing Cookies */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Settings className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">5. Managing Your Cookie Preferences</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">You have the right to decide whether to accept or reject cookies:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Browser Settings:</strong> Most browsers allow you to manage cookie preferences through their settings. Consult your browser&apos;s help documentation for instructions.</li>
              <li><strong>Opt-Out Tools:</strong> You can opt out of tracking cookies through industry-standard tools.</li>
              <li><strong>Cookie Banner:</strong> Where required by law (e.g., GDPR), we present a cookie consent banner allowing you to accept or decline non-essential cookies.</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              <strong>Please note:</strong> Disabling essential cookies may affect the functionality of the Service, and some features may not work properly.
            </p>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Cookie Retention</h2>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Session Cookies:</strong> Deleted when you close your browser</li>
              <li><strong>Persistent Cookies:</strong> Remain until their expiration date or until you delete them</li>
              <li><strong>Analytics Cookies:</strong> Retained for up to 13 months</li>
              <li><strong>Authentication Cookies:</strong> Refreshed with each session; deleted on account logout</li>
            </ul>
          </section>

          {/* US-Specific Section */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">7. For California Residents (CCPA / CalOPPA)</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">
              Under the California Consumer Privacy Act (CCPA) and California Online Privacy Protection Act (CalOPPA), California residents have additional rights:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Right to Know:</strong> You have the right to request information about the categories of personal data we collect and how we use it.</li>
              <li><strong>Right to Delete:</strong> You may request that we delete personal information we have collected about you.</li>
              <li><strong>Right to Opt-Out of Sale/Sharing:</strong> We do not sell or share your personal information for commercial purposes.</li>
              <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights.</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              To exercise any of these rights, please contact us at <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a>. We will respond to your request within 45 days.
            </p>
          </section>

          {/* Updates */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Updates to This Policy</h2>
            <p className="text-foreground leading-relaxed">
              We may update this Cookie Policy from time to time to reflect changes in technology, legislation, or our data practices. We will notify you of significant changes by posting a new version on this page and updating the &quot;Last updated&quot; date. Your continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">9. Contact Us</h2>
            </div>

            <p className="text-foreground leading-relaxed mb-4">
              If you have questions about our use of cookies or this Cookie Policy:
            </p>
            <ul className="space-y-2 text-foreground">
              <li>Email: <a href="mailto:privacy@lokfeel.com" className="text-primary hover:underline">privacy@lokfeel.com</a></li>
              <li>General: <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">hello@lokfeel.com</a></li>
            </ul>
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

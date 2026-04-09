import { Metadata } from "next";
import Link from "next/link";
import { FileText, Scale, AlertTriangle, Users, Mail, Shield, CreditCard } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service - Nexus",
  description: "Read the Terms of Service for using Nexus - your relationship matching platform.",
};

export default function TermsPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Terms of Service</h1>
          <p className="text-white/60">Last updated: April 8, 2026</p>
          <p className="text-white/40 text-sm mt-2">Effective Date: April 8, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Agreement to Terms</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              Welcome to Nexus. These Terms of Service (&quot;Terms&quot;) constitute a legally binding agreement between you (&quot;User,&quot; &quot;you,&quot; or &quot;your&quot;) and <strong>LokFeel Inc.</strong> (&quot;Nexus,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), a Delaware corporation, governing your access to and use of the Nexus service at <strong>app.lokfeel.com</strong> and <strong>lokfeel.com</strong> (collectively, the &quot;Service&quot;).
            </p>
            <p className="text-white/80 leading-relaxed">
              By accessing or using our Service, you agree to be bound by these Terms and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this Service.
            </p>
          </section>

          {/* Service Description */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Scale className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">2. Description of Service</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">
              Nexus provides a relationship matching service that helps users find compatible partners based on relationship psychology principles, including attachment styles, communication preferences, conflict resolution styles, love languages, and life priorities.
            </p>
            <p className="text-white/80 leading-relaxed mb-4">
              Our service includes curated match recommendations, compatibility explanations, and communication tools to facilitate meaningful connections between users.
            </p>
            <p className="text-white/80 leading-relaxed text-sm italic">
              Nexus does not guarantee the accuracy of match recommendations, the suitability of any user, or the success of any relationship. Users are solely responsible for their interactions and safety when meeting others through the Service.
            </p>
          </section>

          {/* User Eligibility */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-white">3. User Eligibility</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">To use Nexus, you must:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Be at least 18 years of age</li>
              <li>Not be prohibited from using the Service under any applicable law</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and promptly update your account information</li>
            </ul>
          </section>

          {/* User Conduct */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-white">4. User Conduct</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">You agree NOT to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Use the Service for any illegal or unauthorized purpose</li>
              <li>Create false, misleading, or fraudulent profiles</li>
              <li>Harass, abuse, threaten, or intimidate other users</li>
              <li>Send unsolicited, inappropriate, or harassing messages</li>
              <li>Collect or harvest other users&apos; information without consent</li>
              <li>Impersonate any person or entity, or misrepresent your identity</li>
              <li>Use automated systems, bots, or scraping tools without authorization</li>
              <li>Upload viruses, malware, or other harmful code</li>
              <li>Attempt to circumvent any content filtering, security, or matching systems</li>
              <li>Solicit money, goods, or personal information from other users</li>
              <li>Use the Service to promote or facilitate prostitution, human trafficking, or exploitation</li>
              <li>Disclose other users&apos; private information without their consent</li>
            </ul>
          </section>

          {/* Account Responsibilities */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">5. Account Responsibilities</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Notify us immediately of any unauthorized use or security breach</li>
              <li>Keep your profile information accurate and up-to-date</li>
              <li>Not share your account credentials with others</li>
              <li>Use strong, unique passwords and enable two-factor authentication when available</li>
              <li>Accept all risks of unauthorized access if you fail to maintain account security</li>
            </ul>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">6. Intellectual Property</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              The Nexus service, including but not limited to the website, mobile application, logos, trademarks (&quot;Nexus&quot; and &quot;LokFeel&quot;), matching algorithms, and content, is owned by LokFeel Inc. and protected by United States and international intellectual property laws.
            </p>
            <p className="text-white/80 leading-relaxed">
              You retain ownership of content you submit but grant us a limited, non-exclusive, royalty-free license to use, reproduce, and display your content solely for the purpose of providing the Service.
            </p>
          </section>

          {/* Payment Terms */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">7. Payment and Subscription</h2>
            </div>
            <p className="text-white/80 leading-relaxed mb-4">
              Nexus offers both free and premium subscription plans. Premium features are billed according to the plan you select:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Monthly subscription: Billed monthly at the current rate</li>
              <li>Annual subscription: Billed annually at a discounted rate</li>
              <li>All payments are processed securely through <strong>Stripe, Inc.</strong>, a PCI DSS Level 1 compliant payment processor</li>
              <li>Subscriptions auto-renew unless cancelled at least 24 hours before the renewal date</li>
              <li>You may cancel at any time; cancellation takes effect at the end of the current billing period</li>
              <li>Refund requests may be submitted to <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> and will be evaluated on a case-by-case basis</li>
            </ul>
          </section>

          {/* Privacy */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-white">8. Privacy</h2>
            </div>
            <p className="text-white/80 leading-relaxed">
              Your use of the Service is also governed by our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> and <Link href="/cookies" className="text-primary hover:underline">Cookie Policy</Link>, which are incorporated by reference into these Terms.
            </p>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">9. Limitation of Liability</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Nexus is not responsible for the conduct, actions, or statements of any users</li>
              <li>We do not guarantee the accuracy, completeness, or suitability of match recommendations</li>
              <li>Users are solely responsible for their own safety when meeting others through the Service</li>
              <li>We are not liable for any indirect, incidental, special, consequential, or punitive damages</li>
              <li>Our total liability shall not exceed the total amount paid by you to Nexus in the 12 months preceding the claim</li>
              <li>We do not warrant that the Service will be uninterrupted, error-free, or secure</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4 text-sm">
              Some jurisdictions do not allow the exclusion of certain warranties or limitation of liability, so some of the above limitations may not apply to you.
            </p>
          </section>

          {/* Indemnification */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">10. Indemnification</h2>
            <p className="text-white/80 leading-relaxed">
              You agree to indemnify, defend, and hold harmless LokFeel Inc., its officers, directors, employees, agents, and affiliates from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorney&apos;s fees) arising from or related to your use of the Service, your violation of these Terms, or your violation of any rights of another party.
            </p>
          </section>

          {/* Termination */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">11. Termination</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We may terminate or suspend your account immediately, without prior notice, for:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Breach of these Terms of Service</li>
              <li>Fraudulent, unlawful, or abusive behavior</li>
              <li>Conduct that may cause harm to other users or the Service</li>
              <li>Inactivity for an extended period (12+ months)</li>
              <li>At our sole discretion, with or without cause</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              You may terminate your account at any time by deleting it through your account settings or contacting <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a>.
            </p>
          </section>

          {/* Changes to Terms */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">12. Modifications to Terms</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We reserve the right to modify these Terms at any time. We will notify users of significant changes:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Via email to the address associated with your account</li>
              <li>Through a prominent notice on the Service</li>
              <li>At least 30 days before the effective date of material changes</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              Continued use of the Service after changes constitutes acceptance of the modified Terms.
            </p>
          </section>

          {/* Dispute Resolution */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">13. Dispute Resolution</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              <strong>Informal Resolution:</strong> Before filing any legal claim, you agree to first contact us at <a href="mailto:legal@lokfeel.com" className="text-primary hover:underline">legal@lokfeel.com</a> and attempt to resolve the dispute informally. We will attempt to resolve the dispute within 30 days.
            </p>
            <p className="text-white/80 leading-relaxed mb-4">
              <strong>Arbitration:</strong> Any dispute not resolved informally shall be resolved by binding arbitration administered by the American Arbitration Association (AAA) under its Consumer Arbitration Rules. The arbitration shall be conducted in Wilmington, Delaware, or at another mutually agreed location.
            </p>
            <p className="text-white/80 leading-relaxed">
              <strong>Class Action Waiver:</strong> You agree to resolve disputes with us on an individual basis only and waive any right to bring or participate in class actions, collective actions, or representative proceedings.
            </p>
          </section>

          {/* Governing Law */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">14. Governing Law</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              These Terms shall be governed by and construed in accordance with the laws of the <strong>State of Delaware, USA</strong>, without regard to its conflict of law provisions.
            </p>
            <p className="text-white/80 leading-relaxed">
              For US users, these Terms comply with applicable federal and state laws, including but not limited to the California Consumer Privacy Act (CCPA), the CAN-SPAM Act, and the Children&apos;s Online Privacy Protection Act (COPPA).
            </p>
          </section>

          {/* General Provisions */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">15. General Provisions</h2>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Entire Agreement:</strong> These Terms, together with the Privacy Policy and Cookie Policy, constitute the entire agreement between you and Nexus.</li>
              <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions remain in full force and effect.</li>
              <li><strong>Waiver:</strong> Our failure to enforce any right under these Terms does not constitute a waiver of that right.</li>
              <li><strong>Assignment:</strong> You may not assign these Terms without our written consent. We may assign our rights and obligations freely.</li>
            </ul>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">16. Contact Information</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">
              If you have any questions about these Terms of Service:
            </p>
            <div className="space-y-2 text-white/80">
              <p><strong>Legal:</strong> <a href="mailto:legal@lokfeel.com" className="text-primary hover:underline">legal@lokfeel.com</a></p>
              <p><strong>General:</strong> <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">hello@lokfeel.com</a></p>
              <p><strong>Support:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p className="text-white/50 text-sm mt-4">
                LokFeel Inc.<br />
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

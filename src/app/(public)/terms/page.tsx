import { Metadata } from "next";
import Link from "next/link";
import { FileText, Scale, AlertTriangle, Users, Mail } from "lucide-react";

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
          <p className="text-white/60">Last updated: January 15, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Agreement to Terms</h2>
            <p className="text-white/80 leading-relaxed">
              Welcome to Nexus. By accessing or using our service, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
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
              Nexus provides a relationship matching service that helps users find compatible partners based on relationship psychology principles, including attachment styles, communication preferences, and relationship goals.
            </p>
            <p className="text-white/80 leading-relaxed">
              Our service includes curated match recommendations, compatibility explanations, and communication tools to facilitate meaningful connections between users.
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
              <li>Be single and seeking a relationship</li>
              <li>Provide accurate and complete information</li>
              <li>Not be prohibited from using our services under applicable law</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
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
              <li>Use the service for any illegal or unauthorized purpose</li>
              <li>Create false, misleading, or fraudulent profiles</li>
              <li>Harass, abuse, or threaten other users</li>
              <li>Send unsolicited or inappropriate messages</li>
              <li>Collect or harvest other users' information without consent</li>
              <li>Impersonate any person or entity</li>
              <li>Use automated systems or bots without authorization</li>
              <li>Upload viruses, malware, or other harmful code</li>
              <li>Attempt to circumvent any content filtering systems</li>
              <li>Solicit money or personal information from other users</li>
            </ul>
          </section>

          {/* Account Responsibilities */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">5. Account Responsibilities</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Notify us immediately of any unauthorized use</li>
              <li>Keep your profile information accurate and up-to-date</li>
              <li>Not share your account with others</li>
              <li>Use strong, unique passwords</li>
            </ul>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">6. Intellectual Property</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              The Nexus service, including but not limited to the website, mobile application, logos, trademarks, and content, is owned by Nexus and protected by intellectual property laws.
            </p>
            <p className="text-white/80 leading-relaxed">
              You retain ownership of content you submit but grant us a license to use it for providing the service.
            </p>
          </section>

          {/* Payment Terms */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">7. Payment and Subscription</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              Nexus offers both free and premium subscription plans. Premium features are billed according to the plan you select:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Monthly subscription: Billed monthly at the current rate</li>
              <li>Annual subscription: Billed annually at a discounted rate</li>
              <li>All payments are processed securely through Stripe</li>
              <li>Subscriptions renew automatically unless cancelled</li>
              <li>No refunds for partial months (30-day notice for cancellation)</li>
            </ul>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">8. Limitation of Liability</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              To the fullest extent permitted by law:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Nexus is not responsible for the conduct of any users</li>
              <li>We do not guarantee the accuracy of match recommendations</li>
              <li>Users are responsible for their own safety when meeting others</li>
              <li>We are not liable for any indirect, incidental, or consequential damages</li>
              <li>Our total liability is limited to the amount you paid us in the past 12 months</li>
            </ul>
          </section>

          {/* Indemnification */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">9. Indemnification</h2>
            <p className="text-white/80 leading-relaxed">
              You agree to indemnify and hold harmless Nexus, its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from your use of the service or violation of these Terms.
            </p>
          </section>

          {/* Termination */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">10. Termination</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We may terminate or suspend your account immediately, without prior notice, for:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Breach of these Terms of Service</li>
              <li>Fraudulent, unlawful, or abusive behavior</li>
              <li>Inactivity for an extended period</li>
              <li>At our sole discretion</li>
            </ul>
          </section>

          {/* Changes to Terms */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">11. Modifications to Terms</h2>
            <p className="text-white/80 leading-relaxed">
              We reserve the right to modify these terms at any time. We will notify users of significant changes via email or through the service. Continued use after changes constitutes acceptance of the modified terms.
            </p>
          </section>

          {/* Governing Law */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">12. Governing Law</h2>
            <p className="text-white/80 leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, USA, without regard to its conflict of law provisions.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white">13. Contact Information</h2>
            </div>
            
            <p className="text-white/80 leading-relaxed mb-4">
              If you have any questions about these Terms of Service, please contact us:
            </p>
            <p className="text-white/80">
              Email: <a href="mailto:legal@nexus.dating" className="text-primary hover:underline">legal@nexus.dating</a>
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

import { Metadata } from "next";
import Link from "next/link";
import { FileText, Users, CreditCard, Shield, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Fan/Creator Agreement - LokFeel",
  description: "Contract between Fan and Creator on LokFeel platform.",
};

export default function FanCreatorAgreementPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Fan / Creator Agreement</h1>
          <p className="text-foreground-muted">Last updated: May 21, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <p className="text-foreground leading-relaxed">
              This Contract between Fan and Creator ("Agreement") governs each interaction between a Fan and a Creator on LokFeel.com ("LokFeel"). By using LokFeel, both Fans and Creators agree to the terms outlined below.
            </p>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Parties</h2>
            <div className="space-y-4">
              <div className="glass p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-foreground mb-2">Fan</h3>
                <p className="text-foreground leading-relaxed">
                  An individual who accesses and interacts with content provided by Creators on LokFeel. Fans may purchase subscriptions, credits, or other offerings to access exclusive content.
                </p>
              </div>
              <div className="glass p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-foreground mb-2">Creator</h3>
                <p className="text-foreground leading-relaxed">
                  An individual who creates and shares content on LokFeel for Fans. Creators may monetize their content through subscriptions, tips, pay-per-view messages, and other features offered by LokFeel.
                </p>
              </div>
            </div>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">2. Content Access and Interaction</h2>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Fans may access content from Creators by purchasing subscriptions, credits, or other offerings as made available by the Creator.</li>
              <li>Creators are responsible for the content they upload and share on LokFeel.</li>
              <li>LokFeel is not a party to this Agreement but facilitates the platform for interactions between Fans and Creators.</li>
              <li>Creators may set their own subscription prices and content access levels, subject to LokFeel's policies.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">3. Payments and Refunds</h2>
            <div className="space-y-4 text-foreground leading-relaxed">
              <p>
                <strong>Payment Processing:</strong> All payments made by Fans to access Creator content are processed through LokFeel's payment system. Payment methods include major credit cards, debit cards, and other payment methods as made available.
              </p>
              <p>
                <strong>Refund Policy:</strong> All payments made by Fans to access Creator content are final and non-refundable, except as outlined in LokFeel's <Link href="/refunds" className="text-primary hover:underline">Refund Policy</Link>.
              </p>
              <p>
                <strong>Creator Earnings:</strong> Creators receive a percentage of the payments made by Fans, as specified in the Creator's agreement with LokFeel. Payment to Creators is subject to a minimum payout threshold and processing fees.
              </p>
              <p>
                <strong>Tax Obligations:</strong> Creators are solely responsible for all taxes, fees, and governmental charges related to their earnings on LokFeel. LokFeel may withhold taxes as required by applicable law.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">4. Content Ownership and License</h2>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Creators retain ownership of the content they upload to LokFeel.</li>
              <li>By uploading content, Creators grant LokFeel a non-exclusive, worldwide, royalty-free, sublicensable license to use, display, distribute, modify (for technical purposes), and promote the content on the platform as necessary to provide services.</li>
              <li>Fans are granted a limited, non-transferable, non-sublicensable license to access content for personal use only.</li>
              <li>Fans may not copy, download, distribute, or share Creator content outside of the LokFeel platform.</li>
              <li>Creators represent and warrant that they own or have the necessary rights to all content they upload.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">5. Prohibited Conduct</h2>
            <p className="text-foreground leading-relaxed mb-4">
              Fans and Creators agree not to engage in any of the following:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Share, distribute, or reproduce content outside of LokFeel.</li>
              <li>Engage in harassment, abuse, hate speech, or any unlawful behavior.</li>
              <li>Use LokFeel for any illegal or unauthorized purposes.</li>
              <li>Upload content that violates any third-party rights (copyright, trademark, privacy, etc.).</li>
              <li>Upload content that is defamatory, obscene, indecent, or otherwise objectionable.</li>
              <li>Attempt to circumvent LokFeel's payment system or engage in fraud.</li>
              <li>Share login credentials or allow others to access their account.</li>
              <li>Use automated tools to access or interact with the platform.</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Content Guidelines</h2>
            <div className="space-y-4 text-foreground leading-relaxed">
              <p>
                <strong>Age Verification:</strong> Creators must be at least 18 years of age and must verify their identity and age through LokFeel's verification process before uploading content.
              </p>
              <p>
                <strong>Consent:</strong> Creators must have explicit consent from all individuals depicted in their content before uploading.
              </p>
              <p>
                <strong>Prohibited Content:</strong> The following content is prohibited on LokFeel:
              </p>
              <ul className="list-disc list-inside text-foreground space-y-1 ml-8">
                <li>Content involving individuals under 18 years of age</li>
                <li>Non-consensual content</li>
                <li>Violent, abusive, or harmful content</li>
                <li>Illegal content as defined by applicable laws</li>
              </ul>
            </div>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">7. Termination</h2>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Either party (Fan or Creator) may terminate this Agreement at any time by ceasing use of LokFeel.</li>
              <li>LokFeel reserves the right to suspend or terminate accounts that violate this Agreement or LokFeel's policies.</li>
              <li>Upon termination, Fans will lose access to Creator content. Creators will no longer receive new subscriptions or payments.</li>
              <li>Creators may request payout of their remaining balance subject to LokFeel's payout schedule and policies.</li>
            </ul>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Disclaimer of Warranties</h2>
            <p className="text-foreground leading-relaxed">
              LokFeel provides the platform on an "as is" and "as available" basis. LokFeel disclaims all warranties, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. LokFeel does not guarantee that the platform will be uninterrupted, error-free, or secure.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">9. Limitation of Liability</h2>
            <p className="text-foreground leading-relaxed">
              To the maximum extent permitted by applicable law, LokFeel shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from (a) your access to or use of or inability to access or use the Service; (b) any conduct or content of any third party on the Service; or (c) unauthorized access, use, or alteration of your transmissions or content.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">10. Dispute Resolution</h2>
            <p className="text-foreground leading-relaxed">
              Any disputes arising under this Agreement shall be resolved in accordance with LokFeel's <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>. You agree that any legal action or proceeding arising under this Agreement shall be brought exclusively in the courts located in Wilmington, Delaware, USA, and you consent to the personal jurisdiction thereof.
            </p>
          </section>

          {/* Section 11 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">11. Miscellaneous</h2>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>This Agreement is subject to change. Continued use of LokFeel constitutes acceptance of any revised terms.</li>
              <li>If any provision of this Agreement is found to be unenforceable, the remaining provisions will remain in effect.</li>
              <li>This Agreement constitutes the entire agreement between you and LokFeel regarding the subject matter hereof.</li>
              <li>You may not assign or transfer this Agreement without LokFeel's prior written consent.</li>
            </ul>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Questions?</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              If you have any questions about this Fan/Creator Agreement, please contact us:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Email:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p><strong>Subject Line:</strong> Fan/Creator Agreement Inquiry</p>
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

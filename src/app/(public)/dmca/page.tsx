import { Metadata } from "next";
import Link from "next/link";
import { FileText, AlertTriangle, Mail, Scale, Globe } from "lucide-react";

export const metadata: Metadata = {
  title: "DMCA Policy - LokFee!",
  description: "Digital Millennium Copyright Act policy for LokFee!.",
};

export default function DMCAPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">DMCA Policy</h1>
          <p className="text-foreground-muted">Last updated: May 21, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. DMCA Notice of Alleged Copyright Infringement</h2>
            <p className="text-foreground leading-relaxed mb-4">
              LokFee! respects the intellectual property rights of others and expects users to do the same. In accordance with the Digital Millennium Copyright Act (DMCA), we will respond to valid takedown notices regarding claimed copyright infringement.
            </p>
            <p className="text-foreground leading-relaxed">
              If you believe that content on LokFee! infringes your copyright, please submit a written notification to our Copyright Agent with the following information:
            </p>
          </section>

          {/* Notification Requirements */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">2. Notification Requirements</h2>
            <p className="text-foreground leading-relaxed mb-4">Your written notification must include:</p>
            <ul className="list-decimal list-inside text-foreground space-y-2 ml-4">
              <li>A physical or electronic signature of the copyright owner or a person authorized to act on their behalf</li>
              <li>Identification of the copyrighted work claimed to have been infringed</li>
              <li>Identification of the infringing material and information reasonably sufficient to locate it on our Service</li>
              <li>Your contact information (address, telephone number, and email address)</li>
              <li>A statement that you have a good faith belief that use of the material is not authorized by the copyright owner, its agent, or the law</li>
              <li>A statement that the information in the notification is accurate and, under penalty of perjury, that you are authorized to act on behalf of the copyright owner</li>
            </ul>
          </section>

          {/* Counter-Notification */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">3. Counter-Notification</h2>
            <p className="text-foreground leading-relaxed mb-4">
              If you believe your content was removed by mistake or misidentification, you may file a counter-notification with us. A valid counter-notification must include:
            </p>
            <ul className="list-decimal list-inside text-foreground space-y-2 ml-4">
              <li>Your physical or electronic signature</li>
              <li>Identification of the removed content and its location before removal</li>
              <li>A statement under penalty of perjury that you have a good faith belief the content was removed by mistake or misidentification</li>
              <li>Your name, address, telephone number, and a statement that you consent to jurisdiction of the federal district court where you are located</li>
            </ul>
          </section>

          {/* Repeat Infringers */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">4. Repeat Infringer Policy</h2>
            <p className="text-foreground leading-relaxed">
              LokFee! maintains a policy of terminating, in appropriate circumstances, the accounts of users who are repeat infringers. We also may, at our sole discretion, limit access to the Service and/or terminate the accounts of any users who infringe the intellectual property rights of others.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">5. Contact Our Copyright Agent</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              DMCA notifications and counter-notifications should be sent to:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Email:</strong> <a href="mailto:dmca@lokfeel.com" className="text-primary hover:underline">dmca@lokfeel.com</a></p>
              <p><strong>Subject Line:</strong> DMCA Takedown Notice / DMCA Counter-Notification</p>
              <p className="text-foreground-muted text-sm mt-4">
                LokFee! Inc.<br />
                Wilmington, Delaware, USA
              </p>
            </div>
          </section>

          {/* Modifications */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Modifications</h2>
            <p className="text-foreground leading-relaxed">
              We reserve the right to modify this DMCA Policy at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service after changes constitutes acceptance of the updated policy.
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

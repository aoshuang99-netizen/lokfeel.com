import { Metadata } from "next";
import Link from "next/link";
import { FileText, AlertTriangle, Mail, Scale, Globe } from "lucide-react";

export const metadata: Metadata = {
  title: "18 U.S.C. 2257 Compliance - LokFeel",
  description: "Record Keeping Requirements compliance statement for LokFeel.",
};

export default function USC2257Page() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Scale className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">18 U.S.C. 2257 Compliance</h1>
          <p className="text-foreground-muted">Record Keeping Requirements Compliance Statement</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          {/* Section 1 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Age Verification and Compliance</h2>
            <p className="text-foreground leading-relaxed mb-4">
              In compliance with 18 U.S.C. § 2257, all models, performers, actors, actresses, and other persons appearing in any audio and/or visual depiction of content featuring actual sexually explicit conduct, simulated sexual content, or other content as defined under federal law, appearing on the LokFeel website(s) were at least eighteen (18) years of age at the time of the content creation and adhere to 18 U.S.C. § 2257 age verification standards.
            </p>
            <p className="text-foreground leading-relaxed">
              LokFeel requires all users who upload visual content to verify their age and identity in accordance with applicable laws and regulations.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">2. Site Operator Liability and Exemptions</h2>
            <p className="text-foreground leading-relaxed mb-4">
              The operators of this website are not the "producers" of any depictions of actual or simulated sexually explicit materials appearing within, except where such content is created, developed, or produced by LokFeel as the operator.
            </p>
            <p className="text-foreground leading-relaxed mb-4">
              All content on this site that is uploaded by users is independently produced by and communicated privately between adult users of the service(s). Users of the service are independently responsible for creating and uploading their own images, videos, texts, and audio/visual content materials.
            </p>
            <p className="text-foreground leading-relaxed">
              The services provided by this website constitute it as an "interactive computer service" as stated under 47 U.S.C. § 230(c). Furthermore, this site is defined under 47 U.S.C. § 231(e) as an "internet access service", and as such, may be legally exempt from being defined or considered as a producer under certain provisions of 18 U.S.C. § 2257(h)(2)(B). Users are encouraged to consult legal counsel regarding applicable requirements.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">3. Operator Rights to Remove Content</h2>
            <p className="text-foreground leading-relaxed">
              In accordance with 18 U.S.C. § 2257(h)(2)(B)(v) and 47 U.S.C. § 230(c), the operators of the site reserve the right to delete content materializing on the site as the effect of arrangements taken by the site's users, when content is identified, in the operator's exclusive opinion, to be defamatory, obscene, indecent, or inconsistent with the Terms of Service for the site.
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">4. Additional Exemptions for Content</h2>
            <p className="text-foreground leading-relaxed mb-4">
              In the event that any content appears on this site that would construe the site operators as "producers", those content items are further exempt from the requirements of 18 U.S.C. § 2257 and 28 C.F.R. Part 75 for one or more of the following reasons:
            </p>
            <ul className="list-decimal list-inside text-foreground space-y-2 ml-4">
              <li>The produced content does not illustrate any sexually explicit conduct as defined in 18 U.S.C. § 2256(2)(A);</li>
              <li>The produced content does not illustrate depictions of the genitals or pubic area created after July 27, 2006;</li>
              <li>The produced content does not illustrate simulated sexually explicit activity occurring after the effective date of 18 U.S.C. § 2257A;</li>
              <li>The produced content was created prior to July 3, 1995.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">5. User Age and Legal Compliance Requirements</h2>
            <p className="text-foreground leading-relaxed mb-4">
              LokFeel requires all users, models, performers, actors, actresses, or otherwise who access or use any area of the website to be a minimum of eighteen (18) years of age.
            </p>
            <p className="text-foreground leading-relaxed mb-4">
              By using the service, users, models, performers, actors, actresses, or otherwise are required to follow all applicable local, state, federal, and international laws, regulations, and ordinances relating to obscene and indecent content, communications, and record keeping obligations.
            </p>
            <p className="text-foreground leading-relaxed">
              Users, models, performers, actors, actresses, or otherwise are exclusively responsible for the content provided and the content created through their LokFeel account. Users are exclusively responsible for ensuring that they are in compliance with all applicable laws and regulations, including but not limited to providing record location information pursuant to 18 U.S.C. § 2257 and related regulations where applicable.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Age Verification Process</h2>
            <p className="text-foreground leading-relaxed mb-4">
              LokFeel employs industry-standard age verification measures to ensure compliance with 18 U.S.C. § 2257 and related regulations. These measures may include:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Government-issued identification verification</li>
              <li>Third-party age verification services</li>
              <li>Payment method verification</li>
              <li>Self-declaration with periodic audits</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              Users who fail to provide satisfactory age verification may have their accounts suspended or terminated.
            </p>
          </section>

          {/* Custodian of Records */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">7. Custodian of Records Information</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              Records required pursuant to 18 U.S.C. § 2257 and 28 C.F.R. Part 75 are maintained by the following Custodian of Records:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Custodian of Records</strong></p>
              <p>LokFeel Inc.</p>
              <p>Wilmington, Delaware, USA</p>
              <p className="mt-4">
                <strong>Contact Email:</strong> <a href="mailto:compliance@lokfeel.com" className="text-primary hover:underline">compliance@lokfeel.com</a>
              </p>
            </div>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Modifications</h2>
            <p className="text-foreground leading-relaxed">
              We reserve the right to modify this Compliance Statement at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service after changes constitutes acceptance of the updated statement.
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

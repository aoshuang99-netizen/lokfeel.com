import { Metadata } from "next";
import Link from "next/link";
import { Scale, Clock, Mail, AlertTriangle, FileText, CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Appeals Policy - LokFeel",
  description: "LokFeel's policy on appeals and dispute resolution.",
};

export default function AppealsPolicyPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Scale className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Appeals Policy</h1>
          <p className="text-foreground-muted">Last updated: May 21, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Overview</h2>
            <p className="text-foreground leading-relaxed mb-4">
              At LokFeel, we strive to make fair and accurate decisions. However, we understand that mistakes can happen. This Appeals Policy outlines the process for appealing decisions made by LokFeel regarding account actions, content removal, or billing disputes.
            </p>
            <p className="text-foreground leading-relaxed">
              If you believe a decision was made in error, you have the right to appeal. We will review your appeal fairly and impartially.
            </p>
          </section>

          {/* Grounds for Appeal */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">2. Grounds for Appeal</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">You may file an appeal for:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Account Suspension/Termination:</strong> If your account was suspended or terminated and you believe the decision was incorrect</li>
              <li><strong>Content Removal:</strong> If your content was removed and you believe it did not violate our policies</li>
              <li><strong>Billing Disputes:</strong> If you were charged incorrectly or denied a refund unfairly</li>
              <li><strong>Feature Restrictions:</strong> If your access to certain features was restricted unfairly</li>
              <li><strong>False Reports:</strong> If you were reported falsely by another user</li>
            </ul>
          </section>

          {/* Appeal Process */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">3. Appeal Process</h2>
            <ol className="list-decimal list-inside text-foreground space-y-4 ml-4">
              <li>
                <strong>Submit Appeal:</strong> Send an email to <a href="mailto:appeals@lokfeel.com" className="text-primary hover:underline">appeals@lokfeel.com</a> with:
                <ul className="list-disc list-inside ml-8 mt-2 space-y-1 text-foreground-muted">
                  <li>Your account email address</li>
                  <li>The decision you are appealing (with dates if possible)</li>
                  <li>A clear explanation of why you believe the decision was incorrect</li>
                  <li>Any supporting evidence (screenshots, messages, etc.)</li>
                </ul>
              </li>
              <li><strong>Acknowledgment:</strong> You will receive an automated confirmation within 24 hours</li>
              <li><strong>Review:</strong> Our appeals team will review your case impartially (typically within 5-7 business days)</li>
              <li><strong>Decision:</strong> You will receive a written decision via email explaining the outcome and reasoning</li>
              <li><strong>Further Review:</strong> If you are not satisfied with the appeal decision, you may request a secondary review within 14 days</li>
            </ol>
          </section>

          {/* Billing Disputes */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">4. Billing Disputes</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              For billing-related appeals (incorrect charges, denied refunds, etc.):
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>Contact <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> first</li>
              <li>Include your transaction ID, date of charge, and reason for dispute</li>
              <li>We will review your case within 5 business days</li>
              <li>If you are not satisfied with the outcome, you may file a formal appeal to <a href="mailto:appeals@lokfeel.com" className="text-primary hover:underline">appeals@lokfeel.com</a></li>
              <li><strong>Note:</strong> Filing a chargeback with your bank before contacting us may result in immediate account suspension</li>
            </ul>
          </section>

          {/* Timeline */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-info" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">5. Appeal Timeline</h2>
            </div>
            
            <div className="space-y-4">
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Initial Acknowledgment</h4>
                <p className="text-foreground-muted text-sm">Within 24 hours of submission</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Standard Review</h4>
                <p className="text-foreground-muted text-sm">5-7 business days for most appeals</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Complex Cases</h4>
                <p className="text-foreground-muted text-sm">Up to 14 business days if additional investigation is required</p>
              </div>
              <div className="glass border-card-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2">Secondary Review Request</h4>
                <p className="text-foreground-muted text-sm">Must be requested within 14 days of the initial decision</p>
              </div>
            </div>
          </section>

          {/* Final Decisions */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">6. Final Decisions</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              Appeal decisions are made by our appeals team and are final, except in the following circumstances:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li>You may request a secondary review within 14 days if you have new evidence</li>
              <li>If you believe our decision violates applicable law, you may pursue legal remedies as outlined in our <Link href="/terms#dispute-resolution" className="text-primary hover:underline">Terms of Service (Dispute Resolution)</Link></li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              Repeated or frivolous appeals may result in restricted access to the appeals process.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">7. Contact Our Appeals Team</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              For appeals or questions about this policy:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Appeals Email:</strong> <a href="mailto:appeals@lokfeel.com" className="text-primary hover:underline">appeals@lokfeel.com</a></p>
              <p><strong>Billing Disputes:</strong> <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a></p>
              <p><strong>Subject Line:</strong> Appeal - [Your Account Email]</p>
              <p className="text-foreground-muted text-sm mt-4">
                LokFeel Inc.<br />
                Wilmington, Delaware, USA
              </p>
            </div>
          </section>

          {/* Modifications */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Modifications to This Policy</h2>
            <p className="text-foreground leading-relaxed">
              We reserve the right to modify this Appeals Policy at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service after changes constitutes acceptance of the updated policy.
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

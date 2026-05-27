import { Metadata } from "next";
import Link from "next/link";
import { RefreshCw, Clock, AlertCircle, Mail, Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "Refunds Policy - LokFeel",
  description: "LokFeel's refund policy for subscriptions and payments.",
};

export default function RefundsPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <RefreshCw className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Refunds Policy</h1>
          <p className="text-foreground-muted">Last updated: May 21, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Overview</h2>
            <p className="text-foreground leading-relaxed mb-4">
              At LokFeel, we strive to provide a high-quality relationship matching service. This Refunds Policy outlines the circumstances under which refunds may be issued for subscriptions, credits, or other paid features purchased through the Service.
            </p>
            <p className="text-foreground leading-relaxed">
              All refund requests must be submitted to <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> with your account email and reason for the refund request.
            </p>
          </section>

          {/* Eligibility for Refunds */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Scale className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">2. Refund Eligibility</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">Refunds may be considered in the following circumstances:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Technical Issues:</strong> If a technical error prevented you from accessing the Service you paid for</li>
              <li><strong>Duplicate Charges:</strong> If you were charged more than once for the same transaction</li>
              <li><strong>Unauthorized Charges:</strong> If you did not authorize a charge (subject to investigation)</li>
              <li><strong>Service Unavailability:</strong> If the Service is unavailable for an extended period due to our fault</li>
              <li><strong>First-Time Subscription Cancellation:</strong> If you cancel your first subscription within 14 days of purchase and have not used substantial premium features</li>
            </ul>
          </section>

          {/* Non-Refundable Items */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-danger/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-danger" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">3. Non-Refundable Items</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">The following are generally <strong>not eligible</strong> for refunds:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Used Credits:</strong> Credits that have already been used to send messages</li>
              <li><strong>Partial Subscription Periods:</strong> Unused portions of a subscription period (unless within the 14-day cooling-off period)</li>
              <li><strong>Free Trial Conversions:</strong> Charges after a free trial converts to a paid subscription (unless cancelled before the trial ends)</li>
              <li><strong>Change of Mind:</strong> If you simply no longer wish to use the Service but have already used premium features</li>
              <li><strong>User Misconduct:</strong> Accounts terminated for violation of our Terms of Service are not eligible for refunds</li>
            </ul>
          </section>

          {/* Refund Process */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">4. Refund Process</h2>
            <ol className="list-decimal list-inside text-foreground space-y-3 ml-4">
              <li><strong>Submit Request:</strong> Email <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> with your account email, transaction ID (if available), and reason for refund</li>
              <li><strong>Review:</strong> Our billing team will review your request within 5-7 business days</li>
              <li><strong>Investigation:</strong> We may request additional information to verify your claim</li>
              <li><strong>Decision:</strong> You will receive a written decision via email</li>
              <li><strong>Processing:</strong> Approved refunds will be processed to the original payment method within 5-10 business days</li>
            </ol>
          </section>

          {/* Subscription Cancellations */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">5. Subscription Cancellations vs. Refunds</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              Cancelling your subscription is different from requesting a refund:
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Cancellation:</strong> Stops future billing. Your premium features remain active until the end of the current billing period. No automatic refund for the remaining period.</li>
              <li><strong>Refund:</strong> A request to recover funds already paid. Subject to the eligibility criteria above.</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              To cancel your subscription, go to Account Settings → Manage Subscription. For refund requests, contact <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a>.
            </p>
          </section>

          {/* Chargebacks */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Chargebacks and Payment Disputes</h2>
            <p className="text-foreground leading-relaxed mb-4">
              Before filing a chargeback with your bank or credit card company, we ask that you contact us first at <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a>. We are typically able to resolve billing issues quickly and fairly.
            </p>
            <p className="text-foreground leading-relaxed">
              Filing a chargeback without first contacting us may result in immediate account suspension. If a chargeback is found to be fraudulent or invalid, we reserve the right to permanently terminate your account and report the fraud to relevant authorities.
            </p>
          </section>

          {/* Modifications */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">7. Modifications to This Policy</h2>
            <p className="text-foreground leading-relaxed">
              We reserve the right to modify this Refunds Policy at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* Contact */}
          <section className="glass border-primary/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">8. Contact Us</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              For refund requests or billing questions:
            </p>
            <div className="space-y-2 text-foreground">
              <p><strong>Billing Email:</strong> <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a></p>
              <p><strong>Support:</strong> <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">support@lokfeel.com</a></p>
              <p className="text-foreground-muted text-sm mt-4">
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

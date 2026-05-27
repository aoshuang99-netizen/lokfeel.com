import { Metadata } from "next";
import Link from "next/link";
import { Ban, Clock, RefreshCw, AlertTriangle, Mail, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Cancellations Policy - LokFeel",
  description: "LokFeel's policy on subscription cancellations.",
};

export default function CancellationsPolicyPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Ban className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Cancellations Policy</h1>
          <p className="text-foreground-muted">Last updated: May 21, 2026</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-12">
          
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Overview</h2>
            <p className="text-foreground leading-relaxed mb-4">
              This Cancellations Policy explains how you can cancel your LokFeel subscription, what happens when you cancel, and the differences between cancellation, refunds, and account deletion.
            </p>
            <p className="text-foreground leading-relaxed">
              You can cancel your subscription at any time. Cancellation stops future billing but does not automatically trigger a refund unless you are within the 14-day cooling-off period and meet the refund eligibility criteria in our <Link href="/refunds" className="text-primary hover:underline">Refunds Policy</Link>.
            </p>
          </section>

          {/* How to Cancel */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">2. How to Cancel Your Subscription</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">You can cancel your LokFeel subscription through the following methods:</p>
            <ol className="list-decimal list-inside text-foreground space-y-3 ml-4">
              <li><strong>Through Your Account Settings:</strong> Log in to your account → Go to "Account Settings" → Click "Manage Subscription" → Follow the prompts to cancel</li>
              <li><strong>By Email:</strong> Send a cancellation request to <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> from your registered email address</li>
              <li><strong>Through Stripe Customer Portal:</strong> If you paid via Stripe, you may receive a link to manage your subscription directly through Stripe's customer portal</li>
            </ol>
          </section>

          {/* Effect of Cancellation */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">3. Effect of Cancellation</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">When you cancel your subscription:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Future Billing Stops:</strong> You will not be charged again for the cancelled subscription</li>
              <li><strong>Premium Features Continue:</strong> You retain access to premium features until the end of the current billing period</li>
              <li><strong>No Automatic Refund:</strong> The unused portion of your subscription is not automatically refunded (see our <Link href="/refunds" className="text-primary hover:underline">Refunds Policy</Link> for refund eligibility)</li>
              <li><strong>Account Remains:</strong> Your account is not deleted; you simply revert to the free tier</li>
            </ul>
          </section>

          {/* Cooling-Off Period */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">4. 14-Day Cooling-Off Period</h2>
            <p className="text-foreground leading-relaxed mb-4">
              For first-time subscribers in certain jurisdictions (including the EU and UK), you may have a legal right to cancel within 14 days of purchase and receive a full refund, provided you have not used substantial premium features.
            </p>
            <p className="text-foreground leading-relaxed">
              To exercise this right, contact <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">billing@lokfeel.com</a> within 14 days of your initial purchase. If you have already used premium features extensively, we may deduct a reasonable amount to reflect the value of the services already provided.
            </p>
          </section>

          {/* Auto-Renewal */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">5. Auto-Renewal and Cancellation Timing</h2>
            </div>
            
            <p className="text-foreground leading-relaxed mb-4">
              Subscriptions with auto-renewal enabled will automatically renew at the end of each billing period (monthly or annually). To avoid being charged for the next period, you must cancel before the renewal date.
            </p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Monthly Subscription:</strong> Cancel at least 24 hours before the renewal date</li>
              <li><strong>Annual Subscription:</strong> Cancel at least 7 days before the renewal date (to allow for processing)</li>
            </ul>
          </section>

          {/* Account Deletion vs. Cancellation */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Account Deletion vs. Subscription Cancellation</h2>
            <p className="text-foreground leading-relaxed mb-4">Important distinction:</p>
            <ul className="list-disc list-inside text-foreground space-y-2 ml-4">
              <li><strong>Cancelling Subscription:</strong> Stops future billing; account remains active on free tier; profile and data remain visible to other users</li>
              <li><strong>Deleting Account:</strong> Permanently removes your account and all associated data; cancels any active subscriptions; irreversible</li>
            </ul>
            <p className="text-foreground leading-relaxed mt-4">
              To delete your account, go to Account Settings → Delete Account. This will also cancel your subscription.
            </p>
          </section>

          {/* Resubscribing */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">7. Resubscribing After Cancellation</h2>
            <p className="text-foreground leading-relaxed">
              You may resubscribe at any time after cancellation by going to your Account Settings and selecting a new subscription plan. Your profile and data (if not deleted) will still be available. However, any credits that expired during your cancellation period will not be reinstated.
            </p>
          </section>

          {/* Modifications */}
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Modifications to This Policy</h2>
            <p className="text-foreground leading-relaxed">
              We reserve the right to modify this Cancellations Policy at any time. Changes will be posted on this page with an updated effective date. Continued use of the Service after changes constitutes acceptance of the updated policy.
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
              For cancellation requests or questions about this policy:
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

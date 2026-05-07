import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Email configuration
const SMTP_PASSWORD = process.env.SMTP_PASSWORD?.trim();
const FROM_EMAIL = process.env.SMTP_FROM?.trim() || 'noreply@lokfeel.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() || process.env.SMTP_PASSWORD?.trim(); // Resend uses API key as password

// Create SMTP transporter (fallback)
const transporter = SMTP_PASSWORD ? nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.resend.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'resend',
    pass: SMTP_PASSWORD,
  },
}) : null;

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode(): string {
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
  return (100000 + (randomValue % 900000)).toString();
}

/**
 * Send email using Resend API (preferred) or SMTP fallback
 */
async function sendEmailWithResend(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  // Try Resend API first (more reliable)
  if (RESEND_API_KEY && RESEND_API_KEY.startsWith('re_')) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `"LokFeel" <${FROM_EMAIL}>`,
          to: [to],
          subject,
          html,
          text,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Email sent via Resend API:', data.id);
        return { success: true };
      } else {
        const error = await response.json();
        console.error('Resend API error:', error);
        // Fall through to SMTP
      }
    } catch (error) {
      console.error('Resend API request failed:', error);
      // Fall through to SMTP
    }
  }

  // Fallback to SMTP
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"LokFeel" <${FROM_EMAIL}>`,
        to,
        subject,
        html,
        text,
      });
      console.log('✅ Email sent via SMTP');
      return { success: true };
    } catch (error) {
      console.error('SMTP error:', error);
      return { success: false, error: 'Failed to send email via SMTP' };
    }
  }

  // No email service configured - log for development
  console.log('========================================');
  console.log('📧 EMAIL NOT SENT - No service configured');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('========================================');
  return { success: false, error: 'Email service not configured' };
}

/**
 * Generate a secure magic link token
 */
export function generateMagicToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Send verification email with both code and magic link
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
  name?: string,
  magicToken?: string
): Promise<{ success: boolean; error?: string; devCode?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com';
  const magicLink = magicToken ? `${appUrl}/api/auth/magic-link?token=${magicToken}&email=${encodeURIComponent(email)}` : null;
  
  const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Verify Your Email - LokFeel</title>
</head>
<body style="margin:0; padding:0; background-color:#0d0c11;">
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#0d0c11;">
  <tr>
    <td align="center" style="padding:40px 20px;">
      
      <!-- Logo Section -->
      <table border="0" cellpadding="0" cellspacing="0" width="480" style="max-width:480px; width:100%;">
        <tr>
          <td align="center" style="padding-bottom:30px;">
            <!-- Heart Icon PNG -->
            <img src="https://app.lokfeel.com/logo-icon.png" width="48" height="48" alt="LokFeel" style="display:block; margin:0 auto 12px; border:0;" />
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:28px; font-weight:700; color:#a3e635; text-align:center;">LokFeel</div>
          </td>
        </tr>
      </table>
      
      <!-- Main Card -->
      <table border="0" cellpadding="0" cellspacing="0" width="480" style="max-width:480px; width:100%; background-color:#1a1a1a; border:1px solid rgba(76,29,149,0.2); border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            
            <!-- Title -->
            <h1 style="margin:0 0 20px; font-size:24px; font-weight:600; color:#ffffff; line-height:1.3; text-align:center;">
              Welcome to LokFeel${name ? ', ' + name : ''}!
            </h1>
            
            <!-- Description -->
            <p style="margin:0 0 28px; font-size:16px; color:#cccccc; line-height:1.6; text-align:center;">
              Thank you for signing up. To complete your registration and start your journey to meaningful connections, verify your email:
            </p>
            
            ${magicLink ? `
            <!-- Magic Link Button -->
            <table border="0" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" style="background-color:#a3e635; border-radius:50px;">
                  <a href="${magicLink}" style="display:inline-block; padding:16px 32px; color:#0a0a0a; font-size:16px; font-weight:600; text-decoration:none; border-radius:50px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Verify Email & Continue</a>
                </td>
              </tr>
            </table>
            
            <!-- Divider -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
              <tr>
                <td style="border-top:1px solid #333333; padding-top:24px; text-align:center;">
                  <span style="font-size:14px; color:#888888; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">or use verification code</span>
                </td>
              </tr>
            </table>
            ` : ''}
            
            <!-- Verification Code Box -->
            <table border="0" cellpadding="0" cellspacing="0" style="margin:20px auto; background-color:#1a0a2e; border:2px dashed #4c1d95; border-radius:12px;">
              <tr>
                <td align="center" style="padding:24px 40px;">
                  <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#a3e635; font-family:'Courier New',monospace;">${code}</span>
                </td>
              </tr>
            </table>
            
            <!-- Expiry Note -->
            <p style="margin:20px 0 0; font-size:14px; color:#888888; text-align:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              This verification will expire in 10 minutes.
            </p>
            
            <!-- Ignore Note -->
            <p style="margin:16px 0 0; font-size:13px; color:#666666; text-align:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              If you didn't create an account with LokFeel, you can safely ignore this email.
            </p>
            
          </td>
        </tr>
      </table>
      
      <!-- Footer -->
      <table border="0" cellpadding="0" cellspacing="0" width="480" style="max-width:480px; width:100%; margin-top:30px;">
        <tr>
          <td align="center" style="font-size:12px; color:#666666; line-height:1.6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 4px;">LokFeel Inc. • hello@lokfeel.com</p>
            <p style="margin:0;">Building deeper connections through relationship structure matching.</p>
          </td>
        </tr>
      </table>
      
    </td>
  </tr>
</table>
</body>
</html>`;

  const result = await sendEmailWithResend(
    email,
    'Verify your email - LokFeel',
    htmlContent,
    `Welcome to LokFeel! ${magicLink ? `Click to verify: ${magicLink} ` : ''}Your verification code is: ${code}. This code will expire in 10 minutes.`
  );

  // Return actual result - let caller decide how to handle failure
  // The register API will show code to user if email fails
  return result;
}

/**
 * Send SMS verification code (Twilio or dev mode fallback)
 */
export async function sendSMSVerification(
  phone: string,
  code: string,
  name?: string
): Promise<{ success: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_FROM_NUMBER

  if (accountSid && authToken && fromNumber) {
    // Real Twilio send
    try {
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${auth}`,
          },
          body: new URLSearchParams({
            To: phone,
            From: fromNumber,
            Body: `LokFeel verification code: ${code}. Valid for 10 minutes. Don't share this code.`,
          }),
        }
      )

      if (response.ok) {
        console.log(`✅ SMS sent via Twilio to ${phone}`)
        return { success: true }
      } else {
        const err = await response.text()
        console.error('Twilio error:', err)
      }
    } catch (error) {
      console.error('Twilio send error:', error)
    }

    return { success: false, error: 'Failed to send SMS via Twilio' }
  }

  // No Twilio configured — dev mode fallback
  console.log('========================================')
  console.log('📱 SMS NOT SENT - No Twilio configured');
  console.log('To:', phone);
  console.log('Code:', code);
  console.log('========================================');
  return { success: true }; // Allow proceeding in dev mode
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(
  email: string,
  name?: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com';
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Welcome to LokFeel</title>
</head>
<body style="margin:0; padding:40px 20px; background:#0d0c11; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; text-align:center;">
  
  <!-- Logo -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom:30px;">
    <tr>
      <td style="text-align:center;">
        <div style="font-size:28px; font-weight:700; color:#a3e635;">LokFeel</div>
      </td>
    </tr>
  </table>

  <!-- Main Content -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:480px; width:100%; background:#1a1a1a; border:1px solid rgba(76,29,149,0.3); border-radius:16px;">
    <tr>
      <td style="padding:40px 32px; text-align:center;">
        
        <h1 style="margin:0 0 20px; font-size:24px; font-weight:600; color:#ffffff; line-height:1.3;">
          Welcome to LokFeel${name ? `, ${name}` : ''}!
        </h1>
        
        <p style="margin:0 0 16px; font-size:16px; color:rgba(255,255,255,0.8); line-height:1.6;">
          Your email has been verified successfully. You're now ready to start your journey to meaningful connections.
        </p>
        
        <p style="margin:0 0 28px; font-size:16px; color:rgba(255,255,255,0.8); line-height:1.6;">
          Complete your relationship blueprint profile to receive your first curated matches this week.
        </p>
        
        <!-- CTA Button -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0;">
          <tr>
            <td style="background:linear-gradient(135deg,#4c1d95,#8b5cf6); border-radius:12px; text-align:center;">
              <a href="${appUrl}/onboarding" style="display:inline-block; padding:16px 32px; color:#ffffff; font-size:16px; font-weight:600; text-decoration:none; border-radius:12px;">Complete Your Profile</a>
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-top:30px;">
    <tr>
      <td style="text-align:center; font-size:12px; color:rgba(255,255,255,0.4);">
        <p style="margin:0;">LokFeel Inc. • hello@lokfeel.com</p>
      </td>
    </tr>
  </table>

</body>
</html>
  `;

  return sendEmailWithResend(
    email,
    'Welcome to LokFeel - Start Your Journey',
    htmlContent,
    `Welcome to LokFeel! Your email has been verified. Complete your profile to start receiving matches: ${appUrl}/onboarding`
  );
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  name?: string
): Promise<{ success: boolean; error?: string }> {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reset Your Password - LokFeel</title>
</head>
<body style="margin:0; padding:40px 20px; background-color:#0a0a0a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; text-align:center;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom:30px;">
    <tr>
      <td style="text-align:center;">
        <div style="font-size:28px; font-weight:700; color:#a3e635;">LokFeel</div>
      </td>
    </tr>
  </table>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:480px; width:100%; background:#111111; border:1px solid rgba(76,29,149,0.2); border-radius:16px;">
    <tr>
      <td style="padding:40px 32px; text-align:center;">

        <h1 style="margin:0 0 20px; font-size:24px; font-weight:600; color:#ffffff; line-height:1.3;">
          Reset Your Password
        </h1>

        <p style="margin:0 0 28px; font-size:16px; color:rgba(255,255,255,0.65); line-height:1.6;">
          We received a request to reset the password for your LokFeel account${name ? `, ${name}` : ''}. Click the button below to create a new password.
        </p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 0 28px;">
          <tr>
            <td style="background-color:#a3e635; border-radius:12px; text-align:center;">
              <a href="${resetUrl}" style="display:inline-block; padding:16px 32px; color:#0a0a0a; font-size:16px; font-weight:600; text-decoration:none; border-radius:12px;">Reset Password</a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 20px; font-size:14px; color:rgba(255,255,255,0.45); line-height:1.6;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 28px; font-size:13px; color:#a3e635; word-break:break-all;">
          ${resetUrl}
        </p>

        <p style="margin:20px 0 0; font-size:14px; color:rgba(255,255,255,0.45); text-align:center;">
          This link will expire in 30 minutes.
        </p>

        <p style="margin:16px 0 0; font-size:13px; color:rgba(255,255,255,0.35); text-align:center;">
          If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
        </p>

      </td>
    </tr>
  </table>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-top:30px;">
    <tr>
      <td style="text-align:center; font-size:12px; color:rgba(255,255,255,0.35);">
        <p style="margin:0;">LokFeel Inc. &bull; noreply@lokfeel.com</p>
      </td>
    </tr>
  </table>

</body>
</html>`;

  return sendEmailWithResend(
    email,
    'Reset your password - LokFeel',
    htmlContent,
    `Reset your LokFeel password by clicking this link: ${resetUrl}. This link expires in 30 minutes. If you didn't request this, ignore this email.`
  );
}

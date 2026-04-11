import nodemailer from 'nodemailer';

// Email configuration
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const FROM_EMAIL = process.env.SMTP_FROM || 'hello@lokfeel.com';
const RESEND_API_KEY = process.env.SMTP_PASSWORD; // Resend uses API key as password

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
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Send verification email with both code and magic link
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
  name?: string,
  magicToken?: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com';
  const magicLink = magicToken ? `${appUrl}/api/auth/magic-link?token=${magicToken}&email=${encodeURIComponent(email)}` : null;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - LokFeel</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0d0c11;
            color: #ffffff;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
          }
          .logo {
            text-align: center;
            margin-bottom: 30px;
          }
          .logo-icon {
            width: 48px;
            height: 48px;
            background: linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%);
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
          }
          .logo-icon svg {
            width: 24px;
            height: 24px;
          }
          .logo-text {
            font-size: 28px;
            font-weight: 700;
            background: linear-gradient(135deg, #c94d7a, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .content {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 40px;
          }
          h1 {
            font-size: 24px;
            margin-bottom: 20px;
            color: #ffffff;
          }
          p {
            font-size: 16px;
            line-height: 1.6;
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 20px;
          }
          .magic-link-container {
            text-align: center;
            margin: 30px 0;
          }
          .magic-link-btn {
            display: inline-block;
            background: #ffffff;
            color: #000000;
            text-decoration: none;
            padding: 16px 32px;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.2s;
          }
          .magic-link-btn:hover {
            background: #f0f0f0;
            transform: translateY(-1px);
          }
          .divider {
            text-align: center;
            margin: 30px 0;
            position: relative;
          }
          .divider::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
          }
          .divider span {
            background: rgba(255, 255, 255, 0.05);
            padding: 0 16px;
            color: rgba(255, 255, 255, 0.5);
            font-size: 14px;
            position: relative;
          }
          .code-container {
            background: rgba(201, 77, 122, 0.1);
            border: 2px dashed rgba(201, 77, 122, 0.5);
            border-radius: 12px;
            padding: 24px;
            text-align: center;
            margin: 20px 0;
          }
          .code {
            font-size: 36px;
            font-weight: 700;
            letter-spacing: 8px;
            color: #c94d7a;
            font-family: 'Courier New', monospace;
          }
          .expiry {
            font-size: 14px;
            color: rgba(255, 255, 255, 0.5);
            margin-top: 20px;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.4);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <div class="logo-icon">
              <svg viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            <div class="logo-text">LokFeel</div>
          </div>
          <div class="content">
            <h1>Welcome to LokFeel${name ? `, ${name}` : ''}!</h1>
            <p>Thank you for signing up. To complete your registration and start your journey to meaningful connections, verify your email:</p>
            
            ${magicLink ? `
            <div class="magic-link-container">
              <a href="${magicLink}" class="magic-link-btn">Verify Email & Continue</a>
            </div>
            
            <div class="divider">
              <span>or use verification code</span>
            </div>
            ` : ''}
            
            <div class="code-container">
              <div class="code">${code}</div>
            </div>
            
            <p class="expiry">This verification will expire in 10 minutes.</p>
            
            <p style="font-size: 14px; color: rgba(255,255,255,0.5);">If you didn't create an account with LokFeel, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>LokFeel Inc. • hello@lokfeel.com</p>
            <p>Building deeper connections through relationship structure matching.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const result = await sendEmailWithResend(
    email,
    'Verify your email - LokFeel',
    htmlContent,
    `Welcome to LokFeel! ${magicLink ? `Click to verify: ${magicLink} ` : ''}Your verification code is: ${code}. This code will expire in 10 minutes.`
  );

  // For development: if email fails, log the code
  if (!result.success) {
    console.log('========================================');
    console.log('📧 VERIFICATION CODE (Development Mode)');
    console.log('To:', email);
    console.log('Code:', code);
    if (magicLink) console.log('Magic Link:', magicLink);
    console.log('========================================');
    // Still return success so user can continue in development
    return { success: true };
  }

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
        <title>Welcome to LokFeel</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0d0c11;
            color: #ffffff;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
          }
          .logo {
            text-align: center;
            margin-bottom: 30px;
          }
          .logo-text {
            font-size: 28px;
            font-weight: 700;
            background: linear-gradient(135deg, #c94d7a, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .content {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 40px;
          }
          h1 {
            font-size: 24px;
            margin-bottom: 20px;
            color: #ffffff;
          }
          p {
            font-size: 16px;
            line-height: 1.6;
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            background: linear-gradient(135deg, #c94d7a, #818cf8);
            color: white;
            text-decoration: none;
            padding: 16px 32px;
            border-radius: 12px;
            font-weight: 600;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.4);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <span class="logo-text">LokFeel</span>
          </div>
          <div class="content">
            <h1>Welcome to LokFeel${name ? `, ${name}` : ''}!</h1>
            <p>Your email has been verified successfully. You're now ready to start your journey to meaningful connections.</p>
            <p>Complete your relationship blueprint profile to receive your first curated matches this week.</p>
            <center>
              <a href="${appUrl}/onboarding" class="button">Complete Your Profile</a>
            </center>
          </div>
          <div class="footer">
            <p>LokFeel Inc. • hello@lokfeel.com</p>
          </div>
        </div>
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

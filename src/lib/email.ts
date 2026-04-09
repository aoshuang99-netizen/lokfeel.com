import nodemailer from 'nodemailer';

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.resend.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'resend',
    pass: process.env.SMTP_PASSWORD,
  },
});

const FROM_EMAIL = process.env.SMTP_FROM || 'hello@lokfeel.com';

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send verification email
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
  name?: string
): Promise<{ success: boolean; error?: string }> {
  try {
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
            .code-container {
              background: rgba(201, 77, 122, 0.1);
              border: 2px dashed rgba(201, 77, 122, 0.5);
              border-radius: 12px;
              padding: 24px;
              text-align: center;
              margin: 30px 0;
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
              <span class="logo-text">LokFeel</span>
            </div>
            <div class="content">
              <h1>Welcome to LokFeel${name ? `, ${name}` : ''}!</h1>
              <p>Thank you for signing up. To complete your registration and start your journey to meaningful connections, please verify your email address using the code below:</p>
              
              <div class="code-container">
                <div class="code">${code}</div>
              </div>
              
              <p class="expiry">This code will expire in 10 minutes.</p>
              
              <p>If you didn't create an account with LokFeel, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p>LokFeel Inc. • hello@lokfeel.com</p>
              <p>Building deeper connections through relationship structure matching.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"LokFeel" <${FROM_EMAIL}>`,
      to: email,
      subject: 'Your Verification Code - LokFeel',
      html: htmlContent,
      text: `Welcome to LokFeel! Your verification code is: ${code}. This code will expire in 10 minutes.`,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(
  email: string,
  name?: string
): Promise<{ success: boolean; error?: string }> {
  try {
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
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/onboarding" class="button">Complete Your Profile</a>
              </center>
            </div>
            <div class="footer">
              <p>LokFeel Inc. • hello@lokfeel.com</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"LokFeel" <${FROM_EMAIL}>`,
      to: email,
      subject: 'Welcome to LokFeel - Start Your Journey',
      html: htmlContent,
      text: `Welcome to LokFeel! Your email has been verified. Complete your profile to start receiving matches.`,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

#!/usr/bin/env node
/**
 * Test email sending with Resend
 * Usage: node scripts/test-email.js <email@example.com>
 */

const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY || process.argv[2];
const TEST_EMAIL = process.argv[3] || process.argv[2];

if (!RESEND_API_KEY || !TEST_EMAIL || !TEST_EMAIL.includes('@')) {
    console.log('❌ Usage: RESEND_API_KEY=re_xxx node scripts/test-email.js your@email.com');
    console.log('   Or: node scripts/test-email.js re_xxx your@email.com');
    process.exit(1);
}

const code = Math.floor(100000 + Math.random() * 900000).toString();

const emailData = {
    from: 'LokFeel <hello@lokfeel.com>',
    to: [TEST_EMAIL],
    subject: 'Your Verification Code - LokFeel',
    html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - LokFeel</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d0c11; color: #ffffff; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .logo { text-align: center; margin-bottom: 30px; }
        .logo-text { font-size: 28px; font-weight: 700; background: linear-gradient(135deg, #c94d7a, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .content { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 40px; }
        h1 { font-size: 24px; margin-bottom: 20px; color: #ffffff; }
        p { font-size: 16px; line-height: 1.6; color: rgba(255, 255, 255, 0.8); margin-bottom: 20px; }
        .code-container { background: rgba(201, 77, 122, 0.1); border: 2px dashed rgba(201, 77, 122, 0.5); border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0; }
        .code { font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #c94d7a; font-family: 'Courier New', monospace; }
        .expiry { font-size: 14px; color: rgba(255, 255, 255, 0.5); margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; font-size: 12px; color: rgba(255, 255, 255, 0.4); }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <span class="logo-text">LokFeel</span>
        </div>
        <div class="content">
            <h1>Welcome to LokFeel!</h1>
            <p>Thank you for signing up. To complete your registration, please verify your email address using the code below:</p>
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
    `,
    text: `Welcome to LokFeel! Your verification code is: ${code}. This code will expire in 10 minutes.`
};

console.log('📧 Testing email sending...');
console.log(`   To: ${TEST_EMAIL}`);
console.log(`   Code: ${code}`);
console.log('');

const options = {
    hostname: 'api.resend.com',
    port: 443,
    path: '/emails',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
    }
};

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        const response = JSON.parse(data);
        
        if (res.statusCode === 200 || res.statusCode === 201) {
            console.log('✅ Email sent successfully!');
            console.log(`   ID: ${response.id}`);
            console.log('');
            console.log('📨 Check your inbox (and spam folder) for the test email.');
        } else {
            console.log('❌ Failed to send email:');
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Error: ${response.message || response.error}`);
        }
    });
});

req.on('error', (error) => {
    console.log('❌ Request failed:', error.message);
});

req.write(JSON.stringify(emailData));
req.end();

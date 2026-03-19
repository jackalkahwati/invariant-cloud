import nodemailer from 'nodemailer';
import { emailConfig } from '../../infrastructure/config.js';

function getTransport() {
  if (!emailConfig.enabled) return null;
  return nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.port === 465,
    auth: { user: emailConfig.user, pass: emailConfig.pass },
  });
}

export async function sendWelcomeEmail(to: string, apiKey: string, workspaceName: string) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[Email disabled] Welcome email would go to ${to}, API key: ${apiKey}`);
    return;
  }
  await transport.sendMail({
    from: emailConfig.from,
    to,
    subject: 'Welcome to Invariant — your API key is inside',
    html: `
      <div style="font-family:Inter,sans-serif;background:#0b1326;color:#dae2fd;padding:40px;max-width:600px;margin:0 auto;border-radius:12px;">
        <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;">Welcome to Invariant.</h1>
        <p style="color:#c2c6d6;margin-bottom:24px;">Your workspace <strong>${workspaceName}</strong> is ready.</p>
        <div style="background:#131b2e;border-radius:8px;padding:16px;margin-bottom:24px;">
          <p style="font-size:11px;font-family:monospace;color:#8c909f;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;">Your API Key</p>
          <code style="font-family:monospace;font-size:14px;color:#adc6ff;word-break:break-all;">${apiKey}</code>
          <p style="font-size:11px;color:#8c909f;margin:8px 0 0;">Save this — it won't be shown again.</p>
        </div>
        <div style="background:#131b2e;border-radius:8px;padding:16px;margin-bottom:24px;">
          <p style="font-size:12px;color:#8c909f;margin:0 0 8px;">Quick start</p>
          <code style="font-family:monospace;font-size:12px;color:#4edea3;display:block;">npm install @invariant/sdk-node</code>
          <code style="font-family:monospace;font-size:12px;color:#dae2fd;display:block;margin-top:8px;">new InvariantClient({ apiKey: '${apiKey}' })</code>
        </div>
        <p style="color:#8c909f;font-size:12px;">Questions? Reply to this email or visit our docs.</p>
      </div>
    `,
  });
}

export async function sendTeamActivationEmail(to: string, workspaceName: string) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[Email disabled] Team activation email would go to ${to}`);
    return;
  }
  await transport.sendMail({
    from: emailConfig.from,
    to,
    subject: 'Invariant Team — your subscription is active',
    html: `
      <div style="font-family:Inter,sans-serif;background:#0b1326;color:#dae2fd;padding:40px;max-width:600px;margin:0 auto;border-radius:12px;">
        <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;">You're on Team.</h1>
        <p style="color:#c2c6d6;margin-bottom:24px;">Workspace <strong>${workspaceName}</strong> has been upgraded. All Team features are now active.</p>
        <ul style="color:#c2c6d6;font-size:14px;line-height:2;">
          <li>Managed cloud hosting</li>
          <li>Audit log exports</li>
          <li>Webhook alerts</li>
          <li>10M claims/month included</li>
        </ul>
        <p style="color:#8c909f;font-size:12px;margin-top:24px;">Questions? Reply to this email.</p>
      </div>
    `,
  });
}

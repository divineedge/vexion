/**
 * Email Provider Abstraction
 * Routes through SMTP, SendGrid, Mailgun, or Resend based on tenant config.
 * When no real provider is configured, logs to console (dev mode).
 */

import { logger } from "./logger";
import nodemailer from "nodemailer";
import { sendViaGmail } from "./gmailProvider";

export interface EmailProviderConfig {
  provider: "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null;
  config: Record<string, string>;
  fromAddress: string | null;
}

export interface SendEmailResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

async function sendViaSendGrid(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  htmlBody?: string,
): Promise<SendEmailResult> {
  try {
    const content: { type: string; value: string }[] = [{ type: "text/plain", value: body }];
    if (htmlBody) content.push({ type: "text/html", value: htmlBody });
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `SendGrid error ${resp.status}: ${err}` };
    }
    const messageId = resp.headers.get("X-Message-Id") ?? undefined;
    return { success: true, externalId: messageId };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  htmlBody?: string,
): Promise<SendEmailResult> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text: body, ...(htmlBody ? { html: htmlBody } : {}) }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Resend error ${resp.status}: ${err}` };
    }
    const data = await resp.json() as { id?: string };
    return { success: true, externalId: data?.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function sendViaMailgun(
  apiKey: string,
  domain: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  htmlBody?: string,
): Promise<SendEmailResult> {
  try {
    const auth = Buffer.from(`api:${apiKey}`).toString("base64");
    const params: Record<string, string> = { from, to, subject, text: body };
    if (htmlBody) params["html"] = htmlBody;
    const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Mailgun error ${resp.status}: ${err}` };
    }
    const data = await resp.json() as { id?: string };
    return { success: true, externalId: data?.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function sendEmail(
  providerConfig: EmailProviderConfig,
  to: string,
  subject: string,
  body: string,
  htmlBody?: string,
): Promise<SendEmailResult> {
  const { provider, config, fromAddress } = providerConfig;
  const from = fromAddress ?? config["fromAddress"] ?? "noreply@example.com";

  if (!provider) {
    logger.info({ to, subject, body }, "[EMAIL DEV] Would send email");
    return { success: true, externalId: `dev-${Date.now()}` };
  }

  if (provider === "sendgrid") {
    const apiKey = config["apiKey"] ?? "";
    if (!apiKey) return { success: false, error: "SendGrid API key not configured" };
    return sendViaSendGrid(apiKey, from, to, subject, body, htmlBody);
  }

  if (provider === "resend") {
    const apiKey = config["apiKey"] ?? "";
    if (!apiKey) return { success: false, error: "Resend API key not configured" };
    return sendViaResend(apiKey, from, to, subject, body, htmlBody);
  }

  if (provider === "mailgun") {
    const apiKey = config["apiKey"] ?? "";
    const domain = config["domain"] ?? "";
    if (!apiKey || !domain) return { success: false, error: "Mailgun API key and domain required" };
    return sendViaMailgun(apiKey, domain, from, to, subject, body, htmlBody);
  }

  if (provider === "gmail") {
    const refreshToken = config["gmailRefreshToken"] ?? "";
    const gmailEmail = config["gmailEmail"] ?? "";
    const gmailSenderName = config["gmailSenderName"] ?? "";
    if (!refreshToken || !gmailEmail) return { success: false, error: "Gmail is not connected — connect a Google account in Settings" };
    return sendViaGmail(refreshToken, gmailEmail, to, subject, body, gmailSenderName || undefined, htmlBody);
  }

  if (provider === "smtp") {
    // Config keys are smtpHost/smtpPort/smtpUser/smtpPass as stored by the settings route.
    // Also accept the unprefixed host/port/user/pass for backwards compatibility.
    const host = config["smtpHost"] ?? config["host"];
    const port = parseInt(config["smtpPort"] ?? config["port"] ?? "587", 10);
    const user = config["smtpUser"] ?? config["user"];
    const pass = config["smtpPass"] ?? config["pass"];

    if (!host) {
      return { success: false, error: "SMTP host not configured — set smtpHost in email provider config" };
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      });

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text: body,
        ...(htmlBody ? { html: htmlBody } : {}),
      });

      return { success: true, externalId: info.messageId };
    } catch (e) {
      return { success: false, error: `SMTP error: ${String(e)}` };
    }
  }

  return { success: false, error: `Unknown email provider: ${provider}` };
}

/**
 * Builds a branded HTML email for portal OTP login.
 * Inline-safe design: no external CSS, no web fonts, no images.
 */
export function buildOtpEmailHtml(params: {
  customerName: string | null;
  otp: string;
  companyName: string;
}): string {
  const { customerName, otp, companyName } = params;
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";

  // Format OTP as groups of 3 digits separated by a non-breaking space for readability
  const formattedOtp = otp.length === 6
    ? `${otp.slice(0, 3)}&thinsp;${otp.slice(3)}`
    : otp;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your login code</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:28px 40px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">${companyName}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 16px;">
              <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${greeting}</p>
              <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.6;">
                Use the code below to sign in to your ${companyName} client portal.
                This code expires in <strong>10 minutes</strong>.
              </p>

              <!-- OTP block -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <div style="display:inline-block;background-color:#f0f4ff;border:2px solid #c7d4f8;border-radius:10px;padding:20px 40px;">
                      <p style="margin:0;font-size:38px;font-weight:700;letter-spacing:8px;color:#1e3a8a;font-family:Courier New,Courier,monospace;">${formattedOtp}</p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6;">
                If you didn't request this code, you can safely ignore this email — your account is not at risk.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${new Date().getFullYear()} ${companyName}. This is an automated message — please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildReminderEmailBody(params: {
  customerName: string;
  jobTitle: string;
  scheduledAt: Date;
  serviceDescription?: string | null;
  propertyAddress?: string | null;
  companyName: string;
}): { subject: string; body: string } {
  const dateStr = params.scheduledAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = params.scheduledAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const subject = `Upcoming Service Reminder — ${params.jobTitle} on ${dateStr}`;
  const body = [
    `Hi ${params.customerName},`,
    "",
    `This is a reminder that ${params.companyName} will be servicing your property on ${dateStr} at ${timeStr}.`,
    "",
    params.serviceDescription ? `Service: ${params.serviceDescription}` : null,
    params.propertyAddress ? `Property: ${params.propertyAddress}` : null,
    "",
    "If you have any questions or need to reschedule, please contact us.",
    "",
    "Reply STOP to opt out of future reminders.",
    "",
    `Thank you,`,
    params.companyName,
  ].filter(l => l !== null).join("\n");

  return { subject, body };
}

export function buildReminderSmsBody(params: {
  customerName: string;
  jobTitle: string;
  scheduledAt: Date;
  propertyAddress?: string | null;
  companyName: string;
}): string {
  const dateStr = params.scheduledAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = params.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const addressPart = params.propertyAddress ? ` at ${params.propertyAddress}` : "";
  return `Hi ${params.customerName}, reminder: ${params.companyName} will be at your property${addressPart} on ${dateStr} at ${timeStr} for "${params.jobTitle}". Reply STOP to opt out.`;
}

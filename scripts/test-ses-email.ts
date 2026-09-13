import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { SesEmailSender } from "../packages/adapters/ses/src/index.js";

function loadEnvFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore error reading .env
  }
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
}

function readKeychainPassword(account: string, service: string): string | null {
  try {
    const output = execSync(
      `security find-generic-password -s ${service} -a ${account} -w`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env"));

  const to = getArg("to") || process.env.TEST_EMAIL_TO;
  if (!to) {
    console.error(
      "Error: Recipient email is required.\nUsage: tsx scripts/test-ses-email.ts --to=your-email@example.com",
    );
    process.exit(1);
  }

  const region =
    process.env.SES_REGION || process.env.AWS_REGION || "eu-west-1";
  const fromEmail =
    getArg("from") ||
    process.env.SES_FROM_EMAIL ||
    "Mizyun <no-reply@mizyun.phiskel.com>";

  let accessKeyId =
    process.env.SES_ACCESS_KEY_ID ||
    process.env.PHISKEL_SES_AWS_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID;
  let secretAccessKey =
    process.env.SES_SECRET_ACCESS_KEY ||
    process.env.PHISKEL_SES_AWS_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.log(
      "AWS credentials not found in env, attempting to read from macOS Keychain...",
    );
    const keyFromKeychain = readKeychainPassword(
      "phiskel-ses-sender",
      "phiskel-ses-aws-access-key-id",
    );
    const secretFromKeychain = readKeychainPassword(
      "phiskel-ses-sender",
      "phiskel-ses-aws-secret-access-key",
    );

    if (keyFromKeychain && secretFromKeychain) {
      console.log("✓ Successfully loaded credentials from macOS Keychain.");
      accessKeyId = keyFromKeychain;
      secretAccessKey = secretFromKeychain;
    }
  }

  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "Error: Could not resolve AWS SES credentials from environment variables or macOS Keychain.",
    );
    console.error(
      "Please set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY or check Keychain entries.",
    );
    process.exit(1);
  }

  console.log(`\n--- AWS SES Email Smoke Test ---`);
  console.log(`Region:     ${region}`);
  console.log(`From:       ${fromEmail}`);
  console.log(`To:         ${to}`);
  console.log(
    `Key ID:     ${accessKeyId.slice(0, 4)}...${accessKeyId.slice(-4)}`,
  );
  console.log(`--------------------------------\n`);

  const sender = new SesEmailSender({
    region,
    defaultFromEmail: fromEmail,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const timestamp = new Date().toISOString();
  const result = await sender.sendEmail({
    to: [to],
    from: fromEmail,
    subject: `Mizyun SES Delivery Verification (${timestamp})`,
    text: `This is a test email sent from Mizyun via Amazon Simple Email Service (SES).\n\nDetails:\n- Region: ${region}\n- Sender: ${fromEmail}\n- Timestamp: ${timestamp}\n\nIf you received this, SES domain authentication, DKIM, and SPF are active.`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Mizyun SES Verification</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b;">
  <div style="background: #0f172a; color: #10b981; padding: 16px 20px; border-radius: 8px; font-weight: 700; font-size: 18px; letter-spacing: 0.05em;">
    MIZYUN · EMAIL VERIFICATION
  </div>
  <div style="padding: 24px 0;">
    <h2 style="margin-top: 0; color: #0f172a;">SES Delivery Test Succeeded</h2>
    <p style="color: #475569; line-height: 1.6;">
      This email confirms that AWS SES domain sending is configured and active for <strong>${fromEmail}</strong>.
    </p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0; font-size: 13px; font-family: monospace;">
      <div><strong>Region:</strong> ${region}</div>
      <div><strong>Sender:</strong> ${fromEmail}</div>
      <div><strong>Recipient:</strong> ${to}</div>
      <div><strong>Timestamp:</strong> ${timestamp}</div>
    </div>
    <p style="color: #64748b; font-size: 13px;">
      Check "Show Original" / "View Source" in your email client to verify that SPF, DKIM, and DMARC have all passed.
    </p>
  </div>
</body>
</html>`,
    replyTo: "support@mizyun.phiskel.com",
  });

  if (!result.ok) {
    console.error(
      `✗ Email sending failed: [${result.error.kind}] ${result.error.message}`,
    );
    if (result.error.cause) {
      console.error("Cause:", result.error.cause);
    }
    process.exit(1);
  }

  console.log(`✓ Email sent successfully!`);
  console.log(`  SES MessageId: ${result.value.messageId}`);
  console.log(`\nNext steps:`);
  console.log(`1. Open the inbox for ${to}`);
  console.log(`2. Verify the email arrives in your inbox (not Spam)`);
  console.log(
    `3. Check "Show Original" to confirm DKIM=PASS, SPF=PASS, DMARC=PASS.`,
  );
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});

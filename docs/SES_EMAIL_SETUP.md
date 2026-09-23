# AWS SES Email Setup & Operations

> Host note (2026-09-22): Hetzner is the active Dev/Production authority. Any Raspberry Pi commands below are historical and must not be used for deployment; translate current operations through [`docs/tutorials/HETZNER_BACKEND_GUIDE.md`](tutorials/HETZNER_BACKEND_GUIDE.md).

This document describes the AWS SES email delivery configuration for Mizyun, covering both:

1. **Application-level transactional email** (via `@mizyun/adapter-ses` and `@mizyun/core`).
2. **Supabase GoTrue Auth emails** (confirmation and recovery emails via SES SMTP, resolving `AUTH-SMTP-001`).

---

## 1. Provisioned AWS Resources

- **AWS Account ID:** `679821015569`
- **Region:** `eu-west-1` (Ireland)
- **SES Verified Identity:** `phiskel.com`
- **IAM User:** `phiskel-ses-sender`
- **IAM Policy:** `SendEmailFromPhiskelDomain`
- **Mizyun Sender Addresses:** `*@mizyun.phiskel.com` (the verified `phiskel.com` domain identity authorizes its subdomains)
- **Default Sender:** `Mizyun <no-reply@mizyun.phiskel.com>`

---

## 2. Environment Variables & Secret Placement

### Development on Mac

Store the keys in your local `.env` (which is gitignored):

```dotenv
SES_REGION=eu-west-1
SES_FROM_EMAIL="Mizyun <no-reply@mizyun.phiskel.com>"
SES_ACCESS_KEY_ID=<your-access-key-id>
SES_SECRET_ACCESS_KEY=<your-secret-access-key>
```

> **Note on Alias Support:** The configuration loader also automatically detects:
>
> - `PHISKEL_SES_AWS_ACCESS_KEY_ID` / `AWS_ACCESS_KEY_ID`
> - `PHISKEL_SES_AWS_SECRET_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY`
> - `AWS_REGION`

### Production on Raspberry Pi 5 (`rpserver`)

For the API server, place the credentials in `/etc/mizyun/production.env`:

```dotenv
SES_REGION=eu-west-1
SES_FROM_EMAIL="Mizyun <no-reply@mizyun.phiskel.com>"
SES_ACCESS_KEY_ID=<from secure credential store>
SES_SECRET_ACCESS_KEY=<from secure credential store>
```

---

## 3. Application-Level Email Delivery

Mizyun exposes a clean provider-neutral `EmailSender` interface in `@mizyun/core`, implemented by `SesEmailSender` in `@mizyun/adapter-ses`.

```typescript
import { SesEmailSender } from "@mizyun/adapter-ses";

const emailSender = new SesEmailSender({
  region: "eu-west-1",
  defaultFromEmail: "Mizyun <no-reply@mizyun.phiskel.com>",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY!,
  },
});

const result = await emailSender.sendEmail({
  to: ["user@example.com"],
  subject: "Your Mizyun Account Export is Ready",
  text: "Your exported fitness and nutrition records are ready for download.",
  html: "<p>Your exported fitness and nutrition records are ready for download.</p>",
  replyTo: "support@mizyun.phiskel.com",
});

if (result.ok) {
  console.log("Email delivered with messageId:", result.value.messageId);
} else {
  console.error("Delivery failed:", result.error.message);
}
```

---

## 4. Supabase GoTrue Auth Email Delivery (`AUTH-SMTP-001`)

To enable real sign-up confirmation and password recovery emails from Supabase GoTrue on the self-hosted production host (Raspberry Pi 5):

### Step A: Generate SES SMTP Credentials

AWS SES IAM access keys differ from SMTP passwords. In the AWS Console:

1. Open **Amazon SES** -> **SMTP Settings** in `eu-west-1`.
2. Click **Create SMTP credentials**.
3. Create credentials for user `phiskel-ses-sender` and copy the **SMTP Username** and **SMTP Password**.

### Step B: Configure `/srv/mizyun/supabase/.env`

On the Raspberry Pi 5 (`rpserver`), update `/srv/mizyun/supabase/.env`:

```dotenv
# Outbound SMTP Configuration
GOTRUE_SMTP_HOST=email-smtp.eu-west-1.amazonaws.com
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=<your-ses-smtp-username>
GOTRUE_SMTP_PASS=<your-ses-smtp-password>
GOTRUE_SMTP_ADMIN_EMAIL=no-reply@mizyun.phiskel.com
GOTRUE_SMTP_SENDER_NAME="Mizyun"

# Enforce email confirmation (restore production security gate)
ENABLE_EMAIL_AUTOCONFIRM=false
```

### Step C: Restart Supabase Service

```bash
sudo systemctl restart mizyun-supabase
```

---

## 5. Verification & Smoke Testing

### Running the Smoke Test from Mac

You can test SES delivery directly from your command line:

```bash
pnpm email:smoke -- --to=your-email@example.com
```

The script will automatically attempt to read credentials from:

1. Process environment (`SES_ACCESS_KEY_ID`, `PHISKEL_SES_AWS_ACCESS_KEY_ID`, etc.)
2. macOS Keychain (`phiskel-ses-sender` / `phiskel-ses-aws-access-key-id`)

### Checking Headers

Once the test email arrives in your inbox:

1. Open **Show original** / **View source** in your email client.
2. Confirm the security status:
   - **SPF:** `PASS` with domain `mail.phiskel.com` (or `phiskel.com`)
   - **DKIM:** `PASS` with domain `phiskel.com`
   - **DMARC:** `PASS`

# phiskel.com SES DNS setup in Cloudflare

## Purpose

AWS SES is configured to send email for `phiskel.com` from AWS account
`679821015569` in `eu-west-1`. Cloudflare is authoritative for the domain, so
the records below must be created in Cloudflare. Do not add them only to the
inactive Route 53 hosted zone; public DNS does not use that zone.

Current SES state: identity, DKIM, and custom MAIL FROM verification are
pending until these DNS records exist.

## Required Cloudflare records

Open Cloudflare, select `phiskel.com`, and go to **DNS > Records**. Add these
five records exactly. Cloudflare may display only the host part in the Name
column after saving; that is expected.

| Type | Name | Target or content | Priority | Proxy | TTL |
|---|---|---|---:|---|---|
| CNAME | `6mc44iv6ptn5lhupnafk6erxcpkhilfu._domainkey` | `6mc44iv6ptn5lhupnafk6erxcpkhilfu.dkim.amazonses.com` | - | DNS only | Auto |
| CNAME | `yuop4a3e3emcyax2otbe5zlevrhjbukx._domainkey` | `yuop4a3e3emcyax2otbe5zlevrhjbukx.dkim.amazonses.com` | - | DNS only | Auto |
| CNAME | `zr7chg2gyrbiputfpjskhdb5sxtb464x._domainkey` | `zr7chg2gyrbiputfpjskhdb5sxtb464x.dkim.amazonses.com` | - | DNS only | Auto |
| MX | `mail` | `feedback-smtp.eu-west-1.amazonses.com` | 10 | N/A | Auto |
| TXT | `mail` | `v=spf1 include:amazonses.com ~all` | - | N/A | Auto |

Important:

- Keep all three DKIM CNAME records **DNS only** (grey cloud). Cloudflare must
  not proxy them.
- The MX and TXT records belong to `mail.phiskel.com`, not the root domain.
- The MAIL FROM subdomain is used for bounces and SPF alignment. It does not
  create a mailbox and does not change normal inbound email delivery.
- Do not add quotation marks around the TXT value in the Cloudflare form.
- Do not create more than one SPF TXT record for `mail.phiskel.com`.

SES is configured with `REJECT_MESSAGE` when the custom MAIL FROM MX record is
invalid. This prevents silent fallback to an Amazon-owned MAIL FROM domain.

## Recommended DMARC record

No DMARC record currently exists. After adding the required records, add this
monitoring policy:

| Type | Name | Content | TTL |
|---|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; pct=100` | Auto |

This begins with monitoring rather than rejecting messages. After legitimate
senders for `phiskel.com` are inventoried and pass SPF or DKIM alignment, the
policy can be tightened to `quarantine` and later `reject`. If a DMARC record
is added by another mail provider before this step, update the existing record
instead of creating a second one.

## Verify after saving

DNS usually propagates within minutes, but SES verification can take longer.
Run:

```bash
dig +short CNAME 6mc44iv6ptn5lhupnafk6erxcpkhilfu._domainkey.phiskel.com
dig +short CNAME yuop4a3e3emcyax2otbe5zlevrhjbukx._domainkey.phiskel.com
dig +short CNAME zr7chg2gyrbiputfpjskhdb5sxtb464x._domainkey.phiskel.com
dig +short MX mail.phiskel.com
dig +short TXT mail.phiskel.com
dig +short TXT _dmarc.phiskel.com
```

## AWS configuration already completed

- SES region: `eu-west-1`
- SES identity: `phiskel.com`
- DKIM: Easy DKIM, RSA 2048, signing enabled
- Custom MAIL FROM domain: `mail.phiskel.com`
- MAIL FROM MX failure behavior: reject the message
- Sending IAM user: `phiskel-ses-sender`

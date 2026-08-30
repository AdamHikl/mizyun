import { describe, expect, it, vi } from "vitest";
import { type SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

import { SesEmailSender } from "./ses-email-sender.js";

describe("SesEmailSender", () => {
  it("formats and sends email successfully with simple text and HTML", async () => {
    let capturedInput: unknown = null;

    const mockClient = {
      send: vi.fn().mockImplementation(async (command: unknown) => {
        if (command instanceof SendEmailCommand) {
          capturedInput = command.input;
          return { MessageId: "ses-test-msg-12345" };
        }
        return {};
      }),
    } as unknown as SESv2Client;

    const sender = new SesEmailSender({
      region: "eu-west-1",
      defaultFromEmail: "no-reply@phiskel.com",
      client: mockClient,
    });

    const result = await sender.sendEmail({
      to: ["user@example.com"],
      subject: "Welcome to Mizyun",
      text: "Plain text welcome message",
      html: "<p>HTML welcome message</p>",
      replyTo: "support@phiskel.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBe("ses-test-msg-12345");
    }

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(capturedInput).toEqual({
      FromEmailAddress: "Mizyun <no-reply@phiskel.com>",
      FromEmailAddressIdentityArn:
        "arn:aws:ses:eu-west-1:679821015569:identity/phiskel.com",
      Destination: {
        ToAddresses: ["user@example.com"],
      },
      ReplyToAddresses: ["support@phiskel.com"],
      Content: {
        Simple: {
          Subject: {
            Data: "Welcome to Mizyun",
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: "Plain text welcome message",
              Charset: "UTF-8",
            },
            Html: {
              Data: "<p>HTML welcome message</p>",
              Charset: "UTF-8",
            },
          },
        },
      },
    });
  });

  it("respects custom From address and already formatted display name", async () => {
    let capturedInput: unknown = null;

    const mockClient = {
      send: vi.fn().mockImplementation(async (command: unknown) => {
        if (command instanceof SendEmailCommand) {
          capturedInput = command.input;
          return { MessageId: "ses-msg-custom-from" };
        }
        return {};
      }),
    } as unknown as SESv2Client;

    const sender = new SesEmailSender({
      region: "eu-west-1",
      defaultFromEmail: "no-reply@phiskel.com",
      client: mockClient,
    });

    const result = await sender.sendEmail({
      to: ["user@example.com"],
      from: "Phiskel Security <security@phiskel.com>",
      subject: "Security Alert",
      text: "Alert content",
    });

    expect(result.ok).toBe(true);
    expect(
      (capturedInput as { FromEmailAddress?: string })?.FromEmailAddress,
    ).toBe("Phiskel Security <security@phiskel.com>");
  });

  it("handles missing MessageId in response as a provider error", async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValue({}),
    } as unknown as SESv2Client;

    const sender = new SesEmailSender({
      region: "eu-west-1",
      defaultFromEmail: "no-reply@phiskel.com",
      client: mockClient,
    });

    const result = await sender.sendEmail({
      to: ["user@example.com"],
      subject: "Subject",
      text: "Text",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider_error");
      expect(result.error.message).toContain("without returning a message ID");
    }
  });

  it("translates throttling errors to rate_limited error kind", async () => {
    const throttlingError = new Error("Rate exceeded");
    throttlingError.name = "TooManyRequestsException";

    const mockClient = {
      send: vi.fn().mockRejectedValue(throttlingError),
    } as unknown as SESv2Client;

    const sender = new SesEmailSender({
      region: "eu-west-1",
      defaultFromEmail: "no-reply@phiskel.com",
      client: mockClient,
    });

    const result = await sender.sendEmail({
      to: ["user@example.com"],
      subject: "Subject",
      text: "Text",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate_limited");
      expect(result.error.message).toContain("rate limit exceeded");
    }
  });

  it("translates generic AWS errors to provider_error", async () => {
    const sesError = new Error("Invalid parameter");
    sesError.name = "BadRequestException";

    const mockClient = {
      send: vi.fn().mockRejectedValue(sesError),
    } as unknown as SESv2Client;

    const sender = new SesEmailSender({
      region: "eu-west-1",
      defaultFromEmail: "no-reply@phiskel.com",
      client: mockClient,
    });

    const result = await sender.sendEmail({
      to: ["user@example.com"],
      subject: "Subject",
      text: "Text",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider_error");
      expect(result.error.message).toContain("Invalid parameter");
    }
  });
});

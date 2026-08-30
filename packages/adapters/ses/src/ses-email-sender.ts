import {
  SendEmailCommand,
  SESv2Client,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import {
  err,
  ok,
  validateSendEmailInput,
  type EmailSendError,
  type EmailSendResult,
  type EmailSender,
  type Result,
  type SendEmailInput,
} from "@mizyun/core";

export interface SesCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface SesEmailSenderOptions {
  readonly region: string;
  readonly defaultFromEmail: string;
  readonly credentials?: SesCredentials | undefined;
  readonly fromEmailAddressIdentityArn?: string | undefined;
  /** Injected SES client, primarily for unit tests and custom lifecycles */
  readonly client?: SESv2Client | undefined;
}

export class SesEmailSender implements EmailSender {
  private readonly client: SESv2Client;
  private readonly defaultFromEmail: string;
  private readonly fromEmailAddressIdentityArn?: string | undefined;

  constructor(options: SesEmailSenderOptions) {
    this.defaultFromEmail = options.defaultFromEmail;
    this.fromEmailAddressIdentityArn =
      options.fromEmailAddressIdentityArn ??
      (options.region === "eu-west-1"
        ? "arn:aws:ses:eu-west-1:679821015569:identity/phiskel.com"
        : undefined);
    if (options.client) {
      this.client = options.client;
    } else {
      this.client = new SESv2Client({
        region: options.region,
        ...(options.credentials
          ? {
              credentials: {
                accessKeyId: options.credentials.accessKeyId,
                secretAccessKey: options.credentials.secretAccessKey,
              },
            }
          : {}),
      });
    }
  }

  async sendEmail(
    input: SendEmailInput,
  ): Promise<Result<EmailSendResult, EmailSendError>> {
    const validated = validateSendEmailInput(input);
    if (!validated.ok) {
      return validated;
    }

    const fromAddress = input.from ?? this.defaultFromEmail;

    const request: SendEmailCommandInput = {
      FromEmailAddress: fromAddress.includes("<")
        ? fromAddress
        : `Mizyun <${fromAddress}>`,
      ...(this.fromEmailAddressIdentityArn
        ? { FromEmailAddressIdentityArn: this.fromEmailAddressIdentityArn }
        : {}),
      Destination: {
        ToAddresses: [...input.to],
      },
      ...(input.replyTo ? { ReplyToAddresses: [input.replyTo] } : {}),
      Content: {
        Simple: {
          Subject: {
            Data: input.subject,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: input.text,
              Charset: "UTF-8",
            },
            ...(input.html
              ? {
                  Html: {
                    Data: input.html,
                    Charset: "UTF-8",
                  },
                }
              : {}),
          },
        },
      },
    };

    try {
      const response = await this.client.send(new SendEmailCommand(request));
      if (!response.MessageId) {
        return err({
          kind: "provider_error",
          message:
            "SES accepted the email request without returning a message ID.",
        });
      }
      return ok({ messageId: response.MessageId });
    } catch (error) {
      const errorName = (error as { name?: string })?.name ?? "";
      const errorMessage =
        (error as Error)?.message ?? "Unknown SES sending error.";

      if (
        errorName === "TooManyRequestsException" ||
        errorName === "LimitExceededException" ||
        errorMessage.includes("rate") ||
        errorMessage.includes("Throttling")
      ) {
        return err({
          kind: "rate_limited",
          message: `SES sending rate limit exceeded: ${errorMessage}`,
          cause: error,
        });
      }

      return err({
        kind: "provider_error",
        message: `Failed to deliver email via AWS SES: ${errorMessage}`,
        cause: error,
      });
    }
  }
}

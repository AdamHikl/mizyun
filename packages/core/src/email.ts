export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface SendEmailInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly from?: string | undefined;
}

export interface EmailSendResult {
  readonly messageId: string;
}

export type EmailSendErrorKind =
  "validation_error" | "disabled" | "rate_limited" | "provider_error";

export interface EmailSendError {
  readonly kind: EmailSendErrorKind;
  readonly message: string;
  readonly cause?: unknown;
}

export interface EmailSender {
  sendEmail(
    input: SendEmailInput,
  ): Promise<Result<EmailSendResult, EmailSendError>>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function validateSendEmailInput(
  input: SendEmailInput,
): Result<SendEmailInput, EmailSendError> {
  if (!input.to || input.to.length === 0) {
    return err({
      kind: "validation_error",
      message: "At least one recipient email address is required.",
    });
  }

  for (const address of input.to) {
    if (!isValidEmailAddress(address)) {
      return err({
        kind: "validation_error",
        message: `Invalid recipient email address: "${address}".`,
      });
    }
  }

  if (!input.subject || input.subject.trim().length === 0) {
    return err({
      kind: "validation_error",
      message: "Email subject must not be empty.",
    });
  }

  if (!input.text || input.text.trim().length === 0) {
    return err({
      kind: "validation_error",
      message: "Email text body must not be empty.",
    });
  }

  if (input.replyTo && !isValidEmailAddress(input.replyTo)) {
    return err({
      kind: "validation_error",
      message: `Invalid replyTo email address: "${input.replyTo}".`,
    });
  }

  return ok(input);
}

export class InMemoryEmailSender implements EmailSender {
  private readonly sent: SendEmailInput[] = [];

  async sendEmail(
    input: SendEmailInput,
  ): Promise<Result<EmailSendResult, EmailSendError>> {
    const validated = validateSendEmailInput(input);
    if (!validated.ok) {
      return validated;
    }
    this.sent.push(input);
    const messageId = `mem-msg-${Date.now()}-${this.sent.length}`;
    return ok({ messageId });
  }

  getSentEmails(): readonly SendEmailInput[] {
    return [...this.sent];
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export class DisabledEmailSender implements EmailSender {
  async sendEmail(
    _input: SendEmailInput,
  ): Promise<Result<EmailSendResult, EmailSendError>> {
    return err({
      kind: "disabled",
      message: "Email sending is disabled.",
    });
  }
}

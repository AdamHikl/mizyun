import { describe, expect, it } from "vitest";

import {
  DisabledEmailSender,
  InMemoryEmailSender,
  isValidEmailAddress,
  validateSendEmailInput,
} from "./email.js";

describe("email domain logic", () => {
  describe("isValidEmailAddress", () => {
    it("accepts valid email addresses", () => {
      expect(isValidEmailAddress("user@example.com")).toBe(true);
      expect(isValidEmailAddress("noreply@mizyun.phiskel.com")).toBe(true);
      expect(isValidEmailAddress("test.user+tag@domain.co.uk")).toBe(true);
    });

    it("rejects invalid email addresses", () => {
      expect(isValidEmailAddress("")).toBe(false);
      expect(isValidEmailAddress("notanemail")).toBe(false);
      expect(isValidEmailAddress("user@")).toBe(false);
      expect(isValidEmailAddress("@domain.com")).toBe(false);
      expect(isValidEmailAddress("user@domain")).toBe(false);
      expect(isValidEmailAddress("user @domain.com")).toBe(false);
    });
  });

  describe("validateSendEmailInput", () => {
    it("validates a well-formed input", () => {
      const result = validateSendEmailInput({
        to: ["user@example.com"],
        subject: "Welcome",
        text: "Hello there",
        html: "<p>Hello there</p>",
        replyTo: "support@mizyun.phiskel.com",
      });
      expect(result.ok).toBe(true);
    });

    it("rejects empty recipient list", () => {
      const result = validateSendEmailInput({
        to: [],
        subject: "Welcome",
        text: "Hello",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
        expect(result.error.message).toContain("recipient");
      }
    });

    it("rejects invalid recipient address", () => {
      const result = validateSendEmailInput({
        to: ["invalid-email"],
        subject: "Welcome",
        text: "Hello",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
        expect(result.error.message).toContain("Invalid recipient");
      }
    });

    it("rejects empty subject", () => {
      const result = validateSendEmailInput({
        to: ["user@example.com"],
        subject: "   ",
        text: "Hello",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
        expect(result.error.message).toContain("subject");
      }
    });

    it("rejects empty body text", () => {
      const result = validateSendEmailInput({
        to: ["user@example.com"],
        subject: "Subject",
        text: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
        expect(result.error.message).toContain("body");
      }
    });

    it("rejects invalid replyTo", () => {
      const result = validateSendEmailInput({
        to: ["user@example.com"],
        subject: "Subject",
        text: "Text",
        replyTo: "invalid-reply",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
        expect(result.error.message).toContain("replyTo");
      }
    });
  });

  describe("InMemoryEmailSender", () => {
    it("records sent emails and returns a messageId", async () => {
      const sender = new InMemoryEmailSender();
      const input = {
        to: ["recipient@example.com"],
        subject: "Test Email",
        text: "This is a test.",
      };

      const result = await sender.sendEmail(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toContain("mem-msg-");
      }

      expect(sender.getSentEmails()).toHaveLength(1);
      expect(sender.getSentEmails()[0]).toEqual(input);

      sender.clear();
      expect(sender.getSentEmails()).toHaveLength(0);
    });

    it("returns validation error if input is invalid", async () => {
      const sender = new InMemoryEmailSender();
      const result = await sender.sendEmail({
        to: [],
        subject: "Test",
        text: "Test",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation_error");
      }
    });
  });

  describe("DisabledEmailSender", () => {
    it("always returns disabled error", async () => {
      const sender = new DisabledEmailSender();
      const result = await sender.sendEmail({
        to: ["user@example.com"],
        subject: "Test",
        text: "Test",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("disabled");
      }
    });
  });
});

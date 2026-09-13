import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { legalRoutes } from "./routes.js";

describe("legalRoutes", () => {
  const createApp = async () => {
    const app = Fastify();
    await app.register(legalRoutes, { prefix: "/legal" });
    return app;
  };

  it("serves the Privacy Policy HTML page", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/legal/privacy",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Privacy Policy");
    expect(response.body).toContain("Privacy-First AI Guarantee");
  });

  it("serves the Terms of Service HTML page", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/legal/terms",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Terms of Service");
    expect(response.body).toContain("Important Health & Medical Disclaimer");
  });

  it("serves the Support HTML page", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/legal/support",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Support & Feedback");
    expect(response.body).toContain("support@mizyun.phiskel.com");
  });
});

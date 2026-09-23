import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { legalRoutes } from "./routes.js";

describe("legalRoutes", () => {
  const createApp = async () => {
    const app = Fastify();
    await app.register(legalRoutes, { prefix: "/legal" });
    return app;
  };

  for (const [path, destination] of [
    ["privacy", "https://www.phiskel.com/mizyun/privacy"],
    ["terms", "https://www.phiskel.com/mizyun/terms"],
    ["support", "https://www.phiskel.com/mizyun/support"],
    ["delete-account", "https://www.phiskel.com/mizyun/delete-account"],
  ]) {
    it(`redirects ${path} to the canonical website`, async () => {
      const app = await createApp();
      const response = await app.inject({
        method: "GET",
        url: `/legal/${path}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(destination);
      await app.close();
    });
  }
});

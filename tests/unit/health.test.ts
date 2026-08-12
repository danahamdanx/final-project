import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/health.service.js", () => ({
  checkHealth: vi.fn().mockResolvedValue({
    status: "ok",
    checks: {
      database: "up",
      migrations: "applied",
    },
  }),
}));

import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns application health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toEqual({
      status: "ok",
      checks: {
        database: "up",
        migrations: "applied",
      },
    });
  });
});
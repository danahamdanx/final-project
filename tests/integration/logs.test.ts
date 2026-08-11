import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
} from "vitest";

import { buildApp } from "../../src/app.js";
import { clearLogs, countLogs } from "../helpers/database.js";
import { flushIngestion } from "../helpers/flush.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await clearLogs();
});

afterAll(async () => {
  await app.close();
});

describe("POST /logs", () => {
  it("stores a valid log", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-08-02T12:00:00Z",
            level: "info",
            service: "payments",
            message: "payment completed",
            attributes: {
              userId: "123",
            },
          },
        ],
      },
    });
    await flushIngestion();

    expect(response.statusCode).toBe(200);
    expect(await countLogs()).toBe(1);

    const body = response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
  });

  it("stores a batch of multiple logs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-08-02T12:00:00Z",
            level: "info",
            service: "payments",
            message: "payment completed",
            attributes: { userId: "123" },
          },
          {
            timestamp: "2026-08-02T12:01:00Z",
            level: "error",
            service: "checkout",
            message: "payment declined",
            attributes: { userId: "456", retries: 3 },
          },
        ],
      },
    });
    await flushIngestion();

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected).toEqual([]);

    expect(await countLogs()).toBe(2);
  });

  it("rejects an entirely invalid batch and stores nothing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-08-02T12:00:00Z",
            level: "critical", // invalid level — not in debug/info/warn/error
            service: "payments",
            message: "payment completed",
          },
        ],
      },
    });
    await flushIngestion();

    expect(response.statusCode).toBe(400);
    expect(await countLogs()).toBe(0);

    const body = response.json();
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(0);
    expect(body.rejected[0].reason).toContain("level");
  });

  it("accepts valid entries and rejects invalid ones within the same batch", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/logs",
    payload: {
      logs: [
        {
          timestamp: "2026-08-02T12:00:00Z",
          level: "info",
          service: "payments",
          message: "payment completed",
        },
        {
          timestamp: "2026-08-02T12:01:00Z",
          level: "critical", // invalid
          service: "payments",
          message: "payment failed",
        },
      ],
    },
  });
  await flushIngestion();

  expect(response.statusCode).toBe(200);

  const body = response.json();
  expect(body.accepted).toBe(1);
  expect(body.rejected).toHaveLength(1);
  expect(body.rejected[0].index).toBe(1); // العنصر التاني بالـ array (index 1)

  expect(await countLogs()).toBe(1);
});
});
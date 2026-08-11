import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
} from "vitest";

import { buildApp } from "../../src/app.js";
import { clearLogs } from "../helpers/database.js";
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

async function seedLogs() {
  await app.inject({
    method: "POST",
    url: "/logs",
    payload: {
      logs: [
        {
          timestamp: "2026-08-02T12:00:00Z",
          level: "info",
          service: "payments",
          message: "payment completed",
          attributes: { user_id: "123", region: "eu-west" },
        },
        {
          timestamp: "2026-08-02T12:05:00Z",
          level: "error",
          service: "payments",
          message: "payment declined",
          attributes: { user_id: "456", retries: 3 },
        },
        {
          timestamp: "2026-08-02T12:10:00Z",
          level: "warn",
          service: "checkout",
          message: "slow response detected",
          attributes: { user_id: "123" },
        },
      ],
    },
  });
  await flushIngestion();

}

describe("GET /logs — filtering", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("returns all logs when no filters are applied", async () => {
    const response = await app.inject({ method: "GET", url: "/logs" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.logs).toHaveLength(3);
    expect(body.next_cursor).toBeNull();
  });

  it("filters by service", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?service=payments" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(2);
    expect(body.logs.every((log: any) => log.service === "payments")).toBe(true);
  });

  it("filters by level", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?level=error" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].level).toBe("error");
  });

  it("filters by attr.<key> as a string comparison", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?attr.user_id=123" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(2);
    expect(body.logs.every((log: any) => log.attributes.user_id === "123")).toBe(true);
  });

  it("filters by a numeric attribute value compared as a string", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?attr.retries=3" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].message).toBe("payment declined");
    expect(body.logs[0].attributes.retries).toBe(3);
  });

  it("filters by a boolean attribute value compared as a string", async () => {
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-08-02T12:15:00Z",
            level: "info",
            service: "cache",
            message: "cache hit",
            attributes: { cached: true },
          },
        ],
      },
    });
    await flushIngestion();

    const response = await app.inject({ method: "GET", url: "/logs?attr.cached=true" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].message).toBe("cache hit");
    expect(body.logs[0].attributes.cached).toBe(true);
  });

  it("filters by q (case-insensitive substring match on message)", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?q=DECLINED" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].message).toBe("payment declined");
  });

  it("returns an empty array when q matches nothing", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?q=randomtext" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.logs).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it("filters by since/until time range", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs?since=2026-08-02T12:03:00Z&until=2026-08-02T12:11:00Z",
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(2);
  });

  it("combines multiple filters together", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs?service=payments&level=error&attr.user_id=456",
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].message).toBe("payment declined");
  });

  it("returns an empty array (not an error) when no logs match", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?service=nonexistent" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.logs).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it("returns an empty array (not 400) when filtering by a non-existent attribute key", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?attr.nonexistent_key=abc" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.logs).toEqual([]);
  });

  it("uses the default limit (100) when limit is omitted", async () => {
    const withoutLimit = await app.inject({ method: "GET", url: "/logs" });
    const withExplicitDefault = await app.inject({ method: "GET", url: "/logs?limit=100" });

    expect(withoutLimit.statusCode).toBe(200);
    expect(withoutLimit.json().logs).toEqual(withExplicitDefault.json().logs);
  });
});

describe("GET /logs — sorting", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("returns logs sorted by timestamp descending", async () => {
    const response = await app.inject({ method: "GET", url: "/logs" });
    const body = response.json();
    const timestamps = body.logs.map((log: any) => log.timestamp);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it("orders deterministically when timestamps are identical (tie-break by id)", async () => {
    await clearLogs();

    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "first" },
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "second" },
        ],
      },
    });
    await flushIngestion();

    const first = await app.inject({ method: "GET", url: "/logs" });
    const second = await app.inject({ method: "GET", url: "/logs" });

    expect(first.json().logs.map((l: any) => l.id)).toEqual(
      second.json().logs.map((l: any) => l.id)
    );
  });
});

describe("GET /logs — cursor pagination", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("paginates across two pages without duplicates or gaps", async () => {
    const page1 = await app.inject({ method: "GET", url: "/logs?limit=2" });
    const body1 = page1.json();

    expect(page1.statusCode).toBe(200);
    expect(body1.logs).toHaveLength(2);
    expect(body1.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/logs?limit=2&cursor=${encodeURIComponent(body1.next_cursor)}`,
    });
    const body2 = page2.json();

    expect(page2.statusCode).toBe(200);
    expect(body2.logs).toHaveLength(1);
    expect(body2.next_cursor).toBeNull();

    const idsPage1 = body1.logs.map((l: any) => l.id);
    const idsPage2 = body2.logs.map((l: any) => l.id);
    const allIds = [...idsPage1, ...idsPage2];

    expect(new Set(allIds).size).toBe(3);

    const numericIds = allIds.map(Number);
    const sortedDescending = [...numericIds].sort((a, b) => b - a);
    expect(numericIds).toEqual(sortedDescending);

    const allMessages = [...body1.logs, ...body2.logs].map((l: any) => l.message);
    expect(allMessages).toContain("payment completed");
    expect(allMessages).toContain("payment declined");
    expect(allMessages).toContain("slow response detected");
  });

  it("returns null next_cursor when limit exceeds available rows", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?limit=100" });
    const body = response.json();
    expect(body.logs).toHaveLength(3);
    expect(body.next_cursor).toBeNull();
  });

  it("paginates correctly when multiple logs share the exact same timestamp", async () => {
    await clearLogs();

    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "first" },
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "second" },
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "third" },
        ],
      },
    });
    await flushIngestion()

    const page1 = await app.inject({ method: "GET", url: "/logs?limit=1" });
    const body1 = page1.json();
    expect(body1.logs).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/logs?limit=1&cursor=${encodeURIComponent(body1.next_cursor)}`,
    });
    const body2 = page2.json();
    expect(body2.logs).toHaveLength(1);
    expect(body2.next_cursor).not.toBeNull();

    const page3 = await app.inject({
      method: "GET",
      url: `/logs?limit=1&cursor=${encodeURIComponent(body2.next_cursor)}`,
    });
    const body3 = page3.json();
    expect(body3.logs).toHaveLength(1);
    expect(body3.next_cursor).toBeNull();

    const allIds = [body1, body2, body3].map((b) => b.logs[0].id);
    const allMessages = [body1, body2, body3].map((b) => b.logs[0].message);

    expect(new Set(allIds).size).toBe(3);
    expect(allMessages.sort()).toEqual(["first", "second", "third"]);
  });

  it("works correctly with limit=1", async () => {
    const page1 = await app.inject({ method: "GET", url: "/logs?limit=1" });
    const body1 = page1.json();

    expect(page1.statusCode).toBe(200);
    expect(body1.logs).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/logs?limit=1&cursor=${encodeURIComponent(body1.next_cursor)}`,
    });
    const body2 = page2.json();

    expect(page2.statusCode).toBe(200);
    expect(body2.logs).toHaveLength(1);
    expect(body2.next_cursor).not.toBeNull();
    expect(body2.logs[0].id).not.toBe(body1.logs[0].id);

    const page3 = await app.inject({
      method: "GET",
      url: `/logs?limit=1&cursor=${encodeURIComponent(body2.next_cursor)}`,
    });
    const body3 = page3.json();

    expect(page3.statusCode).toBe(200);
    expect(body3.logs).toHaveLength(1);
    expect(body3.next_cursor).toBeNull();

    const allIds = [body1, body2, body3].map((b) => b.logs[0].id);
    expect(new Set(allIds).size).toBe(3);
  });

  it("continues pagination correctly while a filter remains applied", async () => {
    const first = await app.inject({ method: "GET", url: "/logs?service=payments&limit=1" });
    const body1 = first.json();

    expect(body1.logs).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();
    expect(body1.logs[0].service).toBe("payments");

    const second = await app.inject({
      method: "GET",
      url: `/logs?service=payments&limit=1&cursor=${encodeURIComponent(body1.next_cursor)}`,
    });
    const body2 = second.json();

    expect(body2.logs).toHaveLength(1);
    expect(body2.logs[0].service).toBe("payments");
    expect(body1.logs[0].id).not.toBe(body2.logs[0].id);
    expect(body2.next_cursor).toBeNull();
  });
});

describe("GET /logs — invalid parameters", () => {
  it("rejects an invalid level", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?level=critical" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
  });

  it("rejects a non-numeric limit", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?limit=abc" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a limit above the maximum (1000)", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?limit=5000" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a limit below the minimum (0 or negative)", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?limit=0" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid timestamp for since", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?since=not-a-date" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects until earlier than since", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs?since=2026-08-02T14:00:00Z&until=2026-08-02T10:00:00Z",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a malformed cursor", async () => {
    const response = await app.inject({ method: "GET", url: "/logs?cursor=not-valid-base64!!!" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("cursor");
  });

  it("rejects a cursor that is valid base64 but missing required fields", async () => {
    const bad = Buffer.from(JSON.stringify({ hello: "world" }), "utf8").toString("base64url");
    const response = await app.inject({ method: "GET", url: `/logs?cursor=${bad}` });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("cursor");
  });
});
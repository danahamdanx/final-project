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
        { timestamp: "2026-08-02T12:02:00Z", level: "info", service: "payments", message: "a", attributes: { region: "eu" } },
        { timestamp: "2026-08-02T12:03:00Z", level: "error", service: "payments", message: "b", attributes: { region: "us" } },
        { timestamp: "2026-08-02T12:07:00Z", level: "info", service: "checkout", message: "c" },
        { timestamp: "2026-08-02T13:15:00Z", level: "warn", service: "checkout", message: "d" },
      ],
    },
  });
}

describe("GET /logs/aggregate — bucket sizes", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("buckets by 5 minutes correctly", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=5m",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual([
      { start: "2026-08-02T12:00:00.000Z", group: null, count: 2 },
      { start: "2026-08-02T12:05:00.000Z", group: null, count: 1 },
    ]);
  });

  it("buckets by 1 minute correctly", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:02:00Z&until=2026-08-02T12:08:00Z&bucket=1m",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual([
      { start: "2026-08-02T12:02:00.000Z", group: null, count: 1 },
      { start: "2026-08-02T12:03:00.000Z", group: null, count: 1 },
      { start: "2026-08-02T12:07:00.000Z", group: null, count: 1 },
    ]);
  });

  it("buckets by 1 hour correctly", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T14:00:00Z&bucket=1h",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual([
      { start: "2026-08-02T12:00:00.000Z", group: null, count: 3 },
      { start: "2026-08-02T13:00:00.000Z", group: null, count: 1 },
    ]);
  });

  it("buckets by 1 day correctly", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T00:00:00Z&until=2026-08-03T00:00:00Z&bucket=1d",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual([
      { start: "2026-08-02T00:00:00.000Z", group: null, count: 4 },
    ]);
  });

  it("orders buckets ascending by start time", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T14:00:00Z&bucket=1h",
    });
    const body = response.json();

    const starts = body.buckets.map((b: any) => b.start);
    const sorted = [...starts].sort();
    expect(starts).toEqual(sorted);
  });
});

describe("GET /logs/aggregate — bucket alignment", () => {
  beforeEach(async () => {
    await clearLogs();
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:04:00Z", level: "info", service: "a", message: "x" },
        ],
      },
    });
  });

  it("aligns 5-minute buckets to clock boundaries, not to since", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:03:00Z&until=2026-08-02T12:08:00Z&bucket=5m",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].start).toBe("2026-08-02T12:00:00.000Z");
  });
});

describe("GET /logs/aggregate — time range boundaries", () => {
  beforeEach(async () => {
    await clearLogs();
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:00:00Z", level: "info", service: "a", message: "at since boundary" },
          { timestamp: "2026-08-02T12:30:00Z", level: "info", service: "a", message: "inside range" },
          { timestamp: "2026-08-02T13:00:00Z", level: "info", service: "a", message: "at until boundary" },
        ],
      },
    });
  });

  it("includes logs exactly at since and excludes logs exactly at until", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=1h",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    const totalCount = body.buckets.reduce((sum: number, b: any) => sum + b.count, 0);
    expect(totalCount).toBe(2);
  });
});

describe("GET /logs/aggregate — multiple groups within the same bucket", () => {
  beforeEach(async () => {
    await clearLogs();
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:01:00Z", level: "info", service: "payments", message: "x" },
          { timestamp: "2026-08-02T12:02:00Z", level: "info", service: "checkout", message: "y" },
          { timestamp: "2026-08-02T12:03:00Z", level: "info", service: "payments", message: "z" },
        ],
      },
    });
  });

  it("splits a single bucket into multiple group rows", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T12:05:00Z&bucket=5m&group_by=service",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual(
      expect.arrayContaining([
        { start: "2026-08-02T12:00:00.000Z", group: "payments", count: 2 },
        { start: "2026-08-02T12:00:00.000Z", group: "checkout", count: 1 },
      ])
    );
    expect(body.buckets).toHaveLength(2);
  });
});

describe("GET /logs/aggregate — group_by", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("groups by service", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=5m&group_by=service",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual(
      expect.arrayContaining([
        { start: "2026-08-02T12:00:00.000Z", group: "payments", count: 2 },
        { start: "2026-08-02T12:05:00.000Z", group: "checkout", count: 1 },
      ])
    );
    expect(body.buckets).toHaveLength(2);
  });

  it("groups by level", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=5m&group_by=level",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual(
      expect.arrayContaining([
        { start: "2026-08-02T12:00:00.000Z", group: "info", count: 1 },
        { start: "2026-08-02T12:00:00.000Z", group: "error", count: 1 },
        { start: "2026-08-02T12:05:00.000Z", group: "info", count: 1 },
      ])
    );
    expect(body.buckets).toHaveLength(3);
  });

  it("returns group: null when group_by is not provided", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=5m",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets.every((b: any) => b.group === null)).toBe(true);
  });
});

describe("GET /logs/aggregate — group_by combined with a filter", () => {
  beforeEach(async () => {
    await clearLogs();
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          { timestamp: "2026-08-02T12:01:00Z", level: "info", service: "payments", message: "x" },
          { timestamp: "2026-08-02T12:02:00Z", level: "error", service: "payments", message: "y" },
          { timestamp: "2026-08-02T12:03:00Z", level: "info", service: "checkout", message: "z" },
        ],
      },
    });
  });

  it("applies the service filter before grouping by level", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T12:05:00Z&bucket=5m&group_by=level&service=payments",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual(
      expect.arrayContaining([
        { start: "2026-08-02T12:00:00.000Z", group: "info", count: 1 },
        { start: "2026-08-02T12:00:00.000Z", group: "error", count: 1 },
      ])
    );
    expect(body.buckets).toHaveLength(2);
  });
});

describe("GET /logs/aggregate — filters", () => {
  beforeEach(async () => {
    await seedLogs();
  });

  it("applies a service filter before aggregating", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T14:00:00Z&bucket=1h&service=checkout",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    const totalCount = body.buckets.reduce((sum: number, b: any) => sum + b.count, 0);
    expect(totalCount).toBe(2);
  });

  it("applies a level filter before aggregating", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T14:00:00Z&bucket=1h&level=error",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    const totalCount = body.buckets.reduce((sum: number, b: any) => sum + b.count, 0);
    expect(totalCount).toBe(1);
  });

  it("applies an attr.<key> filter before aggregating", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T14:00:00Z&bucket=1h&attr.region=eu",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    const totalCount = body.buckets.reduce((sum: number, b: any) => sum + b.count, 0);
    expect(totalCount).toBe(1);
  });

  it("returns an empty buckets array when no data matches the range", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2027-01-01T00:00:00Z&until=2027-01-02T00:00:00Z&bucket=1h",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.buckets).toEqual([]);
  });
});

describe("GET /logs/aggregate — invalid parameters", () => {
  it("rejects a request missing since", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?until=2026-08-02T13:00:00Z&bucket=1h",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
  });

  it("rejects a request missing until", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&bucket=1h",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a request missing bucket", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an unsupported bucket size", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=2m",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects until earlier than since", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T14:00:00Z&until=2026-08-02T10:00:00Z&bucket=1h",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid group_by value", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=1h&group_by=message",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid level filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs/aggregate?since=2026-08-02T12:00:00Z&until=2026-08-02T13:00:00Z&bucket=1h&level=critical",
    });
    expect(response.statusCode).toBe(400);
  });
});
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../src/db/client.js", () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  return {
    readPool: { query: mockQuery },
    writePool: { query: mockQuery },
    default: { query: mockQuery },
  };
});

import { runRetention } from "../../src/services/retention.service.js";

describe("runRetention — retentionDays configuration", () => {
  const originalEnv = process.env.RETENTION_DAYS;

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.RETENTION_DAYS;
    } else {
      process.env.RETENTION_DAYS = originalEnv;
    }
  });

  it("uses the default of 30 when RETENTION_DAYS is not set", async () => {
    delete process.env.RETENTION_DAYS;
    const result = await runRetention();
    expect(result.retentionDays).toBe(30);
  });

  it("uses a custom RETENTION_DAYS value when set", async () => {
    process.env.RETENTION_DAYS = "7";
    const result = await runRetention();
    expect(result.retentionDays).toBe(7);
  });

  it("uses an explicit override over the env var", async () => {
    process.env.RETENTION_DAYS = "7";
    const result = await runRetention(14);
    expect(result.retentionDays).toBe(14);
  });

  it("throws for a non-numeric RETENTION_DAYS", async () => {
    process.env.RETENTION_DAYS = "abc";
    await expect(runRetention()).rejects.toThrow("invalid RETENTION_DAYS");
  });

  it("throws for a zero RETENTION_DAYS", async () => {
    process.env.RETENTION_DAYS = "0";
    await expect(runRetention()).rejects.toThrow("invalid RETENTION_DAYS");
  });

  it("throws for a negative RETENTION_DAYS", async () => {
    process.env.RETENTION_DAYS = "-5";
    await expect(runRetention()).rejects.toThrow("invalid RETENTION_DAYS");
  });

  it("throws for a decimal RETENTION_DAYS", async () => {
    process.env.RETENTION_DAYS = "3.5";
    await expect(runRetention()).rejects.toThrow("invalid RETENTION_DAYS");
  });
});
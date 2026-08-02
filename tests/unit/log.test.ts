// tests/unit/validation.test.ts
import { describe, expect, it } from "vitest";
import {
  validateTopLevel,
  validateBatch,
} from "../../src/utils/validation.js";

describe("validateTopLevel", () => {
  it("accepts a well-formed request with a non-empty logs array", () => {
    const result = validateTopLevel({
      logs: [{ foo: "bar" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body without a 'logs' key", () => {
    const result = validateTopLevel({});
    expect(result.success).toBe(false);
  });

  it("rejects a body where 'logs' is not an array", () => {
    const result = validateTopLevel({ logs: "not-an-array" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty logs array", () => {
    const result = validateTopLevel({ logs: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a body that is not an object at all", () => {
    const result = validateTopLevel([{ foo: "bar" }]);
    expect(result.success).toBe(false);
  });

  it("rejects null", () => {
    const result = validateTopLevel(null);
    expect(result.success).toBe(false);
  });
});

describe("validateBatch — per-entry validation", () => {
  const validEntry = {
    timestamp: "2026-08-02T12:00:00Z",
    level: "info",
    service: "payments",
    message: "payment completed",
  };

  it("accepts a fully valid entry", () => {
    const { accepted, rejected } = validateBatch([validEntry]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("accepts an entry without attributes (defaults to {})", () => {
    const { accepted, rejected } = validateBatch([validEntry]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    const [first] = accepted;
  expect(first?.attributes).toEqual({});
  });

  it("rejects an invalid level", () => {
    const { accepted, rejected } = validateBatch([
      { ...validEntry, level: "critical" },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    const [first] = rejected;
    expect(first?.index).toBe(0);
  });

  it("rejects a missing timestamp", () => {
    const { timestamp, ...withoutTimestamp } = validEntry;
    const { accepted, rejected } = validateBatch([withoutTimestamp]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects a malformed (non-ISO8601) timestamp", () => {
    const { accepted, rejected } = validateBatch([
      { ...validEntry, timestamp: "not-a-date" },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects a timestamp more than 5 minutes in the future", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { accepted, rejected } = validateBatch([
      { ...validEntry, timestamp: future },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("accepts a timestamp within 5 minutes in the future", () => {
    const nearFuture = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const { accepted, rejected } = validateBatch([
      { ...validEntry, timestamp: nearFuture },
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects an empty service string", () => {
    const { accepted, rejected } = validateBatch([
      { ...validEntry, service: "" },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects a whitespace-only service string", () => {
    const { accepted, rejected } = validateBatch([
      { ...validEntry, service: "   " },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects an empty message string", () => {
    const { accepted, rejected } = validateBatch([
      { ...validEntry, message: "" },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("accepts string, number, and boolean attribute values", () => {
    const { accepted, rejected } = validateBatch([
      {
        ...validEntry,
        attributes: {
          user_id: "42",
          retries: 3,
          is_retry: true,
        },
      },
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects a nested object inside attributes", () => {
    const { accepted, rejected } = validateBatch([
      {
        ...validEntry,
        attributes: { nested: { a: 1 } },
      },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects an array inside attributes", () => {
    const { accepted, rejected } = validateBatch([
      {
        ...validEntry,
        attributes: { tags: [1, 2, 3] },
      },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects a null attribute value", () => {
    const { accepted, rejected } = validateBatch([
      {
        ...validEntry,
        attributes: { flag: null },
      },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("processes a batch with mixed valid/invalid entries independently", () => {
    const { accepted, rejected } = validateBatch([
      validEntry,
      { ...validEntry, level: "critical" },
      { ...validEntry, service: "" },
      validEntry,
    ]);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.index)).toEqual([1, 2]);
  });
});

describe("formatReason — message content", () => {
  const validEntry = {
    timestamp: "2026-08-02T12:00:00Z",
    level: "info",
    service: "payments",
    message: "payment completed",
  };

  it("gives a clear reason for an invalid level", () => {
    const { rejected } = validateBatch([{ ...validEntry, level: "critical" }]);
    expect(rejected[0]?.reason).toBe("invalid level: 'critical'");
  });

  it("gives a clear reason for a missing timestamp", () => {
    const { timestamp, ...withoutTimestamp } = validEntry;
    const { rejected } = validateBatch([withoutTimestamp]);
    expect(rejected[0]?.reason).toBe("timestamp is required");
  });

  it("gives a clear reason for an empty service", () => {
    const { rejected } = validateBatch([{ ...validEntry, service: "" }]);
    expect(rejected[0]?.reason).toBe("service must be a non-empty string");
  });

  it("gives a clear reason for nested attributes", () => {
    const { rejected } = validateBatch([
      { ...validEntry, attributes: { nested: { a: 1 } } },
    ]);
    expect(rejected[0]?.reason).toBe(
      "attributes must be a flat object with string, number, or boolean values"
    );
  });
});
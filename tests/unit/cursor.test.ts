// tests/unit/cursor.test.ts
import { describe, expect, it } from "vitest";
import { encodeCursor, decodeCursor } from "../../src/utils/cursor.js";

describe("cursor encode/decode", () => {
  it("round-trips a valid cursor", () => {
    const original = { timestamp: "2026-08-02T12:00:00.000Z", id: "42" };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  it("rejects a cursor that is not valid base64url", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow("invalid cursor");
  });

  it("rejects a cursor whose decoded content is not valid JSON", () => {
    const garbage = Buffer.from("not json", "utf8").toString("base64url");
    expect(() => decodeCursor(garbage)).toThrow("invalid cursor");
  });

  it("rejects a cursor missing the id field", () => {
    const bad = Buffer.from(JSON.stringify({ timestamp: "2026-08-02T12:00:00Z" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("invalid cursor");
  });

  it("rejects a cursor missing the timestamp field", () => {
    const bad = Buffer.from(JSON.stringify({ id: "42" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("invalid cursor");
  });

  it("rejects a cursor with a non-ISO timestamp", () => {
    const bad = Buffer.from(JSON.stringify({ timestamp: "08/02/2026", id: "42" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("invalid cursor");
  });

  it("rejects a cursor with a non-numeric id", () => {
    const bad = Buffer.from(JSON.stringify({ timestamp: "2026-08-02T12:00:00Z", id: "abc" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("invalid cursor");
  });
});
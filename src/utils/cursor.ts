// src/utils/cursor.ts
import { z } from "zod";

export interface Cursor {
  timestamp: string; // ISO 8601 string
  id: string;         // bigint stored as string to avoid precision loss
}

const cursorTimestampSchema = z.iso.datetime();

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;

  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("invalid cursor");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).timestamp !== "string" ||
    typeof (parsed as Record<string, unknown>).id !== "string"
  ) {
    throw new Error("invalid cursor");
  }

  const { timestamp, id } = parsed as { timestamp: string; id: string };

  if (!cursorTimestampSchema.safeParse(timestamp).success) {
    throw new Error("invalid cursor");
  }

  if (!/^\d+$/.test(id)) {
    throw new Error("invalid cursor");
  }

  return { timestamp, id };
}
import { logsQuerySchema, LogsQueryInput } from "../schemas/query.schema.js";
import { decodeCursor, Cursor } from "./cursor.js";

export interface ParsedLogsQuery extends LogsQueryInput {
  attributes: Record<string, string>;
  parsedCursor?: Cursor| undefined;
}

export type QueryValidationResult =
  | { success: true; data: ParsedLogsQuery }
  | { success: false; error: string };

export function parseLogsQuery(raw: Record<string, unknown>): QueryValidationResult {
  // افصل مفاتيح attr.<key> عن الباقي قبل ما نرسل للـ zod schema
  const attributes: Record<string, string> = {};
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("attr.")) {
      const attrKey = key.slice("attr.".length);
      if (attrKey.length === 0) {
        return { success: false, error: "invalid attribute filter key" };
      }
      attributes[attrKey] = String(value);
    } else {
      rest[key] = value;
    }
  }

  const result = logsQuerySchema.safeParse(rest);
  if (!result.success) {
    return { success: false, error: result.error.issues[0]?.message ?? "invalid query parameters" };
  }

  let parsedCursor: Cursor | undefined;
  if (result.data.cursor) {
    try {
      parsedCursor = decodeCursor(result.data.cursor);
    } catch {
      return { success: false, error: "invalid cursor" };
    }
  }

  return {
    success: true,
    data: { ...result.data, attributes, parsedCursor },
  };
}
import { aggregateQuerySchema, AggregateQueryInput } from "../schemas/aggregate.schema.js";

export interface ParsedAggregateQuery extends AggregateQueryInput {
  attributes: Record<string, string>;
}

export type AggregateValidationResult =
  | { success: true; data: ParsedAggregateQuery }
  | { success: false; error: string };

export function parseAggregateQuery(raw: Record<string, unknown>): AggregateValidationResult {
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

  const result = aggregateQuerySchema.safeParse(rest);
  if (!result.success) {
    return { success: false, error: result.error.issues[0]?.message ?? "invalid query parameters" };
  }

  return { success: true, data: { ...result.data, attributes } };
}
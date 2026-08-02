import { ZodType } from "zod";
import { ingestRequestSchema, logSchema } from "../schemas/log.schema.js";
import { LogInput } from "../schemas/log.schema.js";



export interface BatchValidationResult<T> {
  accepted: T[];
  rejected: { index: number; reason: string }[];
}

export function validateTopLevel(value: unknown) {
  return ingestRequestSchema.safeParse(value);
}

export function validateBatch(logs: unknown[]): BatchValidationResult<LogInput> {
  const accepted: LogInput[] = [];
  const rejected: { index: number; reason: string }[] = [];

   logs.forEach((entry, index) => {
    const result = logSchema.safeParse(entry);
    if (result.success) {
      accepted.push(result.data);
    } else {
      const issue = result.error.issues[0];
      rejected.push({
        index,
        reason: issue ? formatReason(entry, issue) : "invalid entry",
      });
    }
  });

  return { accepted, rejected };
}

// src/utils/validation.ts

function formatReason(entry: unknown, issue: { path: PropertyKey[]; message: string }): string {
  const field = String(issue.path[0] ?? "entry");
  const entryObj = entry as Record<string, unknown>;

  switch (field) {
    case "level":
      return `invalid level: '${entryObj?.level}'`;

    case "timestamp": {
      if (entryObj?.timestamp === undefined) return "timestamp is required";
      if (issue.message.includes("future")) {
        return `timestamp is too far in the future: '${entryObj.timestamp}'`;
      }
      return `invalid timestamp: '${entryObj.timestamp}'`;
    }
    case "service":
      return entryObj?.service === undefined
        ? "service is required"
        : "service must be a non-empty string";

    case "message":
      return entryObj?.message === undefined
        ? "message is required"
        : "message must be a non-empty string";

    case "attributes":
      return "attributes must be a flat object with string, number, or boolean values";

    default:
      return issue.message;
  }
}
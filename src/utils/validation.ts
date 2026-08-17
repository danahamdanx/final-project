import { ZodType } from "zod";
import { ingestRequestSchema, logSchema } from "../schemas/log.schema.js";
import { LogInput } from "../schemas/log.schema.js";


const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_FUTURE_MS = 5 * 60 * 1000;

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
  const nowMs = Date.now(); // نحسبها مرة وحدة للدفعة كاملة، مش لكل سجل

  for (let index = 0; index < logs.length; index++) {
    const entry = logs[index];

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      rejected.push({ index, reason: "invalid entry" });
      continue;
    }
    const e = entry as Record<string, unknown>;

    // timestamp
    if (typeof e.timestamp !== "string") {
      rejected.push({ index, reason: "timestamp is required" });
      continue;
    }
    if (!ISO_DATETIME_RE.test(e.timestamp)) {
      rejected.push({ index, reason: `invalid timestamp: '${e.timestamp}'` });
      continue;
    }
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) {
      rejected.push({ index, reason: `invalid timestamp: '${e.timestamp}'` });
      continue;
    }
    if (ts > nowMs + MAX_FUTURE_MS) {
      rejected.push({
        index,
        reason: `timestamp is too far in the future: '${e.timestamp}'`,
      });
      continue;
    }

    // level
    if (typeof e.level !== "string" || !VALID_LEVELS.has(e.level)) {
      rejected.push({ index, reason: `invalid level: '${e.level}'` });
      continue;
    }

    // service
    if (typeof e.service !== "string") {
      rejected.push({ index, reason: "service is required" });
      continue;
    }
    const service = e.service.trim();
    if (service.length < 1 || service.length > 100) {
      rejected.push({ index, reason: "service must be a non-empty string" });
      continue;
    }

    // message
    if (typeof e.message !== "string") {
      rejected.push({ index, reason: "message is required" });
      continue;
    }
    const message = e.message.trim();
    if (message.length < 1 || message.length > 1000) {
      rejected.push({ index, reason: "message must be a non-empty string" });
      continue;
    }

    // attributes
    type AttributeValue = string | number | boolean;
    type LogAttributes = Record<string, AttributeValue>;

    let attributes: LogAttributes = {};
    if (e.attributes !== undefined) {
      if (
        typeof e.attributes !== "object" ||
        e.attributes === null ||
        Array.isArray(e.attributes)
      ) {
        rejected.push({
          index,
          reason: "attributes must be a flat object with string, number, or boolean values",
        });
        continue;
      }
      const rawAttributes = e.attributes as Record<string, unknown>;
      let attrsValid = true;

      for (const key in rawAttributes) {
        const v = rawAttributes[key];
        const t = typeof v;

        if (t !== "string" && t !== "number" && t !== "boolean") {
          attrsValid = false;
          break;
        }
      }

      if (!attrsValid) {
        rejected.push({
          index,
          reason:
            "attributes must be a flat object with string, number, or boolean values",
        });
        continue;
      }

      attributes = rawAttributes as LogAttributes;
    }

    accepted.push({
      timestamp: e.timestamp,
      level: e.level as LogInput["level"],
      service,
      message,
      attributes,
    });
  }

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
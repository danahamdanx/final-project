import { z } from "zod";

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const logSchema = z.object({
timestamp: z
  .iso
  .datetime()
  .refine((value) => {
    const ts = new Date(value).getTime();
    return ts <= Date.now() + 5 * 60 * 1000;
  }, {
    message: "timestamp must not be more than five minutes in the future",
  }),  level: logLevelSchema,
  service: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1000),
  attributes: z.record(z.string(), attributeValueSchema).default({}),
});

// top-level request shape فقط — عناصر الـ array بتتفحص لحالها لاحقًا
export const ingestRequestSchema = z.object({
  logs: z.array(z.unknown()).min(1),
});

export type LogInput = z.infer<typeof logSchema>;
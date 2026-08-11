import { z } from "zod";
import { logLevelSchema } from "./log.schema.js";

export const logsQuerySchema = z
  .object({
    service: z.string().trim().min(1).optional(),
    level: logLevelSchema.optional(),
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
    cursor: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      !data.since || !data.until || new Date(data.until) >= new Date(data.since),
    {message: "until must not be earlier than since"},
  );

export type LogsQueryInput = z.infer<typeof logsQuerySchema>;
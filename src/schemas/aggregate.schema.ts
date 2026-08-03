import { z } from "zod";
import { logLevelSchema } from "./log.schema.js";

export const bucketSchema = z.enum(["1m", "5m", "1h", "1d"]);
export const groupBySchema = z.enum(["service", "level"]);

export const aggregateQuerySchema = z
  .object({
    service: z.string().trim().min(1).optional(),
    level: logLevelSchema.optional(),
    q: z.string().trim().min(1).optional(),
    since: z.iso.datetime(),
    until: z.iso.datetime(),
    bucket: bucketSchema,
    group_by: groupBySchema.optional(),
  })
  .refine((data) => new Date(data.until) > new Date(data.since), {
    message: "until must be later than since",
  });

export type AggregateQueryInput = z.infer<typeof aggregateQuerySchema>;
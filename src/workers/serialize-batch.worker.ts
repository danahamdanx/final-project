// src/workers/serialize-batch.worker.ts
import { parentPort } from "node:worker_threads";
import type { LogInput } from "../schemas/log.schema.js";

parentPort?.on("message", (logs: LogInput[]) => {
  const timestamps: string[] = [];
  const levels: string[] = [];
  const services: string[] = [];
  const messages: string[] = [];
  const attributesArr: string[] = [];

  for (const log of logs) {
    timestamps.push(log.timestamp);
    levels.push(log.level);
    services.push(log.service);
    messages.push(log.message);
    attributesArr.push(JSON.stringify(log.attributes));
  }

  parentPort?.postMessage({ timestamps, levels, services, messages, attributesArr });
});
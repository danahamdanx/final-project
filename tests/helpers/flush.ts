import { ingestionBuffer } from "../../src/services/ingestion-buffer.service.js";

export async function flushIngestion(): Promise<void> {
  await ingestionBuffer.flush();
}
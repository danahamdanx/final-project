import { LogInput } from "../schemas/log.schema.js";
import { logRepository } from "../repositories/log.repository.js";

export class LogService {
  async ingest(logs: LogInput[]): Promise<void> {
    await logRepository.insertMany(logs);
  }
}

export const logService = new LogService();
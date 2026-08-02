import pool from "../db/client.js";
import { LogInput } from "../schemas/log.schema.js";

export class LogRepository {
  async insertMany(logs: LogInput[]): Promise<void> {
    if (logs.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    logs.forEach((log, index) => {
      const offset = index * 5;

      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`
      );

      values.push(
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(log.attributes)
      );
    });

    await pool.query(
      `
      INSERT INTO logs (
        timestamp,
        level,
        service,
        message,
        attributes
      )
      VALUES
      ${placeholders.join(",")}
      `,
      values
    );
  }
}

export const logRepository = new LogRepository();
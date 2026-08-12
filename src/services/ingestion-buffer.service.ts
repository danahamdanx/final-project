import { LogInput } from "../schemas/log.schema.js";
import { logRepository } from "../repositories/log.repository.js";

const FLUSH_INTERVAL_MS = 500;
const MAX_ROWS_PER_INSERT = 500;
const MAX_BUFFER_SIZE = 25000; // هامش أمان واسع بناء على القياس الفعلي (~49MB لـ 15,000 سجل)
class IngestionBuffer {
  private buffer: LogInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  add(logs: LogInput[]): { accepted: boolean } {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      return { accepted: false };
    }
    this.buffer.push(...logs);
    return { accepted: true };
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error("ingestion buffer flush failed", err);
      });
    }, FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;

    this.flushing = true;
    const toWrite = this.buffer;
    this.buffer = [];

    try {
      for (let i = 0; i < toWrite.length; i += MAX_ROWS_PER_INSERT) {
        const chunk = toWrite.slice(i, i + MAX_ROWS_PER_INSERT);
        await logRepository.insertMany(chunk);
      }
    } catch (err) {
      // إعادة آمنة بدون تمرير عدد ضخم من المعاملات دفعة وحدة
      this.buffer = toWrite.concat(this.buffer);
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  size(): number {
    return this.buffer.length;
  }

  
}

export const ingestionBuffer = new IngestionBuffer();
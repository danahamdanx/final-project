import { LogInput } from "../schemas/log.schema.js";
import { logRepository } from "../repositories/log.repository.js";

const FLUSH_INTERVAL_MS = 1000;
const MAX_ROWS_PER_INSERT = 2000;
const SAFE_DRAIN_TIME_MS = 12000; // هامش أمان تحت الـ 20 ثانية المطلوبة
const MAX_BUFFER_SIZE = 80000; // هامش أمان واسع بناء على القياس الفعلي (~49MB لـ 15,000 سجل)
class IngestionBuffer {
  private recentThroughputRowsPerMs = 25; // تقدير أولي محافظ (~25,000 صف/ثانية)، يتحدث ديناميكيًا
  private buffer: LogInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private draining = false; // جديد: يمنع أكتر من drainLoop شغالة بنفس الوقت


  

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
      void this.drainLoop();
    }, FLUSH_INTERVAL_MS);
  }

  private async drainLoop(): Promise<void> {
    if (this.draining) return; // دورة تانية شغالة أصلًا، ما في داعي نبلش وحدة جديدة
    this.draining = true;
    try {
      while (this.buffer.length > 0) {
        await this.flush();
        console.log(`buffer size: ${ingestionBuffer.size()}`);
      }
    } finally {
      this.draining = false;
    }
  }

  isFull(): boolean {
    if (this.buffer.length >= MAX_BUFFER_SIZE) return true;
    const estimatedDrainMs = this.buffer.length / this.recentThroughputRowsPerMs;
    return estimatedDrainMs > SAFE_DRAIN_TIME_MS;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const toWrite = this.buffer;
    this.buffer = [];
    const startedAt = Date.now();

    try {
      for (let i = 0; i < toWrite.length; i += MAX_ROWS_PER_INSERT) {
        const chunk = toWrite.slice(i, i + MAX_ROWS_PER_INSERT);
        await logRepository.insertMany(chunk);
      }
      await logRepository.upsertRollup(toWrite);

      // تحديث تقدير المعدل الفعلي بناء على آخر دورة حقيقية
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 0) {
        this.recentThroughputRowsPerMs = toWrite.length / elapsedMs;
      }
    } catch (err) {
      this.buffer.unshift(...toWrite);
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
    await this.drainLoop();
  }

  size(): number {
    return this.buffer.length;
  } 
}

export const ingestionBuffer = new IngestionBuffer();
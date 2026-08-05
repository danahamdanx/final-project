import { describe, expect, it, beforeEach, afterAll } from "vitest";
import pool from "../../src/db/client.js";
import { runRetention } from "../../src/services/retention.service.js";

async function createTestPartition(dateStr: string) {
  const name = `logs_${dateStr.replace(/-/g, "_")}`;
  const start = dateStr;
  const nextDay = new Date(dateStr);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = nextDay.toISOString().slice(0, 10);

  await pool.query(`DROP TABLE IF EXISTS ${name} CASCADE`);


  await pool.query(`
    CREATE TABLE ${name} PARTITION OF logs
    FOR VALUES FROM ('${start}') TO ('${end}')
  `);

  return name;
}

async function partitionExists(name: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [name]);
  return (result.rowCount ?? 0) > 0;
}

describe("runRetention — integration with real partitions", () => {
  it("drops partitions older than the retention period and keeps recent ones", async () => {
    const oldPartition = await createTestPartition("2020-01-01");
    const recentPartition = await createTestPartition("2026-08-04");

    expect(await partitionExists(oldPartition)).toBe(true);
    expect(await partitionExists(recentPartition)).toBe(true);

    const result = await runRetention(30);

    expect(result.droppedPartitions).toContain(oldPartition);
    expect(result.droppedPartitions).not.toContain(recentPartition);

    expect(await partitionExists(oldPartition)).toBe(false);
    expect(await partitionExists(recentPartition)).toBe(true);
  });

  it("never drops the logs_default partition", async () => {
    const result = await runRetention(0); // أقصى تشدد ممكن، لأي retention period

    expect(result.droppedPartitions).not.toContain("logs_default");
    expect(await partitionExists("logs_default")).toBe(true);
  });
  it("keeps a partition exactly at the retention boundary, drops one just past it", async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const exactlyThirtyDaysAgo = new Date(today);
  exactlyThirtyDaysAgo.setUTCDate(exactlyThirtyDaysAgo.getUTCDate() - 30);

  const thirtyOneDaysAgo = new Date(today);
  thirtyOneDaysAgo.setUTCDate(thirtyOneDaysAgo.getUTCDate() - 31);

  const boundaryDateStr = exactlyThirtyDaysAgo.toISOString().slice(0, 10);
  const pastBoundaryDateStr = thirtyOneDaysAgo.toISOString().slice(0, 10);

  const boundaryPartition = await createTestPartition(boundaryDateStr);
  const pastBoundaryPartition = await createTestPartition(pastBoundaryDateStr);

  const result = await runRetention(30);

  expect(result.droppedPartitions).not.toContain(boundaryPartition);
  expect(result.droppedPartitions).toContain(pastBoundaryPartition);

  expect(await partitionExists(boundaryPartition)).toBe(true);
  expect(await partitionExists(pastBoundaryPartition)).toBe(false);
});

it("drops all partitions older than the retention period, not just the first one found", async () => {
  const veryOld = await createTestPartition("2019-01-01");
  const alsoOld = await createTestPartition("2019-06-01");
  const stillOld = await createTestPartition("2020-01-01");
  const recent = await createTestPartition("2026-08-03");

  const result = await runRetention(30);

  expect(result.droppedPartitions).toEqual(
    expect.arrayContaining([veryOld, alsoOld, stillOld])
  );
  expect(result.droppedPartitions).not.toContain(recent);
  expect(result.droppedPartitions).toHaveLength(3);

  expect(await partitionExists(veryOld)).toBe(false);
  expect(await partitionExists(alsoOld)).toBe(false);
  expect(await partitionExists(stillOld)).toBe(false);
  expect(await partitionExists(recent)).toBe(true); 
});

it("returns an empty droppedPartitions array when nothing is old enough to drop", async () => {
  await createTestPartition("2026-08-05");

  const result = await runRetention(30);

  expect(result.droppedPartitions).toEqual([]);
});
});
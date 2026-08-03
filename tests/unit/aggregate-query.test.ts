import { describe, expect, it } from "vitest";
import { buildAggregateQuery } from "../../src/repositories/log.repository.js";
import { ParsedAggregateQuery } from "../../src/utils/aggregate-params.js";

function baseParams(overrides: Partial<ParsedAggregateQuery> = {}): ParsedAggregateQuery {
  return {
    since: "2026-08-02T12:00:00Z",
    until: "2026-08-02T13:00:00Z",
    bucket: "1h",
    attributes: {},
    ...overrides,
  };
}

describe("buildAggregateQuery — bucket expressions", () => {
  it("uses date_trunc('minute', ...) for 1m", () => {
    const { sql } = buildAggregateQuery(baseParams({ bucket: "1m" }));
    expect(sql).toContain("date_trunc('minute', timestamp)");
  });

  it("uses date_trunc('hour', ...) for 1h", () => {
    const { sql } = buildAggregateQuery(baseParams({ bucket: "1h" }));
    expect(sql).toContain("date_trunc('hour', timestamp)");
  });

  it("uses date_trunc('day', ...) for 1d", () => {
    const { sql } = buildAggregateQuery(baseParams({ bucket: "1d" }));
    expect(sql).toContain("date_trunc('day', timestamp)");
  });

  it("uses epoch-based bucketing for 5m", () => {
    const { sql } = buildAggregateQuery(baseParams({ bucket: "5m" }));
    expect(sql).toContain("floor(extract(epoch from timestamp) / 300) * 300");
  });
});

describe("buildAggregateQuery — required time range", () => {
  it("always includes since and until as parameterized conditions", () => {
    const { sql, values } = buildAggregateQuery(baseParams());

    expect(sql).toMatch(/timestamp >= \$1/);
    expect(sql).toMatch(/timestamp < \$2/);
    expect(values[0]).toBe("2026-08-02T12:00:00Z");
    expect(values[1]).toBe("2026-08-02T13:00:00Z");
  });
});

describe("buildAggregateQuery — optional filters", () => {
  it("omits service/level/q/attr conditions when not provided", () => {
    const { sql, values } = buildAggregateQuery(baseParams());

    expect(sql).not.toContain("service =");
    expect(sql).not.toContain("level =");
    expect(sql).not.toContain("ILIKE");
    expect(sql).not.toContain("->>");
    expect(values).toHaveLength(2); // بس since و until
  });

  it("adds a parameterized service condition when provided", () => {
    const { sql, values } = buildAggregateQuery(baseParams({ service: "payments" }));

    expect(sql).toContain("service = $3");
    expect(values[2]).toBe("payments");
  });

  it("adds a parameterized level condition when provided", () => {
    const { sql, values } = buildAggregateQuery(baseParams({ level: "error" as any }));

    expect(sql).toContain("level = $3");
    expect(values[2]).toBe("error");
  });

  it("adds a parameterized ILIKE condition for q", () => {
    const { sql, values } = buildAggregateQuery(baseParams({ q: "declined" }));

    expect(sql).toContain("message ILIKE $3");
    expect(values[2]).toBe("%declined%");
  });

  it("adds a parameterized ->> condition for each attr.<key>", () => {
    const { sql, values } = buildAggregateQuery(
      baseParams({ attributes: { user_id: "123", region: "eu" } })
    );

    expect(sql).toContain("attributes ->> $3 = $4");
    expect(sql).toContain("attributes ->> $5 = $6");
    expect(values).toEqual([
      "2026-08-02T12:00:00Z",
      "2026-08-02T13:00:00Z",
      "user_id",
      "123",
      "region",
      "eu",
    ]);
  });

  it("combines multiple filters with AND", () => {
    const { sql } = buildAggregateQuery(
      baseParams({ service: "payments", level: "error" as any })
    );

    expect(sql).toMatch(/service = \$3 AND level = \$4/);
  });
});

describe("buildAggregateQuery — group_by", () => {
  it("selects NULL as group_value when group_by is not provided", () => {
    const { sql } = buildAggregateQuery(baseParams());
    expect(sql).toMatch(/NULL AS group_value/);
  });

  it("groups by the bucket alone when group_by is not provided", () => {
    const { sql } = buildAggregateQuery(baseParams());
    // GROUP BY لازم يحتوي بس تعبير الـ bucket، بدون عمود إضافي
    expect(sql).toMatch(/GROUP BY date_trunc\('hour', timestamp\)\s*$/m);
  });

  it("selects the group_by column when provided", () => {
    const { sql } = buildAggregateQuery(baseParams({ group_by: "service" }));
    expect(sql).toContain("service AS group_value");
  });

  it("groups by bucket AND the group_by column when provided", () => {
    const { sql } = buildAggregateQuery(baseParams({ group_by: "level" }));
    expect(sql).toMatch(/GROUP BY date_trunc\('hour', timestamp\), level/);
  });
});

describe("buildAggregateQuery — ordering", () => {
  it("orders results ascending by bucket_start", () => {
    const { sql } = buildAggregateQuery(baseParams());
    expect(sql).toMatch(/ORDER BY bucket_start ASC/);
  });
});
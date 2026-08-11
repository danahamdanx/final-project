// performance/mixed-load.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    ingestion: {
      executor: "constant-vus",
      vus: 75,
      duration: "30s",
      exec: "ingest",
    },
    aggregation: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      exec: "aggregate",
    },
  },
};

function randomLevel() {
  const levels = ["debug", "info", "warn", "error"];
  return levels[Math.floor(Math.random() * levels.length)];
}

function buildBatch(size) {
  const logs = [];
  const now = new Date().toISOString();

  for (let i = 0; i < size; i++) {
    logs.push({
      timestamp: now,
      level: randomLevel(),
      service: "load-test-service",
      message: "synthetic log entry for load testing",
      attributes: {
        request_id: `${__VU}-${__ITER}-${i}`,
        region: "eu-west",
      },
    });
  }

  return { logs };
}

export function ingest() {
  const batchSize = 100;
  const payload = JSON.stringify(buildBatch(batchSize));

  const response = http.post("http://localhost:8080/logs", payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(response, {
    "ingest status is 200": (r) => r.status === 200,
  });
}

export function aggregate() {
  const now = new Date();
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const until = now.toISOString();

  const url = `http://localhost:8080/logs/aggregate?since=${since}&until=${until}&bucket=1m`;
  const response = http.get(url);

  check(response, {
    "aggregate status is 200": (r) => r.status === 200,
    "aggregate under 1s": (r) => r.timings.duration < 1000,
  });
}
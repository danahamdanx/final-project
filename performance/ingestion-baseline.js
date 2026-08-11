import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    ingestion: {
      executor: "constant-vus",
      vus: 75,
      duration: "30s",
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

export default function () {
  const batchSize = 100;
  const payload = JSON.stringify(buildBatch(batchSize));

  const response = http.post("http://localhost:8080/logs", payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(response, {
    "status is 200": (r) => r.status === 200,
  });
}
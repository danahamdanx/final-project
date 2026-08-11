import { Pool } from "pg";

const baseConfig = {
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME ?? "logs",
  user: process.env.DATABASE_USER ?? "postgres",
  password: process.env.DATABASE_PASSWORD ?? "postgres",
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// مجموعة مخصصة للقراءة، الاستعلامات والتجميع، حصة مضمونة لا تتأثر بضغط الكتابة
export const readPool = new Pool({
  ...baseConfig,
  max: 15,
});

// مجموعة مخصصة للكتابة فقط، عملية الإدخال الجماعي الدورية
export const writePool = new Pool({
  ...baseConfig,
  max: 15,
});

writePool.on("connect", (client) => {
  client.query("SET synchronous_commit = OFF");
});

readPool.on("error", (err) => {
  console.error("Unexpected error on idle read pool client", err);
});

writePool.on("error", (err) => {
  console.error("Unexpected error on idle write pool client", err);
});

// نبقي التصدير الافتراضي القديم يشاور على مجموعة القراءة، حفاظًا على توافق أي مكان قديم بالكود لسا يستخدمه مباشرة، متل فحوصات الصحة والترحيلات
export default readPool;
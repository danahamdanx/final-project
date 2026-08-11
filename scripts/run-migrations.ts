// scripts/run-migrations.ts
// سكريبت مستقل لتشغيل الترحيلات فقط، بدون تشغيل السيرفر الكامل.
// يُستخدم بالـ CI وبأي بيئة محتاجة تجهز الجدول قبل تشغيل التستات مباشرة.

import { runMigrations } from "../src/db/migrate.js";

runMigrations()
  .then(() => {
    console.log("Migrations applied successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });

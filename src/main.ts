import { existsSync } from "node:fs";
import { readConfig, startApp } from "./app.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const app = await startApp(readConfig(process.env));
const address = app.server.address();
const port = typeof address === "object" && address ? address.port : "";
console.log(`Бот: ${app.bot.info.name ?? ""} @${app.bot.info.username} (id ${app.bot.info.user_id})`);
console.log(`Мини-приложение и API: http://localhost:${port}`);
console.log(app.adminEnabled ? `Админка: http://localhost:${port}/admin/` : "Админка отключена: задайте ADMIN_PASSWORD");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.stop().then(() => process.exit(0));
  });
}

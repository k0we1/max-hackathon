import { existsSync } from "node:fs";
import { readConfig } from "./app.ts";
import { MaxApi } from "./max.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const config = readConfig(process.env);
const info = await new MaxApi(config.token, config.apiUrl).me();
console.log(`Имя: ${info.name ?? info.first_name ?? ""}`);
console.log(`Username: @${info.username}`);
console.log(`ID: ${info.user_id}`);
console.log(`Ссылка: https://max.ru/${info.username}`);

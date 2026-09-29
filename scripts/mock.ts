import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startApp } from "../src/app.ts";
import { signInitData } from "../src/auth.ts";

const TOKEN = "mock-token";
const APP_PORT = Number(process.env.PORT ?? 3000);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 3001);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "mock";
const CHAT_ID = -100500;

const USERS: Record<string, { id: number; first_name: string; last_name?: string; username?: string }> = {
  alice: { id: 1001, first_name: "Алиса", username: "alice" },
  bob: { id: 1002, first_name: "Борис", last_name: "Петров", username: "boris" },
};

function initData(user: string, startParam: string | null): string {
  const profile = USERS[user] ?? USERS.alice;
  const params: [string, string][] = [
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["query_id", `mock-${user}-${Date.now()}`],
    ["user", JSON.stringify(profile)],
    ["chat", JSON.stringify({ id: CHAT_ID, type: "CHAT" })],
  ];
  if (startParam) params.push(["start_param", startParam]);
  const signed: [string, string][] = [...params, ["hash", signInitData(params, TOKEN)]];
  return signed.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

function openUrl(user: string, startParam: string | null): string {
  const query = new URLSearchParams({ user });
  if (startParam) query.set("start", startParam);
  return `http://localhost:${MOCK_PORT}/open?${query}`;
}

type Button = { type: string; text: string; url?: string; payload?: string };

function describe(query: URLSearchParams, body: { text?: string; attachments?: { payload: { buttons: Button[][] } }[] }): void {
  const target = query.get("chat_id") ? `чат ${query.get("chat_id")}` : `личка ${query.get("user_id")}`;
  console.log(`\n[бот → ${target}] ${body.text ?? ""}`);
  for (const button of body.attachments?.flatMap((attachment) => attachment.payload.buttons.flat()) ?? []) {
    if (button.type === "open_app") {
      console.log(`  [${button.text}] alice: ${openUrl("alice", button.payload ?? null)}`);
      console.log(`  ${" ".repeat(button.text.length + 2)} bob:   ${openUrl("bob", button.payload ?? null)}`);
    } else if (button.type === "link") {
      console.log(`  [${button.text}] ${button.url}`);
    } else {
      console.log(`  [${button.text}] callback ${button.payload}`);
    }
  }
}

const fakeMax = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (url.pathname === "/open") {
      const user = url.searchParams.get("user") ?? "alice";
      const location = `http://localhost:${APP_PORT}/#WebAppData=${encodeURIComponent(initData(user, url.searchParams.get("start")))}`;
      response.writeHead(302, { Location: location }).end();
      return;
    }
    if (url.pathname === "/updates") {
      setTimeout(() => response.end(JSON.stringify({ updates: [], marker: null })), 25000);
      return;
    }
    if (url.pathname === "/me") {
      response.end(JSON.stringify({ user_id: 999, name: "Мок-бот", username: "mock_bot", is_bot: true }));
      return;
    }
    if (url.pathname === "/messages") describe(url.searchParams, body);
    if (url.pathname === "/answers") console.log(`\n[бот ответил на кнопку] ${JSON.stringify(body)}`);
    response.end(JSON.stringify({ success: true }));
  });
});

await new Promise<void>((done) => fakeMax.listen(MOCK_PORT, done));

const app = await startApp({
  token: TOKEN,
  apiUrl: `http://127.0.0.1:${MOCK_PORT}`,
  port: APP_PORT,
  dataFile: process.env.DATA_FILE ?? join(mkdtempSync(join(tmpdir(), "max-mock-")), "db.json"),
  publicDir: resolve(import.meta.dirname, "../public"),
  tickMs: 5000,
  adminPassword: ADMIN_PASSWORD,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});


const cards = app.game.createLaunch("cards", CHAT_ID, USERS.alice?.id ?? 0, Date.now());
const test = app.game.createLaunch("test", CHAT_ID, USERS.alice?.id ?? 0, Date.now());
const port = (app.server.address() as AddressInfo).port;

console.log(`Мок-режим: бэкенд http://localhost:${port}, фейковый MAX http://localhost:${MOCK_PORT}`);
console.log(`Админка: http://localhost:${port}/admin/ (пароль ${ADMIN_PASSWORD})`);
console.log("\nСсылки открывают мини-апп так, будто его запустили из чата MAX:");
console.log(`  главный экран, Алиса:  ${openUrl("alice", null)}`);
console.log(`  карточки, Алиса:       ${openUrl("alice", `c_${cards.token}`)}`);
console.log(`  тесты, Алиса:          ${openUrl("alice", `t_${test.token}`)}`);
console.log(`  главный экран, Борис:  ${openUrl("bob", null)}`);
console.log("\nСообщения бота печатаются ниже, у кнопок мини-аппа есть ссылки для обоих игроков.");

for (const signalName of ["SIGINT", "SIGTERM"] as const) {
  process.once(signalName, () => {
    fakeMax.close();
    void app.stop().then(() => process.exit(0));
  });
}

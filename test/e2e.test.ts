import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startApp } from "../src/app.ts";
import type { App } from "../src/app.ts";
import { signInitData, validateInitData } from "../src/auth.ts";
import { ANSWER_TIMEOUT_MS, CARD_IDLE_MS, JOIN_TIMEOUT_MS, REMINDER_INTERVAL_MS, SOLO_OFFER_MS } from "../src/game.ts";
import type { Update } from "../src/max.ts";

const TOKEN = "test-token";
const ADMIN_PASSWORD = "admin-secret";
const BOT = { user_id: 999, name: "Тестовый бот", username: "test_game_bot", is_bot: true };

type Sent = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> };

const sent: Sent[] = [];
const queue: Update[] = [];

const fakeMax = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      assert.equal(request.headers.authorization, TOKEN);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (url.pathname === "/updates") {
        if (queue.length === 0) await sleep(30);
        const updates = queue.splice(0);
        response.end(JSON.stringify({ updates, marker: 1 }));
        return;
      }
      sent.push({ method: request.method ?? "", path: url.pathname, query: url.searchParams, body });
      if (url.pathname === "/me") response.end(JSON.stringify(BOT));
      else response.end(JSON.stringify({ success: true }));
    })();
  });
});

let app: App;
let base = "";

function initData(userId: number, firstName: string, startParam?: string, chatId?: number): string {
  const params: [string, string][] = [
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["query_id", `q${userId}`],
    ["user", JSON.stringify({ id: userId, first_name: firstName })],
  ];
  if (startParam) params.push(["start_param", startParam]);
  if (chatId !== undefined) params.push(["chat", JSON.stringify({ id: chatId, type: "CHAT" })]);
  const hash = signInitData(params, TOKEN);
  const signed: [string, string][] = [...params, ["hash", hash]];
  return signed.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

async function call<T = Record<string, any>>(auth: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers: { "X-Init-Data": auth } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, data: (await response.json()) as T };
}

async function waitFor(predicate: (item: Sent) => boolean): Promise<Sent> {
  for (let i = 0; i < 100; i++) {
    const found = sent.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error("Сообщение от бота не дождались");
}

function buttons(item: Sent): Record<string, any>[] {
  const attachments = item.body.attachments as { payload: { buttons: Record<string, any>[][] } }[] | undefined;
  return attachments?.flatMap((attachment) => attachment.payload.buttons.flat()) ?? [];
}

function textOf(item: Sent): string {
  return String(item.body.text ?? "");
}

function messageUpdate(text: string, chatId: number, userId: number): Update {
  return {
    update_type: "message_created",
    timestamp: Date.now(),
    message: {
      sender: { user_id: userId, name: "Игрок" },
      recipient: { chat_id: chatId, chat_type: "chat", user_id: null },
      body: { mid: `m${Math.random()}`, text },
    },
  };
}

before(async () => {
  await new Promise<void>((done) => fakeMax.listen(0, done));
  const maxPort = (fakeMax.address() as AddressInfo).port;
  app = await startApp({
    token: TOKEN,
    apiUrl: `http://127.0.0.1:${maxPort}`,
    port: 0,
    dataFile: join(mkdtempSync(join(tmpdir(), "max-game-")), "db.json"),
    publicDir: join(import.meta.dirname, "../public"),
    tickMs: 3600000,
    adminPassword: ADMIN_PASSWORD,
  });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.stop();
  await new Promise<void>((done) => fakeMax.close(() => done()));
});

describe("initData", () => {
  it("принимает корректную подпись и отклоняет подделку", async () => {
    const valid = initData(1, "Аня", "c_abc");
    assert.equal(validateInitData(valid, TOKEN, Date.now())?.user.id, 1);
    assert.equal(validateInitData(valid, "other", Date.now()), null);
    assert.equal(validateInitData(valid.replace("%D0%90", "%D0%91"), TOKEN, Date.now()), null);
    assert.equal((await call("", "/api/me")).status, 401);
    const me = await call(valid, "/api/me");
    assert.equal(me.data.bot, "test_game_bot");
    assert.equal(me.data.startParam, "c_abc");
  });

  it("регистрирует команды и отдаёт мини-приложение", async () => {
    assert.ok(sent.some((item) => item.path === "/me/commands"));
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /max-web-app\.js/);
    assert.equal((await fetch(`${base}/..%2F..%2Fpackage.json`)).status, 404);
  });
});

describe("сценарий карточек", () => {
  const chatId = -100;
  const user = 1;

  it("/start предлагает выбор режима, callback открывает карточки", async () => {
    queue.push(messageUpdate("/start", chatId, user));
    const welcome = await waitFor((item) => item.path === "/messages" && textOf(item).startsWith("Привет"));
    assert.deepEqual(buttons(welcome).map((button) => button.payload), ["mode:cards", "mode:test"]);
    queue.push({
      update_type: "message_callback",
      timestamp: Date.now(),
      callback: { callback_id: "cb1", payload: "mode:cards", user: { user_id: user } },
      message: { recipient: { chat_id: chatId, chat_type: "chat", user_id: null }, body: { mid: "x", text: null } },
    });
    await waitFor((item) => item.path === "/answers" && item.query.get("callback_id") === "cb1");
  });

  it("проходит колоду до итогов, с штрафами, итог и напоминание приходят в чат", async () => {
    sent.length = 0;
    queue.push(messageUpdate("/cards@test_game_bot", chatId, user));
    const offer = await waitFor((item) => item.path === "/messages" && buttons(item)[0]?.type === "open_app");
    assert.equal(offer.query.get("chat_id"), String(chatId));
    const button = buttons(offer)[0] ?? {};
    assert.equal(button.web_app, "test_game_bot");
    assert.equal(button.contact_id, 999);
    const payload = String(button.payload);
    assert.match(payload, /^c_[A-Za-z0-9_-]+$/);
    const auth = initData(user, "Аня", payload);

    const filtered = await call(auth, "/api/decks?theme=couple&mood=deep&lang=ru");
    assert.deepEqual(filtered.data.decks.map((deck: { id: string }) => deck.id), ["couple-deep"]);

    let state = (await call(auth, "/api/cards/sessions", { deckId: "couple-deep", penalty: true, launch: payload.slice(2) })).data;
    assert.equal(state.total, 8);
    assert.equal(state.status, "active");
    for (let i = 0; i < 8; i++) {
      state = (await call(auth, `/api/cards/sessions/${state.id}/discussed`, {})).data;
      assert.ok(state.lastPenalty);
    }
    assert.equal(state.status, "finished");
    assert.equal(state.result.discussed, 8);
    assert.equal(state.result.penalties, 8);

    const summary = await waitFor((item) => textOf(item).startsWith("Итоги встречи"));
    assert.equal(summary.query.get("chat_id"), String(chatId));
    assert.match(String(buttons(summary)[0]?.url), /^https:\/\/max\.ru\/:share\?text=/);
    const ask = await waitFor((item) => textOf(item).startsWith("Напомнить"));
    assert.deepEqual(buttons(ask).map((item) => item.payload), ["remind:yes", "remind:no"]);

    queue.push({
      update_type: "message_callback",
      timestamp: Date.now(),
      callback: { callback_id: "cb2", payload: "remind:yes", user: { user_id: user } },
      message: { recipient: { chat_id: chatId, chat_type: "chat", user_id: null }, body: { mid: "y", text: null } },
    });
    await waitFor((item) => item.path === "/answers" && item.query.get("callback_id") === "cb2");
    const reminder = app.store.data.reminders[`c${chatId}`];
    assert.ok(reminder);
    sent.length = 0;
    app.game.tick(reminder.nextAt + 1);
    const ping = await waitFor((item) => textOf(item).startsWith("Вчера вы играли в карточки"));
    assert.equal(ping.query.get("chat_id"), String(chatId));
    assert.ok(app.store.data.reminders[`c${chatId}`]!.nextAt > Date.now() + REMINDER_INTERVAL_MS);
  });

  it("выход сохраняет прогресс и шлёт глубокую ссылку, неактивность ставит на паузу", async () => {
    sent.length = 0;
    const auth = initData(user, "Аня");
    let state = (await call(auth, "/api/cards/sessions", { deckId: "friends-light", penalty: false })).data;
    state = (await call(auth, `/api/cards/sessions/${state.id}/discussed`, {})).data;
    assert.equal(state.lastPenalty, null);
    state = (await call(auth, `/api/cards/sessions/${state.id}/exit`, {})).data;
    assert.equal(state.status, "paused");
    const link = await waitFor((item) => textOf(item).startsWith("Прогресс сохранён"));
    assert.equal(link.query.get("user_id"), String(user));
    assert.equal(buttons(link)[0]?.payload, `s_${state.id}`);

    const current = (await call(auth, "/api/cards/current")).data;
    assert.equal(current.session.id, state.id);
    state = (await call(auth, `/api/cards/sessions/${state.id}/resume`, {})).data;
    assert.equal(state.status, "active");
    assert.equal(state.discussed, 1);

    app.game.tick(Date.now() + CARD_IDLE_MS + 1000);
    assert.equal((await call(auth, `/api/cards/sessions/${state.id}`)).data.status, "paused");
    assert.equal((await call(initData(2, "Чужой"), `/api/cards/sessions/${state.id}`)).status, 404);
  });
});

describe("сценарий совместного теста", () => {
  const chatId = -200;
  const alice = 10;
  const bob = 20;

  async function launch(): Promise<string> {
    sent.length = 0;
    queue.push(messageUpdate("/test", chatId, alice));
    const offer = await waitFor((item) => item.path === "/messages" && buttons(item)[0]?.type === "open_app");
    return String(buttons(offer)[0]?.payload);
  }

  it("инвайт в чат, параллельные ответы, пауза, общий результат", async () => {
    const payload = await launch();
    assert.match(payload, /^t_/);
    const a = initData(alice, "Алиса", payload);
    const tests = (await call(a, "/api/tests")).data.tests;
    assert.deepEqual(tests.slice(0, 2).map((test: { id: string; joint: boolean }) => [test.id, test.joint]), [["style", true], ["care", false]]);
    assert.equal(tests.length, 6);

    let state = (await call(a, "/api/tests/sessions", { testId: "style", launch: payload.slice(2) })).data;
    assert.equal(state.status, "waiting");
    assert.equal(state.inviteLink, `https://max.ru/test_game_bot?startapp=j_${state.id}`);
    const invite = await waitFor((item) => textOf(item).includes("приглашает"));
    assert.equal(invite.query.get("chat_id"), String(chatId));
    assert.equal(buttons(invite)[0]?.payload, `j_${state.id}`);

    const b = initData(bob, "Боб", `j_${state.id}`);
    const preview = (await call(b, `/api/tests/sessions/${state.id}`)).data;
    assert.equal(preview.isPlayer, false);
    state = (await call(b, `/api/tests/sessions/${state.id}/join`, {})).data;
    assert.equal(state.status, "playing");
    assert.equal((await call(initData(30, "Третий"), `/api/tests/sessions/${state.id}/join`, {})).status, 409);

    state = (await call(a, `/api/tests/sessions/${state.id}/answer`, { option: 0 })).data;
    assert.equal(state.round, 0);
    assert.equal(state.myAnswer, 0);
    assert.equal((await call(a, `/api/tests/sessions/${state.id}/answer`, { option: 1 })).status, 409);

    sent.length = 0;
    await call(b, `/api/tests/sessions/${state.id}/away`, {});
    const away = await waitFor((item) => textOf(item).includes("не в приложении"));
    assert.equal(away.query.get("chat_id"), String(chatId));
    app.game.tick(Date.now() + ANSWER_TIMEOUT_MS + 1000);
    state = (await call(b, `/api/tests/sessions/${state.id}/back`, {})).data;
    assert.equal(state.status, "playing");
    assert.equal(state.paused, false);

    for (let round = 0; round < 6; round++) {
      if (round > 0) await call(a, `/api/tests/sessions/${state.id}/answer`, { option: 0 });
      state = (await call(b, `/api/tests/sessions/${state.id}/answer`, { option: 1 })).data;
    }
    assert.equal(state.status, "finished");
    assert.deepEqual(state.result.players.map((player: { typeId: string }) => player.typeId), ["leader", "diplomat"]);
    assert.match(state.result.compatibility, /никто не остался в обиде/);
    const result = await waitFor((item) => textOf(item).startsWith("Результат теста"));
    assert.equal(result.query.get("chat_id"), String(chatId));
    assert.match(String(buttons(result)[0]?.url), /:share/);
    assert.equal((await call(a, `/api/tests/sessions/${state.id}`)).data.result.compatibility, state.result.compatibility);
  });

  it("выход игрока сохраняет частичный результат, таймаут ответа завершает тест", async () => {
    const a = initData(alice, "Алиса");
    const b = initData(bob, "Боб");
    let state = (await call(a, "/api/tests/sessions", { testId: "style" })).data;
    await call(b, `/api/tests/sessions/${state.id}/join`, {});
    await call(a, `/api/tests/sessions/${state.id}/answer`, { option: 2 });
    await call(b, `/api/tests/sessions/${state.id}/answer`, { option: 2 });
    sent.length = 0;
    state = (await call(b, `/api/tests/sessions/${state.id}/leave`, {})).data;
    assert.equal(state.status, "interrupted");
    assert.equal(state.result.partial, true);
    assert.equal(state.result.answered, 1);
    assert.deepEqual(state.result.players.map((player: { typeId: string }) => player.typeId), ["analyst", "analyst"]);
    await waitFor((item) => textOf(item).includes("прерван"));

    let timed = (await call(a, "/api/tests/sessions", { testId: "style" })).data;
    await call(b, `/api/tests/sessions/${timed.id}/join`, {});
    sent.length = 0;
    app.game.tick(Date.now() + ANSWER_TIMEOUT_MS + 1000);
    timed = (await call(a, `/api/tests/sessions/${timed.id}`)).data;
    assert.equal(timed.status, "timeout");
    await waitFor((item) => textOf(item).includes("не дождались ответа"));
  });

  it("партнёр не пришёл: через 5 минут сессия истекает, через 15 бот предлагает одиночный режим", async () => {
    const payload = await launch();
    const a = initData(alice, "Алиса", payload);
    let state = (await call(a, "/api/tests/sessions", { testId: "style", launch: payload.slice(2) })).data;
    const created = Date.now();
    app.game.tick(created + JOIN_TIMEOUT_MS + 1000);
    state = (await call(a, `/api/tests/sessions/${state.id}`)).data;
    assert.equal(state.status, "expired");
    assert.equal((await call(initData(bob, "Боб"), `/api/tests/sessions/${state.id}/join`, {})).status, 409);
    sent.length = 0;
    app.game.tick(created + SOLO_OFFER_MS + 1000);
    const offer = await waitFor((item) => textOf(item).includes("в одиночку"));
    assert.equal(offer.query.get("chat_id"), String(chatId));
    assert.equal(buttons(offer)[0]?.payload, "o_style");
    app.game.tick(created + SOLO_OFFER_MS + 60000);
    await sleep(50);
    assert.equal(sent.filter((item) => textOf(item).includes("в одиночку")).length, 1);
  });

  it("отменённое приглашение не приводит к предложению одиночного режима", async () => {
    const a = initData(alice, "Алиса");
    const state = (await call(a, "/api/tests/sessions", { testId: "style" })).data;
    assert.equal((await call(a, `/api/tests/sessions/${state.id}/leave`, {})).data.status, "interrupted");
    sent.length = 0;
    app.game.tick(Date.now() + SOLO_OFFER_MS + 60000);
    await sleep(50);
    assert.equal(sent.filter((item) => textOf(item).includes("в одиночку")).length, 0);
  });

  it("одиночный тест проходится без партнёра", async () => {
    const a = initData(alice, "Алиса");
    sent.length = 0;
    let state = (await call(a, "/api/tests/sessions", { testId: "care" })).data;
    assert.equal(state.solo, true);
    assert.equal(state.status, "playing");
    assert.equal(state.inviteLink, null);
    for (let round = 0; round < 4; round++) {
      state = (await call(a, `/api/tests/sessions/${state.id}/answer`, { option: 1 })).data;
    }
    assert.equal(state.status, "finished");
    assert.equal(state.result.players[0].typeId, "time");
    assert.equal(state.result.compatibility, null);
    const result = await waitFor((item) => textOf(item).startsWith("Результат теста «Язык заботы»"));
    assert.equal(result.query.get("user_id"), String(alice));
  });
});

describe("админка", () => {
  async function admin<T = Record<string, any>>(path: string, method = "GET", body?: unknown, password = ADMIN_PASSWORD) {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${base}/admin/api/${path}`, init);
    return { status: response.status, data: (await response.json()) as T };
  }

  it("пускает только с паролем и отдаёт страницу", async () => {
    assert.equal((await admin("check", "GET", undefined, "wrong")).status, 401);
    assert.equal((await admin("check")).status, 200);
    const page = await fetch(`${base}/admin/`);
    assert.match(await page.text(), /id="root"/);
  });

  it("создаёт колоду, правка не ломает начатую игру, архив скрывает из каталога", async () => {
    const draft = { title: "Новая", description: "Тест", theme: "team", mood: "deep", lang: "ru", cards: ["Первый?", " ", "Второй?"], penalties: [] };
    assert.equal((await admin("decks", "POST", { ...draft, cards: [] })).status, 400);
    assert.equal((await admin("decks", "POST", { ...draft, theme: "space" })).status, 400);
    const deck = (await admin("decks", "POST", draft)).data;
    assert.deepEqual(deck.cards, ["Первый?", "Второй?"]);

    const auth = initData(77, "Коля");
    const catalog = (await call(auth, "/api/decks?theme=team&mood=deep")).data;
    assert.deepEqual(catalog.decks.map((item: { id: string }) => item.id), [deck.id]);
    let state = (await call(auth, "/api/cards/sessions", { deckId: deck.id, penalty: true })).data;
    assert.equal(state.total, 2);

    assert.equal((await admin(`decks/${deck.id}`, "PUT", { ...draft, cards: ["Только один"], archived: true })).status, 200);
    assert.deepEqual((await call(auth, "/api/decks?theme=team&mood=deep")).data.decks, []);
    assert.equal((await call(auth, "/api/cards/sessions", { deckId: deck.id })).status, 400);

    state = (await call(auth, `/api/cards/sessions/${state.id}/discussed`, {})).data;
    assert.equal(state.lastPenalty, null);
    assert.match(state.current.text, /^(Первый|Второй)\?$/);
    state = (await call(auth, `/api/cards/sessions/${state.id}/discussed`, {})).data;
    assert.equal(state.status, "finished");
    assert.equal(state.result.deckTitle, "Новая");
    assert.equal((await admin("decks/unknown", "PUT", draft)).status, 404);
  });

  it("видит пользователей, их игры, сводку и управляет напоминаниями", async () => {
    const users = (await admin("users")).data.users as { id: number; name: string; dialog: boolean }[];
    assert.equal(users.find((user) => user.id === 77)?.name, "Коля");
    assert.equal(users.find((user) => user.id === 1)?.dialog, false);
    const detail = (await admin("users/77")).data;
    assert.equal(detail.cards[0].deckTitle, "Новая");
    assert.equal((await admin("users/123456")).status, 404);

    const stats = (await admin("stats")).data;
    assert.ok(stats.users.total >= 4);
    assert.ok(stats.cards.finished >= 2);
    assert.ok(stats.tests.finished >= 2);
    const sessions = (await admin("sessions?limit=2")).data;
    assert.equal(sessions.cards.length, 2);
    assert.equal((await admin("tests")).data.tests.length, 6);

    const reminders = (await admin("reminders")).data.reminders as { key: string }[];
    assert.equal(reminders.length, 1);
    assert.equal((await admin(`reminders/${reminders[0]!.key}`, "DELETE")).status, 200);
    assert.equal((await admin("reminders")).data.reminders.length, 0);
  });

  it("рассылает сообщение тем, кто писал боту в личку", async () => {
    queue.push({
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: 5000,
      user: { user_id: 500, name: "Личка" },
    });
    await waitFor((item) => item.query.get("chat_id") === "5000");
    queue.push({
      update_type: "message_created",
      timestamp: Date.now(),
      message: {
        sender: { user_id: 501, name: "Тоже личка" },
        recipient: { chat_id: 5001, chat_type: "dialog", user_id: null },
        body: { mid: "d1", text: "/cards" },
      },
    });
    await waitFor((item) => item.query.get("chat_id") === "5001");
    assert.equal(app.store.data.users[501]?.dialog, true);
    assert.equal((await admin("broadcast", "POST", { text: "" })).status, 400);
    sent.length = 0;
    const result = (await admin("broadcast", "POST", { text: "Новые колоды!" })).data;
    assert.deepEqual(result, { sent: 2, failed: 0 });
    const recipients = sent.filter((item) => textOf(item) === "Новые колоды!").map((item) => item.query.get("user_id"));
    assert.deepEqual(recipients.sort(), ["500", "501"]);
  });
});

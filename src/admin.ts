import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { findTest, LANGS, MOODS, TESTS, THEMES } from "./content.ts";
import type { Deck, Lang, Mood, Theme } from "./content.ts";
import { GameError } from "./game.ts";
import { readBody, send } from "./http.ts";
import type { Body } from "./http.ts";
import { newId } from "./store.ts";
import type { CardSession, QuizSession, Store } from "./store.ts";

export type AdminHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<void>;

export type AdminOptions = {
  store: Store;
  password: string;
  broadcast: (text: string) => Promise<{ sent: number; failed: number }>;
};

type AdminContext = { body: Body; query: URLSearchParams; params: string[]; now: number };

type AdminRoute = {
  method: string;
  pattern: RegExp;
  handler: (context: AdminContext) => unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function textField(body: Body, key: string, max: number, required: boolean): string {
  const value = body[key];
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new GameError(400, `Поле «${key}» обязательно`);
  if (result.length > max) throw new GameError(400, `Поле «${key}» длиннее ${max} символов`);
  return result;
}

function listField(body: Body, key: string, maxItems: number, maxLength: number): string[] {
  const value = body[key];
  if (!Array.isArray(value)) throw new GameError(400, `Поле «${key}» должно быть списком`);
  const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (items.length > maxItems) throw new GameError(400, `В поле «${key}» больше ${maxItems} элементов`);
  if (items.some((item) => item.length > maxLength)) throw new GameError(400, `Элемент «${key}» длиннее ${maxLength} символов`);
  return items;
}

function enumField<T extends string>(body: Body, key: string, allowed: Record<T, string>): T {
  const value = body[key];
  if (typeof value !== "string" || !(value in allowed)) throw new GameError(400, `Некорректное поле «${key}»`);
  return value as T;
}

function parseDeck(id: string, body: Body): Deck {
  const cards = listField(body, "cards", 300, 500);
  if (cards.length === 0) throw new GameError(400, "В колоде должна быть хотя бы одна карточка");
  return {
    id,
    title: textField(body, "title", 100, true),
    description: textField(body, "description", 300, false),
    theme: enumField<Theme>(body, "theme", THEMES),
    mood: enumField<Mood>(body, "mood", MOODS),
    lang: enumField<Lang>(body, "lang", LANGS),
    cards,
    penalties: listField(body, "penalties", 100, 300),
    archived: body.archived === true,
  };
}

export function createAdminHandler(options: AdminOptions): AdminHandler {
  const { store } = options;
  const data = store.data;
  const expected = digest(options.password);

  const userName = (id: number): string => data.users[id]?.name ?? `id${id}`;

  const cardSummary = (session: CardSession) => ({
    id: session.id,
    userId: session.userId,
    userName: userName(session.userId),
    chatId: session.chatId,
    deckId: session.deckId,
    deckTitle: session.deckTitle,
    penalty: session.penalty,
    status: session.status,
    discussed: session.discussed.length,
    total: session.order.length,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
    result: session.result,
  });

  const quizSummary = (session: QuizSession) => ({
    id: session.id,
    testId: session.testId,
    testTitle: findTest(session.testId)?.title ?? session.testId,
    solo: session.solo,
    chatId: session.chatId,
    status: session.status,
    round: session.round,
    players: session.players.map((player) => ({
      userId: player.userId,
      name: player.name,
      state: player.state,
      answered: player.answers.filter((answer) => answer !== null).length,
    })),
    createdAt: session.createdAt,
    result: session.result,
  });

  const newest = <T>(items: T[], time: (item: T) => number): T[] => [...items].sort((a, b) => time(b) - time(a));

  const routes: AdminRoute[] = [
    { method: "GET", pattern: /^\/admin\/api\/check$/, handler: () => ({ ok: true }) },
    {
      method: "GET",
      pattern: /^\/admin\/api\/stats$/,
      handler: ({ now }) => {
        const users = Object.values(data.users);
        const cards = Object.values(data.cards);
        const quizzes = Object.values(data.quizzes);
        const decks = Object.values(data.decks).map((deck) => ({
          id: deck.id,
          title: deck.title,
          sessions: cards.filter((session) => session.deckId === deck.id).length,
          finished: cards.filter((session) => session.deckId === deck.id && session.status === "finished").length,
        }));
        const tests = TESTS.map((test) => ({
          id: test.id,
          title: test.title,
          sessions: quizzes.filter((session) => session.testId === test.id).length,
          finished: quizzes.filter((session) => session.testId === test.id && session.status === "finished").length,
        }));
        return {
          users: {
            total: users.length,
            dialog: users.filter((user) => user.dialog).length,
            active24h: users.filter((user) => now - user.lastSeen < DAY_MS).length,
            active7d: users.filter((user) => now - user.lastSeen < 7 * DAY_MS).length,
          },
          cards: {
            total: cards.length,
            finished: cards.filter((session) => session.status === "finished").length,
            active: cards.filter((session) => session.status === "active").length,
            discussed: cards.reduce((sum, session) => sum + session.discussed.length, 0),
          },
          tests: {
            total: quizzes.length,
            finished: quizzes.filter((session) => session.status === "finished").length,
            joint: quizzes.filter((session) => !session.solo).length,
            interrupted: quizzes.filter((session) => ["interrupted", "timeout", "expired"].includes(session.status)).length,
          },
          reminders: Object.keys(data.reminders).length,
          decks: decks.sort((a, b) => b.sessions - a.sessions),
          testsTop: tests.sort((a, b) => b.sessions - a.sessions),
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/admin\/api\/users$/,
      handler: () => ({
        users: newest(Object.values(data.users), (user) => user.lastSeen).map((user) => ({
          ...user,
          cards: Object.values(data.cards).filter((session) => session.userId === user.id).length,
          tests: Object.values(data.quizzes).filter((session) => session.players.some((player) => player.userId === user.id)).length,
          reminder: Object.values(data.reminders).some((reminder) => reminder.userId === user.id),
        })),
      }),
    },
    {
      method: "GET",
      pattern: /^\/admin\/api\/users\/(\d+)$/,
      handler: ({ params }) => {
        const id = Number(params[0]);
        const user = data.users[id];
        if (!user) throw new GameError(404, "Пользователь не найден");
        return {
          user,
          cards: newest(Object.values(data.cards).filter((session) => session.userId === id), (session) => session.startedAt).map(cardSummary),
          tests: newest(
            Object.values(data.quizzes).filter((session) => session.players.some((player) => player.userId === id)),
            (session) => session.createdAt,
          ).map(quizSummary),
          reminders: Object.values(data.reminders).filter((reminder) => reminder.userId === id),
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/admin\/api\/decks$/,
      handler: () => ({
        filters: { themes: THEMES, moods: MOODS, langs: LANGS },
        decks: Object.values(data.decks),
      }),
    },
    {
      method: "POST",
      pattern: /^\/admin\/api\/decks$/,
      handler: ({ body }) => {
        const deck = parseDeck(newId(), body);
        data.decks[deck.id] = deck;
        store.save();
        return deck;
      },
    },
    {
      method: "PUT",
      pattern: /^\/admin\/api\/decks\/([\w-]+)$/,
      handler: ({ params, body }) => {
        const id = params[0] ?? "";
        if (!data.decks[id]) throw new GameError(404, "Колода не найдена");
        const deck = parseDeck(id, body);
        data.decks[id] = deck;
        store.save();
        return deck;
      },
    },
    {
      method: "GET",
      pattern: /^\/admin\/api\/sessions$/,
      handler: ({ query }) => {
        const limit = Math.min(500, Math.max(1, Number(query.get("limit") ?? 100) || 100));
        return {
          cards: newest(Object.values(data.cards), (session) => session.startedAt).slice(0, limit).map(cardSummary),
          tests: newest(Object.values(data.quizzes), (session) => session.createdAt).slice(0, limit).map(quizSummary),
        };
      },
    },
    { method: "GET", pattern: /^\/admin\/api\/tests$/, handler: () => ({ tests: TESTS }) },
    {
      method: "GET",
      pattern: /^\/admin\/api\/reminders$/,
      handler: () => ({
        reminders: Object.values(data.reminders).map((reminder) => ({ ...reminder, userName: userName(reminder.userId) })),
      }),
    },
    {
      method: "DELETE",
      pattern: /^\/admin\/api\/reminders\/([\w-]+)$/,
      handler: ({ params }) => {
        const key = params[0] ?? "";
        if (!data.reminders[key]) throw new GameError(404, "Напоминание не найдено");
        delete data.reminders[key];
        store.save();
        return { ok: true };
      },
    },
  ];

  return async (request, response, url) => {
    try {
      const header = String(request.headers.authorization ?? "");
      const provided = digest(header.startsWith("Bearer ") ? header.slice(7) : "");
      if (!timingSafeEqual(provided, expected)) throw new GameError(401, "Неверный пароль");
      if (request.method === "POST" && url.pathname === "/admin/api/broadcast") {
        const body = await readBody(request);
        const text = textField(body, "text", 4000, true);
        send(response, 200, await options.broadcast(text));
        return;
      }
      const route = routes.find((item) => item.method === request.method && item.pattern.test(url.pathname));
      if (!route) throw new GameError(404, "Не найдено");
      const match = route.pattern.exec(url.pathname);
      const body = request.method === "POST" || request.method === "PUT" ? await readBody(request) : {};
      send(response, 200, route.handler({ body, query: url.searchParams, params: match ? match.slice(1) : [], now: Date.now() }));
    } catch (error) {
      if (error instanceof GameError) {
        send(response, error.status, { error: error.message });
        return;
      }
      console.error("Ошибка админки:", error);
      send(response, 500, { error: "Внутренняя ошибка" });
    }
  };
}

import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { AdminHandler } from "./admin.ts";
import { validateInitData } from "./auth.ts";
import { readBody, send, text } from "./http.ts";
import type { Body } from "./http.ts";
import { GameError } from "./game.ts";
import type { Game, Viewer } from "./game.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

type Context = {
  viewer: Viewer;
  startParam: string | null;
  body: Body;
  query: URLSearchParams;
  params: string[];
  now: number;
};

type Route = {
  method: string;
  pattern: RegExp;
  handler: (context: Context) => unknown;
};

export type ServerOptions = {
  game: Game;
  token: string;
  publicDir: string;
  botUsername: () => string;
  admin: AdminHandler | null;
};

function launchToken(body: Body): string | null {
  const value = text(body, "launch");
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function routes(game: Game, botUsername: () => string): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/me$/,
      handler: ({ viewer, startParam }) => ({ user: { id: viewer.id, name: viewer.name }, startParam, bot: botUsername() }),
    },
    {
      method: "GET",
      pattern: /^\/api\/decks$/,
      handler: ({ query }) =>
        game.catalog({
          theme: query.get("theme") ?? undefined,
          mood: query.get("mood") ?? undefined,
          lang: query.get("lang") ?? undefined,
        }),
    },
    {
      method: "GET",
      pattern: /^\/api\/cards\/current$/,
      handler: ({ viewer }) => {
        const session = game.currentCards(viewer);
        return { session: session ? game.cardState(session) : null };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/sessions$/,
      handler: ({ viewer, body, now }) =>
        game.cardState(game.startCards(viewer, text(body, "deckId") ?? "", body.penalty === true, launchToken(body), now)),
    },
    {
      method: "GET",
      pattern: /^\/api\/cards\/sessions\/([\w-]+)$/,
      handler: ({ viewer, params }) => game.cardState(game.getCards(params[0] ?? "", viewer)),
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/sessions\/([\w-]+)\/resume$/,
      handler: ({ viewer, params, now }) => game.cardState(game.resumeCards(params[0] ?? "", viewer, now)),
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/sessions\/([\w-]+)\/discussed$/,
      handler: ({ viewer, params, now }) => game.cardState(game.markDiscussed(params[0] ?? "", viewer, now)),
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/sessions\/([\w-]+)\/exit$/,
      handler: ({ viewer, params }) => game.cardState(game.exitCards(params[0] ?? "", viewer)),
    },
    {
      method: "GET",
      pattern: /^\/api\/tests$/,
      handler: () => ({ tests: game.tests() }),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions$/,
      handler: ({ viewer, body, now }) =>
        game.quizState(game.startQuiz(viewer, text(body, "testId") ?? "", body.solo === true, launchToken(body), now), viewer),
    },
    {
      method: "GET",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)$/,
      handler: ({ viewer, params }) => game.quizState(game.getQuiz(params[0] ?? "", viewer), viewer),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)\/join$/,
      handler: ({ viewer, params, now }) => game.quizState(game.joinQuiz(params[0] ?? "", viewer, now), viewer),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)\/answer$/,
      handler: ({ viewer, params, body, now }) =>
        game.quizState(game.answer(params[0] ?? "", viewer, typeof body.option === "number" ? body.option : -1, now), viewer),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)\/away$/,
      handler: ({ viewer, params, now }) => game.quizState(game.away(params[0] ?? "", viewer, now), viewer),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)\/back$/,
      handler: ({ viewer, params, now }) => game.quizState(game.back(params[0] ?? "", viewer, now), viewer),
    },
    {
      method: "POST",
      pattern: /^\/api\/tests\/sessions\/([\w-]+)\/leave$/,
      handler: ({ viewer, params }) => game.quizState(game.leave(params[0] ?? "", viewer), viewer),
    },
  ];
}

async function serveStatic(publicDir: string, pathname: string, response: ServerResponse): Promise<void> {
  const relative = normalize(pathname.endsWith("/") ? `${pathname}index.html` : pathname).replace(/^([/\\])+/, "");
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir + sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}

export function createAppServer(options: ServerOptions): Server {
  const table = routes(options.game, options.botUsername);
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/admin/api/")) {
        if (options.admin) await options.admin(request, response, url);
        else send(response, 404, { error: "Админка отключена: задайте ADMIN_PASSWORD" });
        return;
      }
      if (url.pathname === "/admin") {
        response.writeHead(301, { Location: "/admin/" }).end();
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405).end();
          return;
        }
        await serveStatic(options.publicDir, url.pathname, response);
        return;
      }
      try {
        const now = Date.now();
        const init = validateInitData(String(request.headers["x-init-data"] ?? ""), options.token, now);
        if (!init) throw new GameError(401, "Недействительные данные запуска");
        const route = table.find((item) => item.method === request.method && item.pattern.test(url.pathname));
        if (!route) throw new GameError(404, "Не найдено");
        const match = route.pattern.exec(url.pathname);
        const name = [init.user.first_name, init.user.last_name].filter(Boolean).join(" ") || "Игрок";
        options.game.touchUser({ id: init.user.id, name, username: init.user.username ?? null }, now, false);
        const context: Context = {
          viewer: { id: init.user.id, name, chatId: init.chatId },
          startParam: init.startParam,
          body: request.method === "POST" ? await readBody(request) : {},
          query: url.searchParams,
          params: match ? match.slice(1) : [],
          now,
        };
        send(response, 200, route.handler(context));
      } catch (error) {
        if (error instanceof GameError) {
          send(response, error.status, { error: error.message });
          return;
        }
        console.error("Ошибка API:", error);
        send(response, 500, { error: "Внутренняя ошибка" });
      }
    })();
  });
}

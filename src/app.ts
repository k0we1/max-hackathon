import { resolve } from "node:path";
import type { Server } from "node:http";
import { createAdminHandler } from "./admin.ts";
import { Bot } from "./bot.ts";
import { Game } from "./game.ts";
import { MaxApi } from "./max.ts";
import { createAppServer } from "./server.ts";
import { Store } from "./store.ts";

export type Config = {
  token: string;
  apiUrl: string;
  port: number;
  dataFile: string;
  publicDir: string;
  tickMs: number;
  adminPassword: string | null;
};

export type App = {
  bot: Bot;
  game: Game;
  store: Store;
  server: Server;
  adminEnabled: boolean;
  stop: () => Promise<void>;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const token = env.MAX_BOT_TOKEN;
  if (!token) throw new Error("Переменная окружения MAX_BOT_TOKEN не задана");
  return {
    token,
    apiUrl: env.MAX_API_URL ?? "https://platform-api2.max.ru",
    port: Number(env.PORT ?? 3000),
    dataFile: resolve(env.DATA_FILE ?? "data/db.json"),
    publicDir: resolve(import.meta.dirname, "../public"),
    tickMs: 15000,
    adminPassword: env.ADMIN_PASSWORD || null,
  };
}

export async function startApp(config: Config): Promise<App> {
  const store = new Store(config.dataFile);
  const bot = new Bot(new MaxApi(config.token, config.apiUrl), store);
  const game = new Game(store, bot, (id) => bot.inviteLink(id));
  bot.attach(game);
  await bot.init();
  const admin = config.adminPassword
    ? createAdminHandler({ store, password: config.adminPassword, broadcast: (text) => bot.broadcast(text) })
    : null;
  const server = createAppServer({
    game,
    token: config.token,
    publicDir: config.publicDir,
    botUsername: () => bot.info.username,
    admin,
  });
  await new Promise<void>((done) => server.listen(config.port, done));
  const controller = new AbortController();
  const polling = bot.run(controller.signal);
  const timer = setInterval(() => game.tick(Date.now()), config.tickMs);
  return {
    bot,
    game,
    store,
    server,
    adminEnabled: admin !== null,
    stop: async () => {
      clearInterval(timer);
      controller.abort();
      await polling;
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

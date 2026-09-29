import { setTimeout as sleep } from "node:timers/promises";
import { findTest } from "./content.ts";
import type { Game, Notifier } from "./game.ts";
import type { BotInfo, Button, Keyboard, MaxApi, MaxUser, Target, Update } from "./max.ts";
import type { CardSession, QuizResult, QuizSession, Reminder, Store } from "./store.ts";

const COMMANDS = [
  { name: "start", description: "Выбрать режим игры" },
  { name: "cards", description: "Карточки для обсуждения" },
  { name: "test", description: "Тест на совместимость вдвоём" },
];

function userName(user: MaxUser): string {
  return user.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || `id${user.user_id}`;
}

function target(chatId: number | null, userId: number): Target {
  return chatId === null ? { userId } : { chatId };
}

function describeResult(result: QuizResult): string {
  const lines = result.players.map((player) => `${player.name}: ${player.title}. ${player.description}`);
  if (result.compatibility) lines.push(`Совместимость: ${result.compatibility}`);
  return lines.join("\n");
}

export class Bot implements Notifier {
  readonly #api: MaxApi;
  readonly #store: Store;
  #info: BotInfo | null = null;
  #game: Game | null = null;

  constructor(api: MaxApi, store: Store) {
    this.#api = api;
    this.#store = store;
  }

  attach(game: Game): void {
    this.#game = game;
  }

  get info(): BotInfo {
    if (!this.#info) throw new Error("Бот не инициализирован");
    return this.#info;
  }

  get #gameRef(): Game {
    if (!this.#game) throw new Error("Игра не подключена");
    return this.#game;
  }

  async init(): Promise<BotInfo> {
    this.#info = await this.#api.me();
    await this.#api.setCommands(COMMANDS).catch((error: unknown) => console.error("Не удалось задать команды:", error));
    return this.#info;
  }

  inviteLink(sessionId: string): string {
    return `https://max.ru/${this.info.username}?startapp=j_${sessionId}`;
  }

  #appButton(text: string, payload: string): Button {
    return { type: "open_app", text, web_app: this.info.username, contact_id: this.info.user_id, payload };
  }

  #shareButton(text: string): Button {
    return { type: "link", text: "Поделиться", url: `https://max.ru/:share?text=${encodeURIComponent(text)}` };
  }

  async #send(to: Target, text: string, keyboard?: Keyboard): Promise<void> {
    await this.#api.sendMessage(to, text, keyboard);
  }

  async #welcome(to: Target): Promise<void> {
    await this.#send(to, "Привет! Здесь карточки с вопросами для разговора и тест на совместимость вдвоём. С чего начнём?", [
      [{ type: "callback", text: "Карточки для обсуждения", payload: "mode:cards" }],
      [{ type: "callback", text: "Тест на совместимость", payload: "mode:test" }],
    ]);
  }

  async #offerCards(chatId: number | null, userId: number, now: number): Promise<void> {
    const launch = this.#gameRef.createLaunch("cards", chatId, userId, now);
    await this.#send(
      target(chatId, userId),
      "Выберите колоду и обсуждайте вопросы по очереди. Правильных ответов нет.",
      [[this.#appButton("Открыть игру", `c_${launch.token}`)]],
    );
  }

  async #offerTest(chatId: number | null, userId: number, now: number): Promise<void> {
    const launch = this.#gameRef.createLaunch("test", chatId, userId, now);
    await this.#send(
      target(chatId, userId),
      "Тест на совместимость: выберите тест, пригласите партнёра и отвечайте на вопросы одновременно.",
      [[this.#appButton("Открыть каталог тестов", `t_${launch.token}`)]],
    );
  }

  #touch(user: MaxUser, now: number, dialog: boolean): void {
    this.#gameRef.touchUser({ id: user.user_id, name: userName(user), username: user.username ?? null }, now, dialog);
  }

  async broadcast(text: string): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const user of Object.values(this.#store.data.users).filter((item) => item.dialog)) {
      try {
        await this.#send({ userId: user.id }, text);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error(`Рассылка: не доставлено ${user.id}:`, error);
      }
      await sleep(100);
    }
    return { sent, failed };
  }

  async handle(update: Update, now: number): Promise<void> {
    if (update.update_type === "bot_started" && update.user) {
      this.#touch(update.user, now, true);
      await this.#welcome(target(update.chat_id ?? null, update.user.user_id));
      return;
    }
    if (update.update_type === "message_created" && update.message?.sender && !update.message.sender.is_bot) {
      const text = update.message.body.text?.trim() ?? "";
      const command = (text.split(/\s+/)[0] ?? "").split("@")[0]?.toLowerCase();
      const chatId = update.message.recipient.chat_id;
      const userId = update.message.sender.user_id;
      this.#touch(update.message.sender, now, update.message.recipient.chat_type === "dialog");
      if (command === "/start") await this.#welcome(target(chatId, userId));
      if (command === "/cards") await this.#offerCards(chatId, userId, now);
      if (command === "/test") await this.#offerTest(chatId, userId, now);
      return;
    }
    if (update.update_type === "message_callback" && update.callback) {
      const { callback_id: callbackId, payload, user } = update.callback;
      const chatId = update.message?.recipient.chat_id ?? null;
      this.#touch(user, now, update.message?.recipient.chat_type === "dialog");
      let notification = "Готово";
      if (payload === "mode:cards") await this.#offerCards(chatId, user.user_id, now);
      if (payload === "mode:test") await this.#offerTest(chatId, user.user_id, now);
      if (payload === "remind:yes") {
        this.#gameRef.setReminder(chatId, user.user_id, now);
        notification = "Напомню завтра в это же время";
      }
      if (payload === "remind:no") notification = "Хорошо, без напоминаний";
      await this.#api.answerCallback(callbackId, notification);
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await this.#api.getUpdates(this.#store.data.marker, 30, signal);
        for (const update of response.updates) {
          await this.handle(update, Date.now()).catch((error: unknown) => console.error("Ошибка обработки события:", error));
        }
        if (typeof response.marker === "number") {
          this.#store.data.marker = response.marker;
          this.#store.save();
        }
      } catch (error) {
        if (signal.aborted) break;
        console.error("Ошибка long polling:", error);
        await sleep(3000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  async cardsFinished(session: CardSession): Promise<void> {
    const result = session.result;
    if (!result) return;
    const text =
      `Итоги встречи: колода «${result.deckTitle}»\n` +
      `Обсуждено карточек: ${result.discussed} из ${result.total}\n` +
      (session.penalty ? `Штрафных заданий: ${result.penalties}\n` : "") +
      `Время игры: ${result.minutes} мин.`;
    const to = target(session.chatId, session.userId);
    await this.#send(to, text, [[this.#shareButton(`Мы сыграли в карточки «${result.deckTitle}» и обсудили ${result.discussed} вопросов!`)]]);
    await this.#send(to, "Напомнить поиграть завтра?", [
      [
        { type: "callback", text: "Да", payload: "remind:yes" },
        { type: "callback", text: "Нет", payload: "remind:no" },
      ],
    ]);
  }

  async cardsExited(session: CardSession): Promise<void> {
    await this.#send(
      target(session.chatId, session.userId),
      `Прогресс сохранён: обсуждено ${session.discussed.length} из ${session.order.length}. Продолжить можно в любой момент.`,
      [[this.#appButton("Продолжить игру", `s_${session.id}`)]],
    );
  }

  async quizInvite(session: QuizSession): Promise<void> {
    const test = findTest(session.testId);
    const initiator = session.players[0]?.name ?? "Игрок";
    await this.#send(
      target(session.chatId, session.initiatorId),
      `${initiator} приглашает пройти тест «${test?.title ?? ""}» вдвоём. Присоединиться можно в течение 5 минут. Ссылка для пересылки: ${this.inviteLink(session.id)}`,
      [[this.#appButton("Присоединиться", `j_${session.id}`)]],
    );
  }

  async quizAway(session: QuizSession, name: string): Promise<void> {
    const test = findTest(session.testId);
    await this.#send(
      target(session.chatId, session.initiatorId),
      `Тест «${test?.title ?? ""}» на паузе: ${name} сейчас не в приложении. Возвращайтесь, партнёр ждёт!`,
      [[this.#appButton("Вернуться к тесту", `j_${session.id}`)]],
    );
  }

  async quizFinished(session: QuizSession): Promise<void> {
    const result = session.result;
    const test = findTest(session.testId);
    if (!result || !test) return;
    const title =
      session.status === "finished"
        ? `Результат теста «${test.title}»`
        : session.status === "timeout"
          ? `Тест «${test.title}» остановлен: не дождались ответа. Частичный результат (${result.answered} из ${result.total})`
          : `Тест «${test.title}» прерван. Частичный результат (${result.answered} из ${result.total})`;
    const body = result.players.length > 0 ? describeResult(result) : "Ответов пока нет.";
    const keyboard: Keyboard | undefined =
      result.players.length > 0 ? [[this.#shareButton(`${title}\n${body}`)]] : undefined;
    await this.#send(target(session.chatId, session.initiatorId), `${title}\n${body}`, keyboard);
  }

  async quizSoloOffer(session: QuizSession): Promise<void> {
    const test = findTest(session.testId);
    await this.#send(
      target(session.chatId, session.initiatorId),
      `Партнёр так и не присоединился к тесту «${test?.title ?? ""}». Можно пройти его в одиночку.`,
      [[this.#appButton("Пройти одному", `o_${session.testId}`)]],
    );
  }

  async reminder(reminder: Reminder): Promise<void> {
    const launch = this.#gameRef.createLaunch("cards", reminder.chatId, reminder.userId, Date.now());
    await this.#send(target(reminder.chatId, reminder.userId), "Вчера вы играли в карточки. Сыграем ещё?", [
      [this.#appButton("Открыть игру", `c_${launch.token}`)],
    ]);
  }
}

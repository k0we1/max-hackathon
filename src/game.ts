import { compatibilityKey, findTest, LANGS, MOODS, TESTS, THEMES } from "./content.ts";
import type { Test } from "./content.ts";
import { newId } from "./store.ts";
import type { CardSession, Launch, Mode, Player, QuizResult, QuizSession, Reminder, Store, UserRecord } from "./store.ts";

export const CARD_IDLE_MS = 10 * 60 * 1000;
export const JOIN_TIMEOUT_MS = 5 * 60 * 1000;
export const SOLO_OFFER_MS = 15 * 60 * 1000;
export const ANSWER_TIMEOUT_MS = 2 * 60 * 1000;
export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type Viewer = { id: number; name: string; chatId: number | null };

export type SeenUser = { id: number; name: string; username: string | null };

const TOUCH_INTERVAL_MS = 60 * 1000;

export type Notifier = {
  cardsFinished(session: CardSession): Promise<void>;
  cardsExited(session: CardSession): Promise<void>;
  quizInvite(session: QuizSession): Promise<void>;
  quizAway(session: QuizSession, name: string): Promise<void>;
  quizFinished(session: QuizSession): Promise<void>;
  quizSoloOffer(session: QuizSession): Promise<void>;
  reminder(reminder: Reminder): Promise<void>;
};

export class GameError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function shuffle(length: number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = order[i] as number;
    order[i] = order[j] as number;
    order[j] = a;
  }
  return order;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function testOf(session: QuizSession): Test {
  const test = findTest(session.testId);
  if (!test) throw new GameError(500, "Тест не найден");
  return test;
}

export function computeResult(session: QuizSession, test: Test, partial: boolean): QuizResult {
  const players = session.players
    .filter((player) => player.answers.some((answer) => answer !== null))
    .map((player) => {
      const scores = new Map(test.types.map((type) => [type.id, 0]));
      player.answers.forEach((answer, index) => {
        const option = answer === null ? undefined : test.questions[index]?.options[answer];
        for (const [typeId, weight] of Object.entries(option?.weights ?? {})) {
          scores.set(typeId, (scores.get(typeId) ?? 0) + weight);
        }
      });
      const best = test.types.reduce((top, type) =>
        (scores.get(type.id) ?? 0) > (scores.get(top.id) ?? 0) ? type : top,
      );
      return { userId: player.userId, name: player.name, typeId: best.id, title: best.title, description: best.description };
    });
  const [first, second] = players;
  const compatibility = first && second ? (test.compatibility[compatibilityKey(first.typeId, second.typeId)] ?? null) : null;
  return { players, compatibility, answered: session.round, total: test.questions.length, partial };
}

export class Game {
  readonly #store: Store;
  readonly #notifier: Notifier;
  readonly #inviteLink: (sessionId: string) => string;

  constructor(store: Store, notifier: Notifier, inviteLink: (sessionId: string) => string) {
    this.#store = store;
    this.#notifier = notifier;
    this.#inviteLink = inviteLink;
  }

  #notify(task: Promise<void>): void {
    task.catch((error: unknown) => console.error("Ошибка уведомления:", error));
  }

  #save(): void {
    this.#store.save();
  }

  createLaunch(mode: Mode, chatId: number | null, userId: number, now: number): Launch {
    const launch = { token: newId(), mode, chatId, userId, createdAt: now };
    this.#store.data.launches[launch.token] = launch;
    this.#save();
    return launch;
  }

  touchUser(user: SeenUser, now: number, dialog: boolean): UserRecord {
    const users = this.#store.data.users;
    const known = users[user.id];
    if (known && known.name === user.name && (known.dialog || !dialog) && now - known.lastSeen < TOUCH_INTERVAL_MS) return known;
    const record: UserRecord = {
      id: user.id,
      name: user.name,
      username: user.username ?? known?.username ?? null,
      dialog: dialog || (known?.dialog ?? false),
      firstSeen: known?.firstSeen ?? now,
      lastSeen: now,
    };
    users[user.id] = record;
    this.#save();
    return record;
  }

  #chatFor(launchToken: string | null, viewer: Viewer): number | null {
    const launch = launchToken ? this.#store.data.launches[launchToken] : undefined;
    return launch?.chatId ?? viewer.chatId;
  }

  catalog(filters: { theme?: string | undefined; mood?: string | undefined; lang?: string | undefined }) {
    return {
      filters: { themes: THEMES, moods: MOODS, langs: LANGS },
      decks: Object.values(this.#store.data.decks).filter(
        (deck) =>
          !deck.archived &&
          (!filters.theme || deck.theme === filters.theme) &&
          (!filters.mood || deck.mood === filters.mood) &&
          (!filters.lang || deck.lang === filters.lang),
      ).map((deck) => ({
        id: deck.id,
        title: deck.title,
        description: deck.description,
        theme: deck.theme,
        mood: deck.mood,
        lang: deck.lang,
        size: deck.cards.length,
        penalties: deck.penalties.length,
      })),
    };
  }

  tests() {
    return TESTS.map((test) => ({
      id: test.id,
      title: test.title,
      description: test.description,
      joint: test.joint,
      size: test.questions.length,
    }));
  }

  cardState(session: CardSession) {
    const index = session.order[session.discussed.length];
    return {
      id: session.id,
      deck: { id: session.deckId, title: session.deckTitle },
      penalty: session.penalty,
      status: session.status,
      total: session.order.length,
      discussed: session.discussed.length,
      current: session.status === "finished" || index === undefined ? null : { index, text: session.cards[index] ?? "" },
      lastPenalty: session.lastPenalty,
      result: session.result,
    };
  }

  #ownCards(id: string, viewer: Viewer): CardSession {
    const session = this.#store.data.cards[id];
    if (!session || session.userId !== viewer.id) throw new GameError(404, "Сессия не найдена");
    return session;
  }

  currentCards(viewer: Viewer): CardSession | null {
    const sessions = Object.values(this.#store.data.cards)
      .filter((session) => session.userId === viewer.id && session.status !== "finished")
      .sort((a, b) => b.lastActivity - a.lastActivity);
    return sessions[0] ?? null;
  }

  startCards(viewer: Viewer, deckId: string, penalty: boolean, launchToken: string | null, now: number): CardSession {
    const deck = this.#store.data.decks[deckId];
    if (!deck || deck.archived || deck.cards.length === 0) throw new GameError(400, "Колода не найдена");
    for (const old of Object.values(this.#store.data.cards)) {
      if (old.userId === viewer.id && old.status !== "finished") old.status = "paused";
    }
    const session: CardSession = {
      id: newId(),
      userId: viewer.id,
      chatId: this.#chatFor(launchToken, viewer),
      deckId: deck.id,
      deckTitle: deck.title,
      cards: [...deck.cards],
      penalties: [...deck.penalties],
      penalty,
      order: shuffle(deck.cards.length),
      discussed: [],
      penaltiesShown: 0,
      lastPenalty: null,
      status: "active",
      startedAt: now,
      lastActivity: now,
      finishedAt: null,
      result: null,
    };
    this.#store.data.cards[session.id] = session;
    this.#save();
    return session;
  }

  getCards(id: string, viewer: Viewer): CardSession {
    return this.#ownCards(id, viewer);
  }

  resumeCards(id: string, viewer: Viewer, now: number): CardSession {
    const session = this.#ownCards(id, viewer);
    if (session.status === "paused") {
      session.status = "active";
      session.lastActivity = now;
      this.#save();
    }
    return session;
  }

  markDiscussed(id: string, viewer: Viewer, now: number): CardSession {
    const session = this.#ownCards(id, viewer);
    if (session.status === "finished") throw new GameError(409, "Сессия уже завершена");
    const index = session.order[session.discussed.length];
    if (index === undefined) throw new GameError(409, "Карточки закончились");
    session.status = "active";
    session.discussed.push(index);
    session.lastActivity = now;
    session.lastPenalty = session.penalty && session.penalties.length > 0 ? pick(session.penalties) : null;
    if (session.lastPenalty) session.penaltiesShown += 1;
    if (session.discussed.length === session.order.length) {
      session.status = "finished";
      session.finishedAt = now;
      session.result = {
        deckTitle: session.deckTitle,
        discussed: session.discussed.length,
        total: session.order.length,
        penalties: session.penaltiesShown,
        minutes: Math.max(1, Math.round((now - session.startedAt) / 60000)),
      };
      this.#notify(this.#notifier.cardsFinished(session));
    }
    this.#save();
    return session;
  }

  exitCards(id: string, viewer: Viewer): CardSession {
    const session = this.#ownCards(id, viewer);
    if (session.status !== "finished") {
      session.status = "paused";
      this.#save();
      this.#notify(this.#notifier.cardsExited(session));
    }
    return session;
  }

  quizState(session: QuizSession, viewer: Viewer) {
    const test = testOf(session);
    const me = session.players.find((player) => player.userId === viewer.id);
    const question = session.status === "playing" ? test.questions[session.round] : undefined;
    return {
      id: session.id,
      test: { id: test.id, title: test.title },
      solo: session.solo,
      status: session.status,
      round: session.round,
      total: test.questions.length,
      isPlayer: Boolean(me),
      question: question ? { text: question.text, options: question.options.map((option) => option.text) } : null,
      myAnswer: me ? (me.answers[session.round] ?? null) : null,
      players: session.players.map((player) => ({
        name: player.name,
        me: player.userId === viewer.id,
        state: player.state,
        answered: player.answers[session.round] !== null && player.answers[session.round] !== undefined,
      })),
      paused: session.pausedAt !== null,
      inviteLink: session.solo ? null : this.#inviteLink(session.id),
      joinDeadline: session.status === "waiting" ? session.createdAt + JOIN_TIMEOUT_MS : null,
      roundDeadline:
        session.status === "playing" && session.pausedAt === null && session.roundStartedAt !== null
          ? session.roundStartedAt + ANSWER_TIMEOUT_MS
          : null,
      result: session.result,
    };
  }

  #quiz(id: string): QuizSession {
    const session = this.#store.data.quizzes[id];
    if (!session) throw new GameError(404, "Сессия не найдена");
    return session;
  }

  #player(session: QuizSession, viewer: Viewer): Player {
    const player = session.players.find((item) => item.userId === viewer.id);
    if (!player) throw new GameError(403, "Вы не участник этой сессии");
    return player;
  }

  #newPlayer(viewer: Viewer, test: Test): Player {
    return { userId: viewer.id, name: viewer.name, answers: test.questions.map(() => null), state: "active" };
  }

  startQuiz(viewer: Viewer, testId: string, solo: boolean, launchToken: string | null, now: number): QuizSession {
    const test = findTest(testId);
    if (!test) throw new GameError(400, "Тест не найден");
    const isSolo = solo || !test.joint;
    const session: QuizSession = {
      id: newId(),
      testId: test.id,
      solo: isSolo,
      chatId: this.#chatFor(launchToken, viewer),
      initiatorId: viewer.id,
      status: isSolo ? "playing" : "waiting",
      players: [this.#newPlayer(viewer, test)],
      round: 0,
      roundStartedAt: isSolo ? now : null,
      pausedAt: null,
      createdAt: now,
      soloOffered: false,
      result: null,
    };
    this.#store.data.quizzes[session.id] = session;
    this.#save();
    if (!isSolo) this.#notify(this.#notifier.quizInvite(session));
    return session;
  }

  getQuiz(id: string, viewer: Viewer): QuizSession {
    const session = this.#quiz(id);
    if (session.status !== "waiting") this.#player(session, viewer);
    return session;
  }

  joinQuiz(id: string, viewer: Viewer, now: number): QuizSession {
    const session = this.#quiz(id);
    if (session.players.some((player) => player.userId === viewer.id)) return session;
    if (session.status !== "waiting") throw new GameError(409, "К этой сессии уже нельзя присоединиться");
    session.players.push(this.#newPlayer(viewer, testOf(session)));
    session.status = "playing";
    session.roundStartedAt = now;
    this.#save();
    return session;
  }

  answer(id: string, viewer: Viewer, option: number, now: number): QuizSession {
    const session = this.#quiz(id);
    const player = this.#player(session, viewer);
    if (session.status !== "playing") throw new GameError(409, "Сессия не активна");
    const test = testOf(session);
    const question = test.questions[session.round];
    if (!question || !Number.isInteger(option) || option < 0 || option >= question.options.length) {
      throw new GameError(400, "Некорректный ответ");
    }
    if (player.answers[session.round] !== null) throw new GameError(409, "Ответ уже принят");
    player.answers[session.round] = option;
    player.state = "active";
    if (session.players.every((item) => item.answers[session.round] !== null)) {
      session.round += 1;
      session.roundStartedAt = now;
      session.pausedAt = null;
      if (session.round >= test.questions.length) {
        session.status = "finished";
        session.result = computeResult(session, test, false);
        this.#notify(this.#notifier.quizFinished(session));
      }
    }
    this.#save();
    return session;
  }

  away(id: string, viewer: Viewer, now: number): QuizSession {
    const session = this.#quiz(id);
    const player = this.#player(session, viewer);
    if (session.status === "playing" && player.state === "active") {
      player.state = "away";
      session.pausedAt ??= now;
      this.#save();
      if (!session.solo) this.#notify(this.#notifier.quizAway(session, player.name));
    }
    return session;
  }

  back(id: string, viewer: Viewer, now: number): QuizSession {
    const session = this.#quiz(id);
    const player = this.#player(session, viewer);
    if (player.state === "away") {
      player.state = "active";
      if (session.pausedAt !== null && session.players.every((item) => item.state !== "away")) {
        if (session.roundStartedAt !== null) session.roundStartedAt += now - session.pausedAt;
        session.pausedAt = null;
      }
      this.#save();
    }
    return session;
  }

  leave(id: string, viewer: Viewer): QuizSession {
    const session = this.#quiz(id);
    const player = this.#player(session, viewer);
    if (session.status === "waiting" || session.status === "playing") {
      const wasPlaying = session.status === "playing";
      player.state = "left";
      session.status = "interrupted";
      session.result = computeResult(session, testOf(session), true);
      this.#save();
      if (wasPlaying) this.#notify(this.#notifier.quizFinished(session));
    }
    return session;
  }

  setReminder(chatId: number | null, userId: number, now: number): Reminder {
    const key = chatId === null ? `u${userId}` : `c${chatId}`;
    const reminder = { key, chatId, userId, nextAt: now + REMINDER_INTERVAL_MS };
    this.#store.data.reminders[key] = reminder;
    this.#save();
    return reminder;
  }

  tick(now: number): void {
    const data = this.#store.data;
    let changed = false;
    for (const session of Object.values(data.cards)) {
      if (session.status === "active" && now - session.lastActivity > CARD_IDLE_MS) {
        session.status = "paused";
        changed = true;
      }
    }
    for (const session of Object.values(data.quizzes)) {
      if (session.status === "waiting" && now - session.createdAt > JOIN_TIMEOUT_MS) {
        session.status = "expired";
        changed = true;
      }
      if (session.status === "expired" && !session.soloOffered && now - session.createdAt > SOLO_OFFER_MS) {
        session.soloOffered = true;
        changed = true;
        this.#notify(this.#notifier.quizSoloOffer(session));
      }
      if (
        session.status === "playing" &&
        session.pausedAt === null &&
        session.roundStartedAt !== null &&
        now - session.roundStartedAt > ANSWER_TIMEOUT_MS
      ) {
        session.status = "timeout";
        session.result = computeResult(session, testOf(session), true);
        changed = true;
        this.#notify(this.#notifier.quizFinished(session));
      }
    }
    for (const reminder of Object.values(data.reminders)) {
      if (reminder.nextAt <= now) {
        while (reminder.nextAt <= now) reminder.nextAt += REMINDER_INTERVAL_MS;
        changed = true;
        this.#notify(this.#notifier.reminder(reminder));
      }
    }
    if (changed) this.#save();
  }
}

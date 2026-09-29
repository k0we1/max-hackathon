import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { DECKS } from "./content.ts";
import type { Deck } from "./content.ts";

export type Mode = "cards" | "test";

export type Launch = {
  token: string;
  mode: Mode;
  chatId: number | null;
  userId: number;
  createdAt: number;
};

export type CardStatus = "active" | "paused" | "finished";

export type CardResult = {
  deckTitle: string;
  discussed: number;
  total: number;
  penalties: number;
  minutes: number;
};

export type CardSession = {
  id: string;
  userId: number;
  chatId: number | null;
  deckId: string;
  deckTitle: string;
  cards: string[];
  penalties: string[];
  penalty: boolean;
  order: number[];
  discussed: number[];
  penaltiesShown: number;
  lastPenalty: string | null;
  status: CardStatus;
  startedAt: number;
  lastActivity: number;
  finishedAt: number | null;
  result: CardResult | null;
};

export type PlayerState = "active" | "away" | "left";

export type Player = {
  userId: number;
  name: string;
  answers: (number | null)[];
  state: PlayerState;
};

export type QuizStatus = "waiting" | "playing" | "finished" | "expired" | "interrupted" | "timeout";

export type PlayerResult = {
  userId: number;
  name: string;
  typeId: string;
  title: string;
  description: string;
};

export type QuizResult = {
  players: PlayerResult[];
  compatibility: string | null;
  answered: number;
  total: number;
  partial: boolean;
};

export type QuizSession = {
  id: string;
  testId: string;
  solo: boolean;
  chatId: number | null;
  initiatorId: number;
  status: QuizStatus;
  players: Player[];
  round: number;
  roundStartedAt: number | null;
  pausedAt: number | null;
  createdAt: number;
  soloOffered: boolean;
  result: QuizResult | null;
};

export type Reminder = {
  key: string;
  chatId: number | null;
  userId: number;
  nextAt: number;
};

export type UserRecord = {
  id: number;
  name: string;
  username: string | null;
  dialog: boolean;
  firstSeen: number;
  lastSeen: number;
};

export type Data = {
  marker: number | null;
  decks: Record<string, Deck>;
  users: Record<string, UserRecord>;
  launches: Record<string, Launch>;
  cards: Record<string, CardSession>;
  quizzes: Record<string, QuizSession>;
  reminders: Record<string, Reminder>;
};

export function newId(): string {
  return randomBytes(9).toString("base64url");
}

export class Store {
  readonly #file: string;
  readonly data: Data;

  constructor(file: string) {
    this.#file = file;
    const loaded: Partial<Data> = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Data>) : {};
    this.data = {
      marker: loaded.marker ?? null,
      decks: loaded.decks ?? Object.fromEntries(DECKS.map((deck) => [deck.id, structuredClone(deck)])),
      users: loaded.users ?? {},
      launches: loaded.launches ?? {},
      cards: loaded.cards ?? {},
      quizzes: loaded.quizzes ?? {},
      reminders: loaded.reminders ?? {},
    };
  }

  save(): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.#file);
  }
}

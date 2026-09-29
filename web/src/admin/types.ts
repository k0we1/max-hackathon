export type Dict = Record<string, string>;

export type Stats = {
  users: { total: number; dialog: number; active24h: number; active7d: number };
  cards: { total: number; finished: number; active: number; discussed: number };
  tests: { total: number; finished: number; joint: number; interrupted: number };
  reminders: number;
  decks: { id: string; title: string; sessions: number; finished: number }[];
  testsTop: { id: string; title: string; sessions: number; finished: number }[];
};

export type UserRow = {
  id: number;
  name: string;
  username: string | null;
  dialog: boolean;
  firstSeen: number;
  lastSeen: number;
  cards: number;
  tests: number;
  reminder: boolean;
};

export type CardSummary = {
  id: string;
  userId: number;
  userName: string;
  deckTitle: string;
  penalty: boolean;
  status: "active" | "paused" | "finished";
  discussed: number;
  total: number;
  startedAt: number;
  lastActivity: number;
  result: { minutes: number; penalties: number } | null;
};

export type QuizSummary = {
  id: string;
  testTitle: string;
  solo: boolean;
  status: string;
  createdAt: number;
  players: { userId: number; name: string; state: string; answered: number }[];
  result: {
    players: { userId: number; name: string; title: string }[];
    compatibility: string | null;
    partial: boolean;
    answered: number;
    total: number;
  } | null;
};

export type Reminder = { key: string; chatId: number | null; userId: number; userName: string; nextAt: number };

export type UserDetail = {
  user: Omit<UserRow, "cards" | "tests" | "reminder">;
  cards: CardSummary[];
  tests: QuizSummary[];
  reminders: Omit<Reminder, "userName">[];
};

export type Deck = {
  id: string;
  title: string;
  description: string;
  theme: string;
  mood: string;
  lang: string;
  cards: string[];
  penalties: string[];
  archived?: boolean;
};

export type DecksResponse = { filters: { themes: Dict; moods: Dict; langs: Dict }; decks: Deck[] };

export type Test = {
  id: string;
  title: string;
  description: string;
  joint: boolean;
  types: { id: string; title: string; description: string }[];
  questions: { text: string; options: { text: string; weights: Record<string, number> }[] }[];
};

export type Me = { user: { id: number; name: string }; startParam: string | null; bot: string };

export type Filters = { theme?: string; mood?: string };

export type DeckSummary = {
  id: string;
  title: string;
  description: string;
  theme: string;
  mood: string;
  lang: string;
  size: number;
  penalties: number;
};

export type Catalog = {
  filters: { themes: Record<string, string>; moods: Record<string, string>; langs: Record<string, string> };
  decks: DeckSummary[];
};

export type CardResult = { deckTitle: string; discussed: number; total: number; penalties: number; minutes: number };

export type CardState = {
  id: string;
  deck: { id: string; title: string };
  penalty: boolean;
  status: "active" | "paused" | "finished";
  total: number;
  discussed: number;
  current: { index: number; text: string } | null;
  lastPenalty: string | null;
  result: CardResult | null;
};

export type TestSummary = { id: string; title: string; description: string; joint: boolean; size: number };

export type QuizStatus = "waiting" | "playing" | "finished" | "expired" | "interrupted" | "timeout";

export type QuizResult = {
  players: { userId: number; name: string; typeId: string; title: string; description: string }[];
  compatibility: string | null;
  answered: number;
  total: number;
  partial: boolean;
};

export type QuizState = {
  id: string;
  test: { id: string; title: string };
  solo: boolean;
  status: QuizStatus;
  round: number;
  total: number;
  isPlayer: boolean;
  question: { text: string; options: string[] } | null;
  myAnswer: number | null;
  players: { name: string; me: boolean; state: "active" | "away" | "left"; answered: boolean }[];
  paused: boolean;
  inviteLink: string | null;
  joinDeadline: number | null;
  roundDeadline: number | null;
  result: QuizResult | null;
};

export type Button =
  | { type: "callback"; text: string; payload: string }
  | { type: "link"; text: string; url: string }
  | { type: "open_app"; text: string; web_app: string; contact_id: number; payload?: string };

export type Keyboard = Button[][];

export type MaxUser = {
  user_id: number;
  name?: string;
  first_name?: string;
  last_name?: string | null;
  username?: string | null;
  is_bot?: boolean;
};

export type BotInfo = MaxUser & { username: string };

export type MaxMessage = {
  sender?: MaxUser | null;
  recipient: { chat_id: number | null; chat_type: string; user_id: number | null };
  body: { mid: string; text: string | null };
};

export type Update = {
  update_type: string;
  timestamp: number;
  chat_id?: number;
  user?: MaxUser;
  payload?: string | null;
  message?: MaxMessage | null;
  callback?: { callback_id: string; payload?: string; user: MaxUser };
};

export type Target = { chatId: number } | { userId: number };

type Query = Record<string, string | number | undefined>;

export class MaxApi {
  readonly #token: string;
  readonly #baseUrl: string;

  constructor(token: string, baseUrl: string) {
    this.#token = token;
    this.#baseUrl = baseUrl;
  }

  async #call<T>(method: string, path: string, query: Query = {}, body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const init: RequestInit = { method, headers: { Authorization: this.#token, "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;
    const response = await fetch(url, init);
    const text = await response.text();
    if (!response.ok) throw new Error(`MAX ${method} ${path} ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  me(): Promise<BotInfo> {
    return this.#call<BotInfo>("GET", "/me");
  }

  setCommands(commands: { name: string; description: string }[]): Promise<unknown> {
    return this.#call("PATCH", "/me/commands", {}, { commands });
  }

  getUpdates(marker: number | null, timeout: number, signal: AbortSignal): Promise<{ updates: Update[]; marker: number | null }> {
    return this.#call(
      "GET",
      "/updates",
      {
        timeout,
        limit: 100,
        marker: marker ?? undefined,
        types: "message_created,message_callback,bot_started",
      },
      undefined,
      signal,
    );
  }

  sendMessage(target: Target, text: string, keyboard?: Keyboard): Promise<unknown> {
    const query = "chatId" in target ? { chat_id: target.chatId } : { user_id: target.userId };
    const body: { text: string; attachments?: unknown[] } = { text };
    if (keyboard) body.attachments = [{ type: "inline_keyboard", payload: { buttons: keyboard } }];
    return this.#call("POST", "/messages", query, body);
  }

  answerCallback(callbackId: string, notification: string): Promise<unknown> {
    return this.#call("POST", "/answers", { callback_id: callbackId }, { notification });
  }
}

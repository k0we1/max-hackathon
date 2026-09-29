import { createHmac, timingSafeEqual } from "node:crypto";

export type WebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type InitData = {
  user: WebAppUser;
  chatId: number | null;
  startParam: string | null;
  authDate: number;
};

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function signInitData(params: [string, string][], token: string): string {
  const launchParams = [...params]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return createHmac("sha256", secret).update(launchParams).digest("hex");
}

export function validateInitData(raw: string, token: string, nowMs: number): InitData | null {
  if (!raw) return null;
  const params: [string, string][] = [];
  for (const part of raw.split("&")) {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    try {
      params.push([part.slice(0, index), decodeURIComponent(part.slice(index + 1))]);
    } catch {
      return null;
    }
  }
  const hashes = params.filter(([key]) => key === "hash");
  const hash = hashes[0]?.[1];
  if (hashes.length !== 1 || !hash) return null;
  const expected = Buffer.from(signInitData(params.filter(([key]) => key !== "hash"), token), "hex");
  const received = Buffer.from(hash, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const fields = new Map(params);
  const authDate = Number(fields.get("auth_date"));
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > MAX_AGE_SECONDS) return null;
  try {
    const user = JSON.parse(fields.get("user") ?? "null") as WebAppUser | null;
    if (!user || typeof user.id !== "number") return null;
    const chatRaw = fields.get("chat");
    const chat = chatRaw ? (JSON.parse(chatRaw) as { id?: number }) : null;
    return {
      user,
      chatId: typeof chat?.id === "number" ? chat.id : null,
      startParam: fields.get("start_param") || null,
      authDate,
    };
  } catch {
    return null;
  }
}

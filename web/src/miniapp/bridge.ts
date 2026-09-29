type MaxWebApp = {
  initData?: string;
  ready?: () => void;
  close?: () => void;
  shareMaxContent?: (content: { text: string }) => void;
  HapticFeedback?: { notificationOccurred?: (type: "success" | "error" | "warning") => void };
};

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

export const webApp: MaxWebApp | null = window.WebApp ?? null;

export function initData(): string {
  return webApp?.initData || new URLSearchParams(location.hash.slice(1)).get("WebAppData") || "";
}

export function haptic(type: "success" | "error" | "warning"): void {
  webApp?.HapticFeedback?.notificationOccurred?.(type);
}

export function share(text: string): void {
  if (webApp?.shareMaxContent) webApp.shareMaxContent({ text });
  else window.open(`https://max.ru/:share?text=${encodeURIComponent(text)}`, "_blank");
}

export function closeApp(): void {
  webApp?.close?.();
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Init-Data": initData() };
  const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Ошибка ${response.status}`);
  return data as T;
}

export function signal(path: string): void {
  void fetch(path, {
    method: "POST",
    keepalive: true,
    headers: { "X-Init-Data": initData(), "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}

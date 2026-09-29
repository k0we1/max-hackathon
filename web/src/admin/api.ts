const STORAGE_KEY = "admin-password";

export class AuthError extends Error {}

export function readPassword(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writePassword(value: string): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export async function adminApi<T>(password: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${password}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`/admin/api/${path}`, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) throw new AuthError(data.error ?? "Неверный пароль");
  if (!response.ok) throw new Error(data.error ?? `Ошибка ${response.status}`);
  return data as T;
}

export function formatDate(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "нет";
}

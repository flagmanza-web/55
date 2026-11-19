export const DEFAULT_PUBLISHED_SERVER_URL =
  'https://service-473676-595246104496.us-west1.run.app';

const STORAGE_KEY_API_BASE = 'cp_api_base_url';

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isCapacitorNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (typeof win.Capacitor?.isNativePlatform === 'function') {
    try {
      if (win.Capacitor.isNativePlatform()) return true;
    } catch {
      // ignore
    }
  }
  const { protocol, hostname, port } = window.location;
  if (protocol === 'capacitor:' || protocol === 'file:') return true;
  if (hostname === 'localhost' && !port) return true;
  return false;
}

export function getSavedApiBaseUrl(): string {
  try {
    return normalizeServerUrl(localStorage.getItem(STORAGE_KEY_API_BASE) || '');
  } catch {
    return '';
  }
}

export function saveApiBaseUrl(url: string): void {
  try {
    const cleaned = normalizeServerUrl(url);
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY_API_BASE, cleaned);
    } else {
      localStorage.removeItem(STORAGE_KEY_API_BASE);
    }
  } catch {
    // ignore storage errors
  }
}

export function getEffectiveApiBaseUrl(): string {
  const saved = getSavedApiBaseUrl();
  if (saved) return saved;

  const envBase = normalizeServerUrl(import.meta.env.VITE_API_BASE_URL || '');
  if (envBase) return envBase;

  if (isCapacitorNativeRuntime()) {
    return DEFAULT_PUBLISHED_SERVER_URL;
  }

  return '';
}

export function resolveApiUrl(path: string, customBase?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base =
    customBase !== undefined
      ? normalizeServerUrl(customBase)
      : getEffectiveApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export async function parseApiJsonResponse<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!contentType.includes('application/json')) {
    if (text.includes('__cookie_check') || text.includes('<html')) {
      throw new Error(
        'Сервер вернул страницу входа вместо API-ответа. Для работы из APK нужен публичный адрес сервера без авторизации.'
      );
    }
    throw new Error(`Некорректный ответ сервера (HTTP ${res.status}).`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Ошибка разбора ответа сервера (HTTP ${res.status}).`);
  }
}

import type {
  Entry,
  EntryDetail,
  Lens,
  ProjectSummary,
  ReviewState,
  StatusReport,
} from "@atlas/core";

declare const __ATLAS_DEV_TOKEN__: string;

export interface Connection {
  base: string;
  token: string | null;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let connection: Promise<Connection> | null = null;

export function getConnection(): Promise<Connection> {
  connection ??= (async () => {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      const c = await invoke<{ url: string; token: string | null }>("daemon_connection");
      return { base: c.url, token: c.token };
    }
    return { base: "http://127.0.0.1:47600", token: __ATLAS_DEV_TOKEN__ || null };
  })();
  return connection;
}

/** The token file appears after the daemon's first start; retry reading it. */
export function resetConnection(): void {
  connection = null;
}

export class DaemonOffline extends Error {
  constructor() {
    super("Atlas's background service isn't running.");
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { base, token } = await getConnection();
  if (!token) throw new DaemonOffline();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new DaemonOffline();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export type ListedEntry = Entry & { source: EntryDetail["source"] };

export const api = {
  status: () => request<StatusReport>("/api/status"),
  projects: () => request<ProjectSummary[]>("/api/projects"),
  project: (id: string) => request<ProjectSummary & { lenses: Lens[] }>(`/api/projects/${id}`),
  entries: (projectId: string) => request<ListedEntry[]>(`/api/projects/${projectId}/entries`),
  entry: (id: string) => request<EntryDetail>(`/api/entries/${encodeURIComponent(id)}`),
  review: (id: string, state: ReviewState | "dismissed") =>
    request<EntryDetail>(`/api/entries/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ state }),
    }),
  reviewQueue: () => request<ListedEntry[]>("/api/review"),
  search: (q: string, project?: string) =>
    request<ListedEntry[]>(
      `/api/search?q=${encodeURIComponent(q)}${project ? `&project=${encodeURIComponent(project)}` : ""}`,
    ),
  setApiKey: (key: string) =>
    request<{ ok: true }>("/api/settings/api-key", {
      method: "PUT",
      body: JSON.stringify({ key }),
    }),
  removeApiKey: () => request<{ ok: true }>("/api/settings/api-key", { method: "DELETE" }),
  addProject: (rootPath: string) =>
    request<ProjectSummary>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ rootPath }),
    }),
  saveLens: (projectId: string | null, title: string, prompt: string) =>
    request<{ id: string }>("/api/lenses", {
      method: "POST",
      body: JSON.stringify({ projectId, title, prompt }),
    }),
  deleteLens: (id: string) => request<{ ok: true }>(`/api/lenses/${id}`, { method: "DELETE" }),
};

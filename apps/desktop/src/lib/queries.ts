import type { LiveEvent } from "@atlas/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, getConnection } from "./api.ts";

export const keys = {
  status: ["status"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  entries: (projectId: string) => ["entries", projectId] as const,
  entry: (id: string) => ["entry", id] as const,
  review: ["review"] as const,
  trajectory: (projectId: string) => ["trajectory", projectId] as const,
  links: ["links"] as const,
};

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: api.status });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useProject = (id: string | null) =>
  useQuery({ queryKey: keys.project(id ?? ""), queryFn: () => api.project(id!), enabled: !!id });
export const useEntries = (projectId: string | null) =>
  useQuery({
    queryKey: keys.entries(projectId ?? ""),
    queryFn: () => api.entries(projectId!),
    enabled: !!projectId,
  });
export const useEntry = (id: string | null) =>
  useQuery({ queryKey: keys.entry(id ?? ""), queryFn: () => api.entry(id!), enabled: !!id });
export const useReviewQueue = () => useQuery({ queryKey: keys.review, queryFn: api.reviewQueue });
export const useTrajectory = (projectId: string | null) =>
  useQuery({
    queryKey: keys.trajectory(projectId ?? ""),
    queryFn: () => api.trajectory(projectId!),
    enabled: !!projectId,
  });
export const useLinkSuggestions = () =>
  useQuery({ queryKey: keys.links, queryFn: api.linkSuggestions });

export type LiveState = "connecting" | "live" | "offline";

/**
 * Subscribes to atlasd's SSE stream and invalidates exactly what changed, so a
 * decision made in any Claude session appears in the open window within seconds.
 * Returns the ids of entries that arrived during this window's lifetime.
 */
export function useLiveUpdates(): { state: LiveState; fresh: Set<string> } {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    void getConnection().then(({ base, token }) => {
      if (cancelled || !token) {
        setState("offline");
        return;
      }
      source = new EventSource(`${base}/events?token=${token}`);
      source.onopen = () => {
        setState("live");
        void client.invalidateQueries();
      };
      source.onerror = () => setState("offline");
      const handle = (raw: MessageEvent<string>) => {
        const ev = JSON.parse(raw.data) as LiveEvent;
        switch (ev.type) {
          case "entry.changed":
            void client.invalidateQueries({ queryKey: keys.entries(ev.projectId) });
            void client.invalidateQueries({ queryKey: keys.entry(ev.entryId) });
            void client.invalidateQueries({ queryKey: keys.projects });
            void client.invalidateQueries({ queryKey: keys.review });
            setFresh((s) => new Set(s).add(ev.entryId));
            break;
          case "project.changed":
          case "session.changed":
            void client.invalidateQueries({ queryKey: keys.projects });
            void client.invalidateQueries({ queryKey: keys.project(ev.projectId) });
            void client.invalidateQueries({ queryKey: keys.status });
            break;
          case "trajectory.changed":
            void client.invalidateQueries({ queryKey: keys.trajectory(ev.projectId) });
            void client.invalidateQueries({ queryKey: ["node"] });
            break;
          case "status.changed":
            void client.invalidateQueries({ queryKey: keys.status });
            void client.invalidateQueries({ queryKey: keys.links });
            break;
        }
      };
      for (const t of [
        "entry.changed",
        "project.changed",
        "session.changed",
        "status.changed",
        "trajectory.changed",
      ]) {
        source.addEventListener(t, handle);
      }
    });
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [client]);

  return { state, fresh };
}

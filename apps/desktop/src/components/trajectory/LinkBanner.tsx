import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { api } from "../../lib/api.ts";
import { keys, useLinkSuggestions } from "../../lib/queries.ts";
import { Button } from "../ui.tsx";

/**
 * When a repo's commits name stories from another project's plan, offer to
 * treat them as one project. Shown only on the projects involved.
 */
export function LinkBanner({ projectId }: { projectId: string | null }) {
  const client = useQueryClient();
  const { data = [] } = useLinkSuggestions();
  const s = data.find((x) => x.code.id === projectId || x.docs.id === projectId);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.links });
    void client.invalidateQueries({ queryKey: keys.projects });
  };
  const link = useMutation({
    mutationFn: () => api.link(s!.docs.id, s!.code.id),
    onSuccess: refresh,
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismissSuggestion(s!.code.id, s!.docs.id),
    onSuccess: refresh,
  });
  if (!s) return null;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{
        background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        borderBottom: "0.5px solid var(--separator)",
      }}
      role="region"
      aria-label="Link suggestion"
    >
      <Link2 size={15} style={{ color: "var(--accent)" }} aria-hidden />
      <p className="t-callout min-w-0 flex-1 truncate">
        <span className="font-medium">{s.code.name}</span> commits mention work from{" "}
        <span className="font-medium">{s.docs.name}</span>
        <span style={{ color: "var(--label-2)" }}> (“{s.sample}”). Track them as one project?</span>
      </p>
      <Button
        size="small"
        variant="plain"
        onClick={() => dismiss.mutate()}
        disabled={dismiss.isPending}
      >
        Not now
      </Button>
      <Button
        size="small"
        variant="primary"
        onClick={() => link.mutate()}
        disabled={link.isPending}
      >
        Link projects
      </Button>
    </div>
  );
}

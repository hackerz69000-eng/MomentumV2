import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/essay/")({
  head: () => ({
    meta: [
      { title: "Essay Grader — Momentum" },
      {
        name: "description",
        content:
          "Get detailed, honest feedback and an estimated grade on your essay, based on your rubric.",
      },
      { property: "og:title", content: "Essay Grader — Momentum" },
      { property: "og:description", content: "Detailed essay feedback and an estimated grade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EssayList,
});

function EssayList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["essays"],
    queryFn: async () =>
      (
        await supabase
          .from("essay_grades")
          .select("id, title, final_score, created_at")
          .order("created_at", { ascending: false })
      ).data ?? [],
  });
  const create = async () => {
    if (!user || creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("essay_grades")
      .insert({ user_id: user.id, title: "Untitled essay", essay: "" })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Couldn't start a new essay. Try again.");
      return;
    }
    navigate({ to: "/essay/$id", params: { id: data.id } });
  };
  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title="Essay Grader"
        sub="Grades are AI estimates based on what you provide — not your teacher's grade."
        right={
          <button onClick={create} disabled={creating} className={btnPrimary}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
            Grade an essay
          </button>
        }
      />
      <div className="p-5 md:p-8 max-w-3xl space-y-2">
        {q.isLoading && <Loader2 className="size-6 animate-spin text-cool2" />}
        {q.data?.length === 0 && <p className="text-sm text-soft">No essays yet.</p>}
        {q.data?.map((e) => (
          <Link
            key={e.id}
            to="/essay/$id"
            params={{ id: e.id }}
            className="flex justify-between gap-3 rounded-2xl bg-panel border border-line/70 p-4 hover:border-cool/50"
          >
            <span>
              <span className="font-semibold block">{e.title}</span>
              <span className="text-xs text-soft">
                {new Date(e.created_at).toLocaleDateString()}
              </span>
            </span>
            <span className="font-display text-2xl text-cool2">
              {e.final_score != null ? `${e.final_score}%` : "—"}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/assignment/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Assignment Helper — Momentum" },
      {
        name: "description",
        content:
          "Understand, brainstorm, outline and improve your own assignments with guided AI help.",
      },
      { property: "og:title", content: "Assignment Helper — Momentum" },
      {
        property: "og:description",
        content: "Guided help that teaches you to write your own assignment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssignmentList,
});

function AssignmentList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["assignments"],
    queryFn: async () =>
      (
        await supabase
          .from("assignments")
          .select("id, title, updated_at, instructions")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });
  const create = async () => {
    if (!user || creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("assignments")
      .insert({ user_id: user.id, title: "Untitled assignment" })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Couldn't create the assignment. Try again.");
      return;
    }
    navigate({ to: "/assignment/$id", params: { id: data.id } });
  };
  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title="Assignment Helper"
        sub="It guides your thinking — it won't write the assignment for you."
        right={
          <button onClick={create} disabled={creating} className={btnPrimary}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
            New assignment
          </button>
        }
      />
      <div className="p-5 md:p-8 max-w-3xl space-y-2">
        {q.isLoading && <Loader2 className="size-6 animate-spin text-cool2" />}
        {q.data?.length === 0 && (
          <p className="text-sm text-soft">
            No assignments yet. Start one and paste the instructions.
          </p>
        )}
        {q.data?.map((a) => (
          <Link
            key={a.id}
            to="/assignment/$id"
            params={{ id: a.id }}
            className="block rounded-2xl bg-panel border border-line/70 p-4 hover:border-cool/50"
          >
            <p className="font-semibold">{a.title}</p>
            <p className="text-xs text-soft truncate">
              {a.instructions.slice(0, 140) || "No instructions yet"} · updated{" "}
              {new Date(a.updated_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}

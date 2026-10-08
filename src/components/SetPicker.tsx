import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inputCls } from "@/components/set/ui";

/** Optional study-set link: its material grounds the AI's help. */
export function SetPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const q = useQuery({
    queryKey: ["set-names"],
    queryFn: async () =>
      (
        await supabase
          .from("study_sets")
          .select("id, name")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });
  return (
    <label className="block text-sm">
      <span className="eyebrow text-soft">Use material from a study set (optional)</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputCls + " w-full mt-1.5"}
      >
        <option value="">None</option>
        {q.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Field({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="eyebrow text-soft">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={inputCls + " w-full mt-1.5"}
      />
    </label>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Search, Save, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RPG_RANKS } from "@/components/Levels";
import { levelFromXp } from "@/lib/gamification";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin-progression")({ component: AdminProgressionPage });

function AdminProgressionPage() {
  const { user } = useAuth();
  const isAdmin = user?.app_metadata?.role === "admin";
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [xp, setXp] = useState("0");
  const [tier, setTier] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadUser() {
    if (!userId.trim()) { toast.error("Enter the user's Supabase UUID first."); return; }
    setBusy(true); setLoaded(false);
    try {
      const { data, error } = await supabase.rpc("admin_get_progression", { target_user_id: userId.trim() } as never);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("No matching account was found.");
      const record = row as { email?: string; xp?: number; tier_override?: number | null };
      setEmail(record.email ?? "Email unavailable"); setXp(String(record.xp ?? 0)); setTier(record.tier_override == null ? "auto" : String(record.tier_override)); setLoaded(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load progression. Apply the admin migration and confirm admin role."); }
    finally { setBusy(false); }
  }

  async function save() {
    const xpValue = Number(xp); const tierValue = tier === "auto" ? null : Number(tier);
    if (!Number.isSafeInteger(xpValue) || xpValue < 0 || xpValue > 1_000_000_000) { toast.error("XP must be a whole number from 0 to 1,000,000,000."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_set_progression", { target_user_id: userId.trim(), new_xp: xpValue, new_tier_override: tierValue } as never);
      if (error) throw error;
      toast.success("Progression saved. The user will see the changes after their next sync or refresh.");
      setLoaded(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save progression."); }
    finally { setBusy(false); }
  }

  if (!isAdmin) return <main className="flex-1 p-6 md:p-10"><div className="max-w-2xl mx-auto rounded-2xl border border-line bg-panel p-6"><AlertTriangle className="size-8 text-amber-400 mb-3"/><h1 className="text-2xl font-semibold">Admin access required</h1><p className="text-soft mt-2">This editor is restricted to accounts whose Supabase Auth app metadata contains <code>role: "admin"</code>. This check is also enforced by the database functions.</p></div></main>;

  return <main className="flex-1 p-5 md:p-10"><div className="max-w-3xl mx-auto space-y-6">
    <div><div className="flex items-center gap-2 text-cool2 text-sm font-semibold"><ShieldCheck className="size-4"/> ADMIN TOOLS</div><h1 className="text-3xl font-display font-bold mt-2">Progression Editor</h1><p className="text-soft mt-2">Adjust a learner's XP and optionally override their overall tier. Set tier to Automatic to return to mastery-based tiering.</p></div>
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6 space-y-4">
      <label className="block text-sm font-medium">User UUID <input value={userId} onChange={e=>{setUserId(e.target.value);setLoaded(false)}} placeholder="Paste the user's Supabase Auth ID" className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-3 font-mono text-sm outline-none focus:border-cool2" /></label>
      <button onClick={loadUser} disabled={busy || !userId.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cool/15 border border-cool/30 px-4 py-2.5 font-semibold disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin"/> : <Search className="size-4"/>} Load progression</button>
    </section>
    {loaded && <section className="rounded-2xl border border-line bg-panel p-5 md:p-6 space-y-5">
      <div><p className="text-xs uppercase tracking-wider text-soft">Account</p><p className="font-semibold mt-1">{email}</p><p className="font-mono text-xs text-soft break-all mt-1">{userId}</p></div>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="text-sm font-medium">Total XP<input type="number" min="0" max="1000000000" step="1" value={xp} onChange={e=>setXp(e.target.value)} className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-3 outline-none focus:border-cool2"/><span className="block text-xs text-soft mt-1">Calculated level: {levelFromXp(Number(xp) || 0)} / 100</span></label>
        <label className="text-sm font-medium">Overall tier<select value={tier} onChange={e=>setTier(e.target.value)} className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-3 outline-none focus:border-cool2"><option value="auto">Automatic (based on mastery)</option>{RPG_RANKS.map(rank=><option key={rank.tier} value={rank.tier}>Tier {rank.tier} — {rank.title}</option>)}</select><span className="block text-xs text-soft mt-1">Override affects overall tier badges, not set-specific tiers.</span></label>
      </div>
      <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand text-ink px-5 py-3 font-bold disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin"/> : <Save className="size-4"/>} Save progression</button>
    </section>}
    <p className="text-xs text-soft">Security: the database RPC checks the signed-in user's Supabase <code>app_metadata.role</code>. Do not use editable <code>user_metadata</code> for admin privileges.</p>
  </div></main>;
}

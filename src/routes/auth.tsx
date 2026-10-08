import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, UserCheck, KeyRound, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { signInLocal, signUpLocal, getLocalUsers } from "@/lib/local-auth";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Log in — Momentum" },
      {
        name: "description",
        content: "Sign in with your local account to start building AI study sets.",
      },
      { property: "og:title", content: "Log in — Momentum" },
      { property: "og:description", content: "Sign in to your Momentum study hub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const inputCls =
  "w-full bg-foreground/5 border border-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-cool2/80 transition-colors placeholder:text-soft/60";

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate({ to: "/dashboard" });
    }
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        const { user: newUser } = signUpLocal(username, password);
        toast.success(`Account created! Welcome, ${newUser.username}!`);
      } else {
        const { user: signedIn } = signInLocal(username, password);
        toast.success(`Welcome back, ${signedIn.username}!`);
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleQuickDemo = () => {
    try {
      const demoUser = "scholar";
      const demoPass = "pass123";
      const existing = getLocalUsers().find((u) => u.username === demoUser);
      if (!existing) {
        signUpLocal(demoUser, demoPass);
      } else {
        signInLocal(demoUser, demoPass);
      }
      toast.success("Signed in with Scholar demo account!");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demo sign in failed");
    }
  };

  return (
    <div className="min-h-screen bg-ink relative overflow-hidden grid place-items-center px-4 py-8">
      <div className="absolute -top-48 -left-24 w-[640px] h-[640px] rounded-full bg-cool/20 blur-[130px] pointer-events-none" />
      <div className="absolute -bottom-48 -right-24 w-[640px] h-[640px] rounded-full bg-mint/15 blur-[130px] pointer-events-none" />

      <div className="relative w-full max-w-sm rounded-2xl p-7 bg-ink2/90 border border-cool/30 shadow-2xl backdrop-blur-xl">
        <div className="mb-6">
          <BrandLogo />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-mint/10 text-mint border border-mint/20">
            <ShieldCheck className="size-3" /> Offline-Safe Local Auth
          </span>
        </div>

        <h1 className="font-display text-3xl font-bold uppercase">
          {mode === "in" ? "Welcome back" : "Create account"}
        </h1>
        <p className="text-sm text-soft mt-1 mb-6">
          {mode === "in"
            ? "Sign in with your saved username & password."
            : "Set up a local account saved directly in your browser."}
        </p>

        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-soft mb-1 flex items-center gap-1.5">
              <UserCheck className="size-3.5 text-cool2" /> Username
            </label>
            <input
              className={inputCls}
              type="text"
              required
              minLength={3}
              placeholder="e.g. alex_student"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-soft mb-1 flex items-center gap-1.5">
              <KeyRound className="size-3.5 text-cool2" /> Password
            </label>
            <input
              className={inputCls}
              type="password"
              required
              minLength={4}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
          </div>

          <button
            disabled={busy}
            type="submit"
            className="w-full mt-2 font-semibold text-sm bg-brand text-ink py-2.5 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-line/60">
          <button
            type="button"
            onClick={handleQuickDemo}
            className="w-full text-xs font-semibold bg-accent/80 hover:bg-accent text-foreground border border-line py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <Sparkles className="size-3.5 text-cool2" />
            Instant Demo Sign In
          </button>
        </div>

        <p className="text-sm text-soft mt-6 text-center">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <button
            className="text-cool2 font-semibold hover:underline"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

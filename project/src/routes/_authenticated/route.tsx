import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Gate,
  errorComponent: InShellError,
});

function InShellError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <AppShell>
      <main className="flex-1 grid place-items-center p-8">
        <div className="max-w-md text-center rounded-2xl bg-panel border border-line/70 p-6">
          <h1 className="font-display text-2xl">That didn't work</h1>
          <p className="text-sm text-soft mt-2">
            Your saved work is safe.{" "}
            {error instanceof Error && error.message && !error.message.startsWith("<")
              ? error.message
              : "Something went wrong loading this screen."}
          </p>
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="mt-4 rounded-lg bg-brand text-ink px-4 py-2 text-sm font-semibold"
          >
            Try again
          </button>
        </div>
      </main>
    </AppShell>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);
  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-ink">
        <Loader2 className="size-6 animate-spin text-cool2" />
      </div>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

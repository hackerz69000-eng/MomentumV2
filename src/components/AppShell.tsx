import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Compass,
  ClipboardList,
  History,
  Search,
  PenLine,
  FileCheck,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandLogo } from "@/components/BrandLogo";

export function Logo() {
  return (
    <Link to="/dashboard" aria-label="Momentum dashboard">
      <BrandLogo />
    </Link>
  );
}

const navCls =
  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-soft hover:bg-accent hover:text-foreground border border-transparent transition-colors";
const activeCls = "!bg-cool/15 !text-foreground !border-cool/30 font-semibold shadow-sm";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };
  return (
    <div className="min-h-screen bg-ink flex relative">
      <aside className="hidden md:flex w-[248px] shrink-0 h-screen sticky top-0 overflow-y-auto border-r border-line bg-ink2 flex-col p-4 z-10">
        <div className="px-2 py-2 mb-6">
          <Logo />
        </div>
        <nav className="flex flex-col gap-1">
          <Link to="/search" className={navCls} activeProps={{ className: activeCls }}>
            <Search className="size-4" /> Search
          </Link>
          <Link to="/dashboard" className={navCls} activeProps={{ className: activeCls }}>
            <LayoutDashboard className="size-4" /> Dashboard
          </Link>
          <Link to="/sets/new" className={navCls} activeProps={{ className: activeCls }}>
            <Plus className="size-4" /> New study set
          </Link>
          <Link to="/coach" className={navCls} activeProps={{ className: activeCls }}>
            <Compass className="size-4" /> Momentum Coach
          </Link>
          <Link to="/history" className={navCls} activeProps={{ className: activeCls }}>
            <History className="size-4" /> Study History
          </Link>
          <Link to="/exam" className={navCls} activeProps={{ className: activeCls }}>
            <ClipboardList className="size-4" /> Comprehensive Exam
          </Link>
          <Link to="/assignment" className={navCls} activeProps={{ className: activeCls }}>
            <PenLine className="size-4" /> Assignment Helper
          </Link>
          <Link to="/essay" className={navCls} activeProps={{ className: activeCls }}>
            <FileCheck className="size-4" /> Essay Grader
          </Link>
          <Link to="/trash" className={navCls} activeProps={{ className: activeCls }}>
            <Trash2 className="size-4" /> Recently Deleted
          </Link>
        </nav>
        <div className="mt-auto space-y-2 pt-6">
          <div className="rounded-lg p-3 bg-accent border border-line">
            <p className="eyebrow text-cool2 mb-1">Signed in</p>
            <p className="text-sm font-medium truncate">
              {user?.user_metadata?.username
                ? `@${user.user_metadata.username}`
                : user?.email}
            </p>
          </div>
          <button onClick={handleSignOut} className={navCls + " w-full"}>
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 relative flex flex-col">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-line/60 bg-ink2/80 backdrop-blur-xl sticky top-0 z-30">
          <Logo />
          <div className="flex items-center gap-1">
            <Link to="/search" className="p-2 rounded-lg border border-line/70" aria-label="Search">
              <Search className="size-4" />
            </Link>
            <Link
              to="/coach"
              className="p-2 rounded-lg border border-line/70"
              aria-label="Momentum Coach"
            >
              <Compass className="size-4" />
            </Link>
            <Link to="/sets/new" className="p-2 rounded-lg bg-brand text-ink" aria-label="New set">
              <Plus className="size-4" />
            </Link>
            <button onClick={handleSignOut} className="p-2 text-soft" aria-label="Log out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

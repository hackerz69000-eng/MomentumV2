import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { normalizeSupabaseUrl } from "./url";
import { supabase } from "./client";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);

    return fetch(input, { ...init, headers });
  };
}

export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    let token = session?.access_token;
    if (!token && typeof window !== "undefined") {
      const local = localStorage.getItem("momentum_active_user");
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (parsed.id) {
            token = `local_${parsed.id}_${encodeURIComponent(parsed.username || "student")}`;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!token) {
      throw new Error("Unauthorized: Please sign in again.");
    }

    return next({
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  })
  .server(async ({ next }) => {
    const SUPABASE_URL = normalizeSupabaseUrl(
      process.env["SUPABASE_URL"] || "https://placeholder-project.supabase.co",
    );
    const SUPABASE_PUBLISHABLE_KEY =
      process.env["SUPABASE_PUBLISHABLE_KEY"] ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.slice("Bearer ".length);

    if (!token) {
      throw new Error("Unauthorized: No token provided");
    }

    const supabaseServer = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    if (token.startsWith("local_")) {
      const parts = token.slice("local_".length).split("_");
      const userId = parts[0] || "local-user";
      return next({
        context: {
          supabase: supabaseServer,
          userId,
          claims: { sub: userId },
        },
      });
    }

    // Validate the access token with Supabase Auth itself. This avoids relying
    // on local JWT/JWKS claim verification and works with the current Supabase
    // publishable-key setup used by the browser client.
    const { data, error } = await supabaseServer.auth.getUser(token);

    if (error || !data.user?.id) {
      throw new Error("Unauthorized: Invalid token");
    }

    return next({
      context: {
        supabase: supabaseServer,
        userId: data.user.id,
        claims: { sub: data.user.id },
      },
    });
  });

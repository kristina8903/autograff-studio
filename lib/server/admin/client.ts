import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client with the SECRET key. It bypasses row-level security, so it
 * is only for the narrow operations that have no user session to act as:
 * inviting users, banning deactivated users, and (later) background jobs.
 *
 * ESLint only allows this module to be imported from `lib/server/admin/`.
 * Every exported operation there must call `requireAdmin()` itself first.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

import { createClient } from "@supabase/supabase-js";
import { getAppConfig } from "../core/appConfig.js";

let supabaseAdmin = null;

export function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const config = getAppConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseAdmin;
}

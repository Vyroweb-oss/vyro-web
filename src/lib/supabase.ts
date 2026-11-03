import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, sessionRemembered } from './supabaseEnv'
// P2-4: this module is loaded with dynamic import() from App.tsx only when
// auth is configured, so the Supabase SDK stays out of the initial bundle
// in Local Mode. The configured flag itself lives in supabaseEnv.ts (no SDK
// import) so App can render its Local/Free state without loading the SDK.
export { isSupabaseConfigured } from './supabaseEnv'
const url = import.meta.env.VITE_SUPABASE_URL as string|undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined
// "Remember me" routing: with the remember flag ON (default) the session
// lives in localStorage exactly as before (existing sessions keep working);
// with it OFF the session is written to sessionStorage instead, so closing
// the tab signs the user out. Reads check localStorage first, then
// sessionStorage; removal clears both.
const authStorage = {
  getItem: (k: string): string | null => {
    try { return localStorage.getItem(k) ?? sessionStorage.getItem(k) } catch { return null }
  },
  setItem: (k: string, v: string): void => {
    try { (sessionRemembered() ? localStorage : sessionStorage).setItem(k, v) } catch { /* storage unavailable */ }
  },
  removeItem: (k: string): void => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
    try { sessionStorage.removeItem(k) } catch { /* ignore */ }
  },
}
export const supabase: SupabaseClient|null = isSupabaseConfigured
  ? createClient(url!, key!, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } })
  : null

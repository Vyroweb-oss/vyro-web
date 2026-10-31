import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured } from './supabaseEnv'
// P2-4: this module is loaded with dynamic import() from App.tsx only when
// auth is configured, so the Supabase SDK stays out of the initial bundle
// in Local Mode. The configured flag itself lives in supabaseEnv.ts (no SDK
// import) so App can render its Local/Free state without loading the SDK.
export { isSupabaseConfigured } from './supabaseEnv'
const url = import.meta.env.VITE_SUPABASE_URL as string|undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined
export const supabase: SupabaseClient|null = isSupabaseConfigured ? createClient(url!, key!) : null

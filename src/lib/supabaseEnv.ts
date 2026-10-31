// Tiny auth-env check with NO dependency on @supabase/supabase-js (P2-4).
// App.tsx imports this statically for its Local/Free rendering, while the
// real Supabase client (supabase.ts) is loaded with dynamic import() only
// when auth is actually configured — so the Supabase SDK stays out of the
// initial bundle in Local Mode (the shipped default).
const url = import.meta.env.VITE_SUPABASE_URL as string|undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined
export const isSupabaseConfigured = !!(url && key)

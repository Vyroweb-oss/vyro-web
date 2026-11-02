// R2-I: the signed-in user's auto-generated username (public.profiles).
// The row is created server-side by the on_auth_user_created trigger at
// sign-up; the client only ever READS its own row (RLS policy
// profiles_select_own). A missing row — accounts created before the
// trigger existed, until an owner-approved backfill runs — or any read
// error yields null, and the UI simply omits the username line. Reading
// the profile never blocks sign-in, editing, or Local Mode.

export interface ProfileRow {
  username?: unknown
}

export interface ProfilesClientLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: ProfileRow | null; error: unknown }>
      }
    }
  }
}

export async function fetchOwnUsername(
  client: ProfilesClientLike,
  userId: string,
): Promise<string | null> {
  if (!userId) return null
  try {
    const { data, error } = await client
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) return null
    return typeof data.username === 'string' && data.username.length > 0
      ? data.username
      : null
  } catch {
    return null
  }
}

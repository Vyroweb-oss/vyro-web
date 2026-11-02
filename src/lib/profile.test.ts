import { describe, it, expect, vi } from 'vitest'
import { fetchOwnUsername, type ProfilesClientLike } from './profile'

function mockClient(
  result: { data: { username?: unknown } | null; error: unknown } | 'throw',
) {
  const maybeSingle = vi.fn(async () => {
    if (result === 'throw') throw new Error('network down')
    return result
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as ProfilesClientLike, from, select, eq, maybeSingle }
}

describe('fetchOwnUsername', () => {
  it('returns the username of the own profile row', async () => {
    const { client, from, select, eq } = mockClient({
      data: { username: 'user_ab12cd34' },
      error: null,
    })
    await expect(fetchOwnUsername(client, 'uid-1')).resolves.toBe('user_ab12cd34')
    expect(from).toHaveBeenCalledWith('profiles')
    expect(select).toHaveBeenCalledWith('username')
    expect(eq).toHaveBeenCalledWith('id', 'uid-1')
  })

  it('returns null when the account has no profile row yet', async () => {
    const { client } = mockClient({ data: null, error: null })
    await expect(fetchOwnUsername(client, 'uid-old')).resolves.toBeNull()
  })

  it('returns null on a read error instead of throwing into the UI', async () => {
    const { client } = mockClient({ data: null, error: { message: 'denied' } })
    await expect(fetchOwnUsername(client, 'uid-1')).resolves.toBeNull()
  })

  it('returns null when the request itself throws', async () => {
    const { client } = mockClient('throw')
    await expect(fetchOwnUsername(client, 'uid-1')).resolves.toBeNull()
  })

  it('returns null for an empty or non-string username value', async () => {
    const empty = mockClient({ data: { username: '' }, error: null })
    await expect(fetchOwnUsername(empty.client, 'uid-1')).resolves.toBeNull()
    const numeric = mockClient({ data: { username: 42 }, error: null })
    await expect(fetchOwnUsername(numeric.client, 'uid-1')).resolves.toBeNull()
  })

  it('never queries without a user id', async () => {
    const { client, from } = mockClient({ data: { username: 'user_x' }, error: null })
    await expect(fetchOwnUsername(client, '')).resolves.toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

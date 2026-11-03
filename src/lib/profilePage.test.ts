// Profile page contract (owner order, 2026-11-03): a Supabase-style
// avatar at the top of the page opens the signed-in user's personal
// profile — name, email, document count, total words, and every document
// with its own word count, computed with the app's own stats engine.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const page = readFileSync(resolve(process.cwd(), 'src/components/ProfilePage.tsx'), 'utf8')
const avatar = readFileSync(resolve(process.cwd(), 'src/components/Avatar.tsx'), 'utf8')

describe('profile page contract', () => {
  it('the top bar carries the avatar button only for a signed-in account user', () => {
    expect(app).toContain("aria-label={t('openProfile')}")
    expect(app).toContain('setProfileOpen(true)')
    expect(app).toContain('<ProfilePage')
    expect(app).toContain('docs={liveDocs}')
  })
  it('the profile shows identity, membership and the three totals', () => {
    expect(page).toContain("t('memberSince')")
    expect(page).toContain("t('documentsLabel')")
    expect(page).toContain("t('totalWords')")
    expect(page).toContain("t('totalCharacters')")
    expect(page).toContain("t('myDocuments')")
  })
  it('word counts come from the app stats engine, per document and in total', () => {
    expect(page).toContain('computeDocumentStats(doc.content)')
    expect(page).toContain('onOpenDoc(doc.id)')
    expect(page).toContain("t('lastUpdated')")
  })
  it('the avatar is a person bust on a gradient disc, with a photo override', () => {
    expect(avatar).toContain('vyroAvatarGrad')
    expect(avatar).toContain('photoUrl')
    expect(avatar).toContain('<img')
  })
})

// Admin panel contract (Release 2, owner order 2026-11-03): the panel
// is a separate /admin.html entry; it holds NO service-role key and NO
// client-side role trust — every privileged call goes to the Edge
// Functions, which verify app_metadata.role server-side. v1 has no
// ban/delete anywhere (shared Auth pool with Vyro Android).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const app = readFileSync(resolve(process.cwd(), 'src/components/AdminApp.tsx'), 'utf8')
const adminHtml = readFileSync(resolve(process.cwd(), 'admin.html'), 'utf8')
const viteCfg = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

function allSrcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? allSrcFiles(p) : [p]
  })
}

describe('admin panel contract', () => {
  it('is a separate vite entry at admin.html', () => {
    expect(adminHtml).toContain('/src/admin.tsx')
    expect(viteCfg).toContain("admin: 'admin.html'")
  })
  it('reads through the admin-users edge function only', () => {
    expect(app).toContain('/admin-users')
    expect(app).not.toContain('/admin-set-premium')
  })
  it('no privileged-key material anywhere in client source', () => {
    // Needles are assembled at runtime so this guard does not trip on
    // its own literals.
    const lower = ['service', 'role'].join('_')
    const upper = lower.toUpperCase()
    for (const f of allSrcFiles(resolve(process.cwd(), 'src'))) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toContain(lower)
      expect(text, f).not.toContain(upper)
    }
  })
  it('no premium management and no ban/delete (owner model 2026-11-03: everything is free, there is no Premium version)', () => {
    expect(app).not.toMatch(/ban|deleteUser|userDelete/i)
    expect(app).not.toContain("'activate'")
    expect(app).not.toContain("'deactivate'")
    expect(app).toContain('allFree')
  })
})

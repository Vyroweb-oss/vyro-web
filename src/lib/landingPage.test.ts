// Landing page + dashboard cleanup contract (owner orders, 2026-11-03):
// a first-time, signed-out visitor first sees the landing page — what
// Vyro is, its benefits, and a big "Get started" into sign-up — and the
// old sidebar (folders + profile/subscription card) is gone from the
// dashboard: profile lives behind the top-bar avatar, and the folder
// navigation survives as compact filter chips (nothing functional lost).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const landing = readFileSync(resolve(process.cwd(), 'src/components/LandingPage.tsx'), 'utf8')
const screen = readFileSync(resolve(process.cwd(), 'src/components/AuthScreen.tsx'), 'utf8')

describe('landing page + dashboard cleanup contract', () => {
  it('the landing shows for signed-out visitors only, before the dashboard', () => {
    expect(app).toContain('<LandingPage')
    expect(app).toContain('!user && isSupabaseConfigured && !landingSeen')
    expect(app).toContain("localStorage.getItem('vyro-web-landing-seen-v1')")
  })
  it('the landing defines Vyro and funnels into sign-up, sign-in, or local editing', () => {
    expect(landing).toContain("t('landingDef')")
    expect(landing).toContain("t('landingStart')")
    expect(landing).toContain("t('landingContinueLocal')")
    expect(landing).toContain('lp-scene')
    expect(landing).toContain("t('landingStepsTitle')")
    expect(landing).toContain('onLangChange')
    expect(landing).toContain("t('landingDesktopTipTitle')")
    expect(landing).toContain('lp-tip')
  })
  it('the old sidebar and its profile card are gone; filter chips carry the navigation', () => {
    expect(app).not.toContain('className="sidebar"')
    expect(app).not.toContain('profileSubscription')
    expect(app).toContain('filter-bar')
    expect(app).toContain("setView('trash')")
  })
  it('the auth page can open directly on the sign-in form', () => {
    expect(screen).toContain('initialView')
    expect(app).toContain("setAuthInitialView('signin')")
    expect(app).toContain('initialView={authInitialView}')
  })
})

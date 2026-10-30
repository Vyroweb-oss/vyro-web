import { useEffect, useRef, type RefObject } from 'react'
import { getFocusableElements, recordFocus, restoreFocus, trapTabKey } from '../lib/keyboard'

// Shared focus management (Mission 2, M2-15 = owner spec §17).
//
// useDialogFocus(open, …): for real dialogs — focus the first focusable
// element on open (unless the dialog focuses its own control, e.g. an
// autoFocus input), trap Tab/Shift+Tab inside, Esc closes, and focus
// returns to the opener on close (safely a no-op when the opener is
// gone). The onClose/opener values are read through refs so the effect
// runs ONLY on open/close — re-running it on every parent render would
// restore focus mid-dialog, which is exactly the bug this hook exists
// to prevent.
//
// usePanelFocusReturn(): for View-tab region panels — no focus steal on
// open (the panel must not yank focus out of the editor), just Esc (via
// the panel root's own onKeyDown, so only the focused panel closes) plus
// focus return on unmount. Panels mount when they open, so a mount-only
// effect records the opener correctly — except panels with an autoFocus
// control (Find & Replace), which take the opener as a prop captured by
// the editor before opening.

export interface DialogFocusOptions {
  containerRef: RefObject<Element | null>
  onClose: () => void
  autofocus?: boolean
  /** Focus the LAST focusable element instead (for dialogs whose primary
   *  action is the last button, e.g. image-preview Insert). */
  autofocusLast?: boolean
  trap?: boolean
  /** Opener captured by the caller before opening (needed when the dialog
   *  auto-focuses its own control, which would otherwise be recorded as
   *  its own opener). Defaults to document.activeElement at open time. */
  opener?: Element | null
}

export function useDialogFocus(open: boolean, options: DialogFocusOptions): void {
  const onCloseRef = useRef(options.onClose)
  onCloseRef.current = options.onClose
  const openerPropRef = useRef(options.opener)
  openerPropRef.current = options.opener
  const openerRef = useRef<Element | null>(null)
  const containerRef = options.containerRef
  const autofocus = options.autofocus ?? false
  const autofocusLast = options.autofocusLast ?? false
  const trap = options.trap ?? true

  useEffect(() => {
    if (!open) return
    openerRef.current = openerPropRef.current ?? recordFocus()
    const container = containerRef.current
    let raf = 0
    if ((autofocus || autofocusLast) && container) {
      raf = requestAnimationFrame(() => {
        const els = getFocusableElements(container)
        const el = autofocusLast ? els[els.length - 1] : els[0]
        el?.focus()
      })
    }
    // Element listeners receive plain Events; narrow to KeyboardEvent here
    // (the container is an Element, not an HTMLElement, in the types).
    const onKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'Escape') {
        ke.preventDefault()
        onCloseRef.current()
      } else if (ke.key === 'Tab' && trap && container) {
        trapTabKey(ke, container)
      }
    }
    container?.addEventListener('keydown', onKeyDown)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      container?.removeEventListener('keydown', onKeyDown)
      restoreFocus(openerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])
}

export function usePanelFocusReturn(opener?: Element | null): void {
  const openerRef = useRef<Element | null>(null)
  useEffect(() => {
    openerRef.current = opener ?? recordFocus()
    return () => {
      restoreFocus(openerRef.current)
    }
    // Mount-only by design: the panel mounts exactly when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

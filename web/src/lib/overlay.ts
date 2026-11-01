import { useEffect } from 'react'

/** While an overlay is open, the phone's Back button closes it instead of leaving the page underneath.
 * The overlay adds one browser history entry (with the same page depth, so the page stack is untouched). */
export function useBackToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    history.pushState({ depth: history.state?.depth ?? 0, overlay: true }, '')
    let closedByBack = false
    const onPop = () => {
      closedByBack = true
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!closedByBack) history.back() // closed by a button: drop the history entry we added
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

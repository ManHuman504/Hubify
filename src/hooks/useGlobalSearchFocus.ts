import { useEffect } from 'react'

export function useGlobalSearchFocus(inputRef: React.RefObject<HTMLInputElement>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't focus if user is already focused on an input/textarea
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return
      }

      // Ignore shortcuts (Ctrl, Alt, Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // If it's a printable character (length 1), focus the search input
      if (e.key.length === 1 && inputRef.current) {
        inputRef.current.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [inputRef])
}
import { useCallback, useState } from 'react'

// Shared by the SVG chart components: tracks the rendered width of a
// container so charts can size themselves without a fixed width. Lives in
// its own file because component files can only export components under
// react-refresh.
export function useMeasuredWidth(initial: number) {
  const [width, setWidth] = useState(initial)
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(node)
    setWidth(node.getBoundingClientRect().width || initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a constant default, not a reactive input
  }, [])
  return { width, measureRef }
}

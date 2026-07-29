import '@testing-library/jest-dom/vitest'

// jsdom ships no ResizeObserver; the deleverage-schedule charts measure their
// container width with one. A no-op stub keeps headless renders working (the
// charts just stay at their initial width).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

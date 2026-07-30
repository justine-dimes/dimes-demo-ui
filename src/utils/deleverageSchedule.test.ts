import { describe, expect, it } from 'vitest'
import { formatCentsUsd } from './deleverageSchedule'

describe('formatCentsUsd', () => {
  it.each([
    ['0.3600', '36¢'],
    ['0.4845', '48.5¢'],
    [0.275, '27.5¢'],
    [0.1264, '12.6¢'],
  ] as const)('formats %s as %s', (input, expected) => {
    expect(formatCentsUsd(input)).toBe(expected)
  })
})

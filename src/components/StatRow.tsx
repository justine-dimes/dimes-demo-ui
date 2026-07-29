export function StatRow({
  label,
  value,
  valueColor,
  previousValue,
  nested,
}: {
  label: string
  value: string
  valueColor?: string
  previousValue?: string
  nested?: boolean
}) {
  const changed = previousValue !== undefined && previousValue !== value
  const basePadLeft = nested ? 16 : 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '6px 0',
        borderLeft: changed ? '2px solid #F5A623' : '2px solid transparent',
        paddingLeft: changed ? basePadLeft + 8 : basePadLeft,
        transition: 'border-color 0.4s ease, padding-left 0.4s ease',
      }}
    >
      <span style={{ color: nested ? 'var(--text-dim)' : 'var(--text-muted)', fontSize: nested ? 12 : 13, whiteSpace: 'nowrap' }}>
        {nested ? `↳ ${label}` : label}
      </span>
      <div
        style={{
          flex: 1,
          borderBottom: '1px dotted rgba(255,255,255,0.1)',
          minWidth: 20,
          alignSelf: 'center',
          marginBottom: 2,
        }}
      />
      {changed && (
        <span
          className="stat-row-diff-in"
          style={{
            color: 'var(--text-dim)',
            fontSize: 12,
            fontWeight: 400,
            whiteSpace: 'nowrap',
            textDecoration: 'line-through',
          }}
        >
          {previousValue}
        </span>
      )}
      {changed && (
        <span className="stat-row-diff-in" style={{ color: 'var(--text-dim)', fontSize: 11, animationDelay: '60ms' }}>→</span>
      )}
      <span
        className={changed ? 'stat-row-diff-in' : undefined}
        style={{
          color: changed ? '#F5A623' : (valueColor || 'var(--text)'),
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          transition: 'color 0.3s ease',
          ...(changed ? { animationDelay: '120ms' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  )
}

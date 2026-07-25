export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="center" style={{ flexDirection: 'column', gap: 12 }}>
      <div style={{
        width: 32, height: 32,
        border: '3px solid var(--border)',
        borderTopColor: 'var(--primary)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <span style={{ color: 'var(--muted)', fontSize: 14 }}>{text}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

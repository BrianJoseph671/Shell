export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Gmail Open Tracker API</h1>
      <p style={{ color: "#666", margin: "0 0 16px" }}>
        The Magic Conch Shell backend is running. There is no web UI here — only API routes.
      </p>
      <ul style={{ lineHeight: 1.8, paddingLeft: 20 }}>
        <li>
          <code>/api/pixel?id=…</code> — tracking pixel (1×1 GIF)
        </li>
        <li>
          <code>/api/opens?ids=…</code> — open counts for the extension
        </li>
      </ul>
    </main>
  );
}

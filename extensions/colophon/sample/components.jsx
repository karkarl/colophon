// components.jsx — Pseudocode React that documents your UI patterns.
//
// These render live in the Design System canvas. Keep them small and honest:
// one component = one decision your team has already made. Style with the
// `ds-*` classes and CSS variables the design system generates from design.json
// (e.g. var(--color-accent), var(--space-4), var(--radius-md), var(--font-display)).
//
// Copilot reads this file to match the house style when it builds new UI.

// Primary action. One per view — it's where the eye should land.
export function Button({ children = "Save changes", variant = "primary" }) {
  return <button className={`ds-btn ds-btn-${variant}`}>{children}</button>;
}

// Text input with a label sitting above it. Labels are quiet; the field is the subject.
export function Field({ label = "Project name", placeholder = "Northlight" }) {
  return (
    <label className="ds-field">
      <span className="ds-field-label">{label}</span>
      <input className="ds-input" placeholder={placeholder} />
    </label>
  );
}

// Content card. Flat by default — a hairline border, not a drop shadow.
// Never nest a card inside another card.
export function Card({ title = "Weekly digest", body = "12 changes across 3 repos." }) {
  return (
    <article className="ds-card">
      <h3 className="ds-card-title">{title}</h3>
      <p className="ds-card-body">{body}</p>
      <a className="ds-link" href="#">Open report →</a>
    </article>
  );
}

// Status pill. Uses semantic color tokens, never a raw hex.
export function Badge({ children = "Live", tone = "positive" }) {
  return <span className={`ds-badge ds-badge-${tone}`}>{children}</span>;
}

// A representative screen composed from the pieces above. This is the
// "does it hang together" check for the whole system.
export function ExampleScreen() {
  return (
    <section className="ds-screen">
      <header className="ds-screen-head">
        <div>
          <p className="ds-eyebrow">Workspace</p>
          <h2 className="ds-screen-title">Good morning, Rowan</h2>
        </div>
        <Badge tone="positive">All systems normal</Badge>
      </header>

      <div className="ds-grid">
        <Card title="Deploys" body="3 shipped today. Last one 20 minutes ago." />
        <Card title="Review queue" body="2 PRs waiting on you." />
      </div>

      <div className="ds-row">
        <Field label="Invite a teammate" placeholder="name@company.com" />
        <Button>Send invite</Button>
      </div>
    </section>
  );
}

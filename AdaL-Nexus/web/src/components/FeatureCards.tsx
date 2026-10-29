import { BoltIcon, FileSpreadsheetIcon, ShieldIcon, SlidersIcon } from "./Icons";

export function FeatureCards() {
  return (
    <section className="feature-cards-grid" aria-label="Key Capabilities">
      <article className="glass-card feature-card">
        <div className="feature-icon-badge badge-violet">
          <BoltIcon size={22} />
        </div>
        <div className="feature-content">
          <h2 className="feature-title">Fast</h2>
          <p className="feature-desc">
            Streamlined research execution through controlled Playwright browser automation.
          </p>
        </div>
      </article>

      <article className="glass-card feature-card">
        <div className="feature-icon-badge badge-cyan">
          <ShieldIcon size={22} />
        </div>
        <div className="feature-content">
          <h2 className="feature-title">Evidence-Backed</h2>
          <p className="feature-desc">
            Extracted facts are linked to verbatim page quotes and cited source URLs.
          </p>
        </div>
      </article>

      <article className="glass-card feature-card">
        <div className="feature-icon-badge badge-indigo">
          <SlidersIcon size={22} />
        </div>
        <div className="feature-content">
          <h2 className="feature-title">Controlled</h2>
          <p className="feature-desc">
            Explicit policy gates protect sensitive actions; pause, resume, or cancel at any step.
          </p>
        </div>
      </article>

      <article className="glass-card feature-card">
        <div className="feature-icon-badge badge-purple">
          <FileSpreadsheetIcon size={22} />
        </div>
        <div className="feature-content">
          <h2 className="feature-title">Exportable</h2>
          <p className="feature-desc">
            Builds formatted Excel spreadsheets with offline file-integrity verification.
          </p>
        </div>
      </article>
    </section>
  );
}

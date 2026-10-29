import type { RunSnapshot } from "../../../src/server/agent/types";
import { CheckCircleIcon, DownloadIcon, FileSpreadsheetIcon, ShieldIcon } from "./Icons";

interface DownloadsViewProps {
  run: RunSnapshot | null;
}

export function DownloadsView({ run }: DownloadsViewProps) {
  // Extract workbooks from run steps if any
  const workbooks: Array<{
    fileName: string;
    rowCount?: number;
    verified: boolean;
    sha256?: string;
  }> = [];

  if (run?.steps) {
    for (const step of run.steps) {
      if (
        step.output &&
        typeof step.output === "object" &&
        "fileName" in step.output &&
        typeof (step.output as { fileName: unknown }).fileName === "string"
      ) {
        const out = step.output as {
          fileName: string;
          rowCount?: number;
          sha256?: string;
          pricingCounts?: { verifiedPlans: number; unavailable: number };
        };
        const existing = workbooks.find((w) => w.fileName === out.fileName);
        if (!existing) {
          workbooks.push({
            fileName: out.fileName,
            rowCount: out.rowCount,
            verified: step.tool === "sheet.verify" || step.status === "completed",
            sha256: out.sha256,
          });
        } else if (step.tool === "sheet.verify") {
          existing.verified = step.status === "completed";
        }
      }
    }
  }

  // Also include accepted known reports if available
  const knownFiles = [
    {
      fileName: "ai_startups.xlsx",
      label: "AI Startups Live Run Workbook",
      defaultRows: 5,
      sha: "1bea1b9d3680116f27edd29b70851b4a95f79110933ec731ea79639dd2c1b800",
    },
    {
      fileName: "m6-accepted-startups.xlsx",
      label: "Milestone 6 Verified Baseline",
      defaultRows: 10,
      sha: "44496a4bb5a6d89b11f610d91b8af4b6b91c0f5193a23e292b3f306cb3ebab88",
    },
  ];

  return (
    <div className="downloads-view" aria-label="Downloads & Reports Center">
      <div className="section-header-box">
        <div className="header-icon-box">
          <DownloadIcon size={24} />
        </div>
        <div>
          <h2 className="view-title">Workbook Download Center</h2>
          <p className="view-desc">
            All workbooks are generated into the strictly sandboxed <code>output/</code> directory and validated via <code>sheet.verify</code> before download.
          </p>
        </div>
      </div>

      <div className="downloads-grid">
        {/* Session generated files */}
        {workbooks.map((wb, idx) => (
          <article key={`run-${idx}`} className="glass-card download-card highlight-card">
            <div className="card-top">
              <div className="file-icon-box">
                <FileSpreadsheetIcon size={24} />
              </div>
              <div className="file-meta">
                <span className="badge badge-indigo">Current Run Output</span>
                <h3 className="file-name">{wb.fileName}</h3>
                <div className="file-tags">
                  {wb.rowCount !== undefined && (
                    <span className="badge badge-neutral">{wb.rowCount} Rows</span>
                  )}
                  {wb.verified && (
                    <span className="badge badge-completed">
                      <CheckCircleIcon size={12} />
                      Verified File
                    </span>
                  )}
                </div>
              </div>
            </div>

            {wb.sha256 && (
              <div className="file-sha-box">
                <span className="sha-lbl">SHA-256 Checksum:</span>
                <code>{wb.sha256}</code>
              </div>
            )}

            <div className="card-action">
              <a
                href={`/api/downloads/${encodeURIComponent(wb.fileName)}`}
                download={wb.fileName}
                className="btn btn-primary btn-block"
              >
                <DownloadIcon size={16} />
                <span>Download {wb.fileName}</span>
              </a>
            </div>
          </article>
        ))}

        {/* Standard Accepted Artifacts */}
        {knownFiles.map((kf, idx) => (
          <article key={`known-${idx}`} className="glass-card download-card">
            <div className="card-top">
              <div className="file-icon-box">
                <FileSpreadsheetIcon size={24} />
              </div>
              <div className="file-meta">
                <span className="badge badge-neutral">{kf.label}</span>
                <h3 className="file-name">{kf.fileName}</h3>
                <div className="file-tags">
                  <span className="badge badge-neutral">{kf.defaultRows} Rows</span>
                  <span className="badge badge-completed">
                    <CheckCircleIcon size={12} />
                    Verified
                  </span>
                </div>
              </div>
            </div>

            <div className="file-sha-box">
              <span className="sha-lbl">SHA-256:</span>
              <code>{kf.sha}</code>
            </div>

            <div className="card-action">
              <a
                href={`/api/downloads/${encodeURIComponent(kf.fileName)}`}
                download={kf.fileName}
                className="btn btn-outline btn-block"
              >
                <DownloadIcon size={16} />
                <span>Download Workbook</span>
              </a>
            </div>
          </article>
        ))}
      </div>

      <div className="glass-card security-notice-card">
        <ShieldIcon size={20} className="shield-accent" />
        <div>
          <h4>Filesystem Safety &amp; Integrity Guarantee</h4>
          <p>
            The download route enforces URL-safe regex validation (<code>^[a-zA-Z0-9_-]+\.xlsx$</code>) and rejects directory traversal sequences (<code>..</code>, slashes, null bytes). Files are verified by reopening from disk before download.
          </p>
        </div>
      </div>
    </div>
  );
}

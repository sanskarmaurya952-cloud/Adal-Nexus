import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Logic mirrored from googleDriveService for server-side verification and testing */
function checkMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

function sanitizeErrorMessage(err: unknown): string {
  if (!err) return "Unknown Google Drive error";
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/AIza[a-zA-Z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
}

describe("Google Drive Security — Asset Validation & Token Redaction", () => {
  it("validates JPEG magic bytes", () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(checkMagicBytes(jpegHeader), true);
  });

  it("validates PNG magic bytes", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(checkMagicBytes(pngHeader), true);
  });

  it("validates WebP magic bytes", () => {
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // file size
      0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);
    assert.equal(checkMagicBytes(webpHeader), true);
  });

  it("rejects non-image or executable files", () => {
    const elfHeader = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF
    assert.equal(checkMagicBytes(elfHeader), false);

    const htmlHeader = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43]); // "<!DOC"
    assert.equal(checkMagicBytes(htmlHeader), false);

    const empty = new Uint8Array([]);
    assert.equal(checkMagicBytes(empty), false);
  });

  it("redacts Google OAuth tokens (ya29.*) from error messages", () => {
    const rawError = "Request failed with token ya29.a0AfH6SMDh123456789_abcdefGhIjkLmNoP on resource";
    const sanitized = sanitizeErrorMessage(rawError);
    assert.ok(!sanitized.includes("ya29.a0AfH6"));
    assert.ok(sanitized.includes("[REDACTED_TOKEN]"));
  });

  it("redacts Google API keys (AIza*) from error messages", () => {
    const rawError = "Invalid developer key AIzaSyD9876543210_abcdef provided for picker";
    const sanitized = sanitizeErrorMessage(rawError);
    assert.ok(!sanitized.includes("AIzaSyD98765"));
    assert.ok(sanitized.includes("[REDACTED_API_KEY]"));
  });

  it("redacts Bearer Authorization headers", () => {
    const rawError = "Authorization: Bearer secret_access_token_value_xyz failed with 401";
    const sanitized = sanitizeErrorMessage(rawError);
    assert.ok(!sanitized.includes("secret_access_token_value_xyz"));
    assert.ok(sanitized.includes("Bearer [REDACTED]"));
  });

  it("preserves safe error context", () => {
    const rawError = "File size exceeds 10 MB limit (12.45 MB). Please select a smaller image.";
    const sanitized = sanitizeErrorMessage(rawError);
    assert.equal(sanitized, rawError);
  });
});

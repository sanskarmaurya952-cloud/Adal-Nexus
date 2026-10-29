import fs from "node:fs";
import path from "node:path";
import type { ValidateImageRequest, ValidateImageResponse } from "./types.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Checks magic bytes of common web image formats:
 * - JPEG: FF D8 FF
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
 */
export function validateImageMagicBytes(buffer: Buffer): { valid: boolean; detectedMime?: string } {
  if (!buffer || buffer.length < 3) {
    return { valid: false };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, detectedMime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, detectedMime: "image/png" };
  }

  // WebP: RIFF ... WEBP
  if (buffer.length >= 12) {
    const isRiff = buffer.toString("ascii", 0, 4) === "RIFF";
    const isWebp = buffer.toString("ascii", 8, 12) === "WEBP";
    if (isRiff && isWebp) {
      return { valid: true, detectedMime: "image/webp" };
    }
  }

  return { valid: false };
}

export async function validateUserImage(req: ValidateImageRequest): Promise<ValidateImageResponse> {
  let buffer: Buffer | null = null;
  let fileName = req.fileName || "image.png";
  let mimeType = req.mimeType || "image/png";

  if (req.fileSize && req.fileSize > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      fileName,
      mimeType,
      fileSize: req.fileSize,
      error: `Image file exceeds maximum allowed size of 10MB (${(req.fileSize / 1024 / 1024).toFixed(2)}MB).`,
    };
  }

  // Case 1: Local file path on disk
  if (req.filePath) {
    if (req.filePath.includes("\0") || req.filePath.includes("..\\..") || req.filePath.includes("../..")) {
      return {
        valid: false,
        fileName,
        mimeType,
        fileSize: 0,
        error: `Invalid file path or potential path traversal: ${req.filePath}`,
      };
    }

    const resolved = path.resolve(req.filePath);
    if (!fs.existsSync(resolved)) {
      return {
        valid: false,
        fileName,
        mimeType,
        fileSize: 0,
        error: `File not found at specified path: ${req.filePath}`,
      };
    }

    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return {
        valid: false,
        fileName,
        mimeType,
        fileSize: 0,
        error: `Specified path is not a file: ${req.filePath}`,
      };
    }

    if (stat.size > MAX_IMAGE_BYTES) {
      return {
        valid: false,
        fileName,
        mimeType,
        fileSize: stat.size,
        error: `Image file exceeds maximum allowed size of 10MB (${(stat.size / 1024 / 1024).toFixed(2)}MB).`,
      };
    }

    buffer = await fs.promises.readFile(resolved);
    fileName = path.basename(resolved);
  } else if (req.base64Data) {
    // Case 2: In-memory base64 data
    const cleanB64 = req.base64Data.replace(/^data:[^;]+;base64,/, "");
    buffer = Buffer.from(cleanB64, "base64");
    if (buffer.length > MAX_IMAGE_BYTES) {
      return {
        valid: false,
        fileName,
        mimeType,
        fileSize: buffer.length,
        error: `Image exceeds maximum allowed size of 10MB (${(buffer.length / 1024 / 1024).toFixed(2)}MB).`,
      };
    }
  } else {
    return {
      valid: false,
      fileName,
      mimeType,
      fileSize: 0,
      error: "No image source provided. Must specify either filePath or base64Data.",
    };
  }

  // Validate magic bytes
  const magicCheck = validateImageMagicBytes(buffer);
  if (!magicCheck.valid) {
    return {
      valid: false,
      fileName,
      mimeType,
      fileSize: buffer.length,
      error: "Invalid image format. Supported formats are JPEG (.jpg, .jpeg), PNG (.png), and WebP (.webp).",
    };
  }

  const detectedMime = magicCheck.detectedMime || mimeType;

  return {
    valid: true,
    fileName,
    mimeType: detectedMime,
    fileSize: buffer.length,
    base64Data: buffer.toString("base64"),
  };
}

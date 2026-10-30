/**
 * Resolves an API URL to either relative (if on localhost:3001)
 * or explicit http://127.0.0.1:3001 if running directly from file:// protocol,
 * custom protocol, or dev server (e.g. localhost:5173).
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined") {
    // If running in packaged electron with file:// origin or similar custom protocol,
    // or if running on a different port than 3001 (e.g. Vite on 5173)
    if (window.location.protocol === "file:" || !window.location.host || window.location.port !== "3001") {
      return `http://127.0.0.1:3001${cleanPath}`;
    }
  }
  return cleanPath;
}

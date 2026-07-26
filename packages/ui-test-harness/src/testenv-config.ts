export const DEFAULT_RELAY_URL = "http://127.0.0.1:8787/";

/**
 * OpenChamber is served from its production build on a pinned port. 43163 is
 * the only port a full acceptance run has been validated against. The Vite dev
 * port is deliberately not the default: acceptance forbids treating an HMR
 * build as a diagnostic gate.
 */
export const DEFAULT_OPENCHAMBER_URL = "http://127.0.0.1:43163/";

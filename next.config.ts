import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * GitHub Pages serves a project site from a subpath (/<repo>/), so assets need
 * a prefix there. Left empty for local dev and for any host serving from root.
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Everything runs client-side against the visitor's own key, so there is
  // nothing for a server to do. Exporting static files makes that structural
  // rather than a promise: the deployed artifact has no backend to hold a
  // secret, log a prompt, or be breached.
  output: "export",
  basePath,

  // Without this, Next walks up and finds an unrelated lockfile in the home
  // directory, picks that as the workspace root, and traces the wrong files.
  outputFileTracingRoot: here,
};

export default nextConfig;

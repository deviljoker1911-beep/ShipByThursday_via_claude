import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Without this, Next walks up and finds an unrelated lockfile in the home
  // directory, picks that as the workspace root, and traces the wrong files.
  outputFileTracingRoot: here,
};

export default nextConfig;

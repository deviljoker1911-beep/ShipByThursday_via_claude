import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Galaxy — a room of AI colleagues who disagree",
  description:
    "A working session with a room of AI teammates who search, run code, read repos, and hand work to each other. Runs entirely in your browser on your own API key.",
  openGraph: {
    title: "Galaxy — a room of AI colleagues who disagree",
    description:
      "A working session with a room of AI teammates. Your browser, your key, no server.",
    type: "website",
  },
};

/**
 * This page holds the visitor's API key in local storage, which makes the
 * exfiltration surface the thing worth defending. `connect-src` is the
 * directive that matters: even if something hostile got onto the page, the
 * browser will refuse to send the key anywhere except Anthropic and GitHub.
 *
 * Next's hydration needs inline scripts and Tailwind emits inline styles, so
 * those stay permitted — but no external origin can load a script at all.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.anthropic.com https://api.github.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

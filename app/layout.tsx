import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Emberhold — a small real-time strategy game",
  description:
    "Gather, build, train, fight. An original isometric RTS that runs in the browser on desktop and mobile, and installs as an app.",
  manifest: "manifest.webmanifest",
  openGraph: {
    title: "Emberhold",
    description: "Gather, build, train, fight. A small RTS in your browser.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#14120f",
  width: "device-width",
  initialScale: 1,
  // A strategy game needs both thumbs on the controls; pinch-zoom on the page
  // itself would fight the in-game camera zoom.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Everything runs locally in the browser — no network calls at all once the
 * page has loaded — so the policy can be as tight as it gets.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
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
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}

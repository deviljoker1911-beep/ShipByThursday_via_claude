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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

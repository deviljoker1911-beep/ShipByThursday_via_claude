import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shipped — read the story in any repo",
  description:
    "Paste a public GitHub repository and get the story of how it was actually built, reconstructed from its commit history.",
  openGraph: {
    title: "Shipped — read the story in any repo",
    description:
      "Paste a public GitHub repository and get the story of how it was actually built.",
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

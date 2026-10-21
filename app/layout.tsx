import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Content Studio", template: "%s · Content Studio" },
  description: "Autograff Content Studio",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request: the CSP nonce set in proxy.ts must reach
  // Next's scripts, and a prerendered page would carry none (and be blocked).
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

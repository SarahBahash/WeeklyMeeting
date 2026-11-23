import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "IA Weekly Meeting Hub",
  description: "Internal Audit action-point tracker and Sunday meeting system",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // every page is rendered per request so the CSP nonce applies
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-navy">{children}</body>
    </html>
  );
}

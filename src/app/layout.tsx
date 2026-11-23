import type { Metadata } from "next";
import { headers } from "next/headers";
import { demoMode } from "@/lib/config";
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
      <body className="min-h-screen bg-white font-sans text-navy">
        {demoMode && (
          <div role="status" className="border-b border-warn/30 bg-warn-light px-4 py-1.5 text-center text-xs font-semibold text-warn">
            TEST ENVIRONMENT – synthetic data only. Do not enter or upload real Internal Audit information.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}

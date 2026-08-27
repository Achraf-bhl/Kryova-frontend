import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";

import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kryova — Structural Simulation",
  description: "Upload CAD, define loads, and solve FEA in the browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { AuthProvider } from "@/lib/auth-context";

import "./globals.css";

/**
 * Three typefaces, three jobs — see the type block in `globals.css`.
 *
 * The variable names end in `-src` on purpose. `globals.css` composes each
 * token as `--font-sans: var(--font-sans-src), "Inter", …`; if next/font wrote
 * straight into `--font-sans` that declaration would reference itself, resolve
 * to nothing, and every fallback in the stack would be lost with it.
 */
const display = Space_Grotesk({
  variable: "--font-display-src",
  subsets: ["latin"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-sans-src",
  subsets: ["latin"],
  display: "swap",
});

/** Every number that carries a unit — mm, N, MPa, kg, element counts, ids. */
const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kryova — AI-native CAD and simulation",
  description: "Describe a part, build it in CATIA, run the analysis, read the stress.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

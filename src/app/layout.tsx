import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { AuthProvider } from "@/lib/auth-context";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/catalogue";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
  other: {
    "kryova-build": process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The language is decided on the server — the cookie if the user chose, else what the
  // browser asked for — so `<html lang>` and first paint are right with no flash of English.
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return (
    <html
      lang={locale}
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
      // The init script sets `data-theme` before hydration for an explicit choice, which is
      // a deliberate difference from the server's markup.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}

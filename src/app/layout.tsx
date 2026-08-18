import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { CursorProvider } from "@/components/providers/cursor-provider";
import { SmoothScrollProvider } from "@/components/providers/smooth-scroll-provider";
import { ThemeProvider, ThemeScript } from "@/components/providers/theme-provider";
import { PRODUCT_NAME, VIRTUAL_MONEY_NOTICE } from "@/domain/constants";

import "./globals.css";

/*
  Geist Sans for text, Geist Mono for every financial figure.

  Self-hosted through the `geist` package rather than fetched from Google, so
  there is no third-party request on first paint and no FOUT. The pair is
  designed together, which matters here: a price in Geist Mono sits on the same
  vertical rhythm as its Geist Sans label instead of fighting it.
*/

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} — Paper trading & market simulation`,
    template: `%s — ${PRODUCT_NAME}`,
  },
  description:
    "A paper-trading and market-simulation platform. Practise the market, build conditional strategies and study your decisions with up to ₹10,00,000 in virtual capital. No real money, no real orders.",
  applicationName: PRODUCT_NAME,
  other: { "paper-trading-disclosure": VIRTUAL_MONEY_NOTICE },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="grain antialiased">
        <ThemeProvider>
          <SmoothScrollProvider>
            <CursorProvider>{children}</CursorProvider>
          </SmoothScrollProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

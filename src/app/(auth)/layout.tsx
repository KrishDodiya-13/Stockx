import Link from "next/link";

import { AuthAside } from "@/components/auth/auth-aside";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * Sign-in shell.
 *
 * Deliberately outside the app shell: no navigation, no market data, nothing to
 * click but the form. A sign-in screen that surrounds itself with the product
 * invites people to try clicking into it before they have an account.
 *
 * Two columns from `lg` up — the brand and a market visual on the left, the
 * form on the right — collapsing to the form alone below that. The aside is
 * dropped rather than stacked on a phone: it carries no information the visitor
 * needs, and pushing the form below a decorative panel would make signing in on
 * a phone start with a scroll.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  /*
    `h-dvh` rather than `min-h-dvh` on the desktop grid.

    With a minimum, the row grew to whatever the form needed, the aside
    stretched to match, and its bottom-aligned figures were pushed below the
    fold — visible only if you scrolled a page that otherwise does not scroll.
    Fixing the row to the viewport keeps the aside a complete composition and
    moves any overflow into the form column, which is the half that should
    scroll.
  */
  return (
    <div className="grain min-h-dvh bg-base lg:grid lg:h-dvh lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.25fr_1fr]">
      <AuthAside />

      <div className="flex min-h-dvh flex-col lg:min-h-0 lg:overflow-y-auto">
        {/* The wordmark lives in the aside on desktop; this is its mobile home. */}
        <header className="flex items-center justify-between px-6 py-7 lg:hidden">
          <Link href="/" className="text-[0.9375rem] transition-opacity hover:opacity-70">
            <Wordmark />
          </Link>
          <span className="eyebrow text-ink-tertiary">Paper trading</span>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-16 pt-2 sm:px-10 lg:py-16">
          {children}
        </main>
      </div>
    </div>
  );
}

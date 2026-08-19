"use client";

import { cn } from "@/lib/cn";

/**
 * "Continue with Google", and the divider above it.
 *
 * ── Why this is a link, not a fetch ────────────────────────────────────────
 *
 * OAuth begins with a full-page navigation to Google, so this has to leave the
 * site rather than call an endpoint in the background. It is an anchor styled
 * like the `secondary` button variant rather than a `Button` with an onClick,
 * so it works before hydration and behaves like the link it is — middle-click,
 * open in new tab, the lot.
 *
 * The `next` path is passed through to the start route, which validates it
 * with `safeNextPath` before storing it. It is not trusted here.
 */
export function GoogleButton({
  next,
  className,
}: {
  next?: string;
  className?: string;
}) {
  const href = next
    ? `/api/auth/google/login?next=${encodeURIComponent(next)}`
    : "/api/auth/google/login";

  return (
    <a
      href={href}
      className={cn(
        // The `secondary` variant's shape and behaviour, matched deliberately
        // rather than imported: `ButtonLink` renders a Next `Link`, which would
        // try to client-navigate to a route handler that only redirects.
        "group relative inline-flex h-14 w-full items-center justify-center gap-3 rounded-full px-8",
        "border border-line-strong text-[0.9375rem] font-medium text-ink",
        "transition-[background-color,color,border-color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "hover:border-ink hover:bg-ink hover:text-ink-inverse",
        "focus-visible:outline-2 focus-visible:outline-offset-3 active:scale-[0.985]",
        className,
      )}
    >
      <GoogleMark />
      Continue with Google
    </a>
  );
}

/**
 * Google's mark, in its own colours.
 *
 * Kept full-colour on purpose. Google's brand guidelines require the logo be
 * shown as-is on a sign-in button, and it is also the one place in this
 * otherwise monochrome interface where colour carries meaning: it says
 * unmistakably which provider this is.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-[1.125rem] shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * The "OR" rule between the password form and the provider button.
 *
 * A hairline with the word set into it — the same hairline weight used
 * everywhere else in the product, not a heavier divider invented for this
 * screen.
 */
export function AuthDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)} aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="text-[0.6875rem] tracking-[0.14em] text-ink-tertiary uppercase">or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

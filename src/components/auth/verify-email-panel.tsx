"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = "working" | "verified" | "failed" | "missing";

/**
 * The confirmation panel.
 *
 * Posts the token on mount rather than having the server spend it during the
 * render, so a link scanner fetching the page cannot confirm an address on the
 * owner's behalf. The visible result is the same either way; the difference is
 * that a real browser running real JavaScript is what completes it.
 *
 * On failure it offers a resend rather than an apology, because "expired" is
 * the failure people actually hit and re-sending is the only thing that fixes
 * it.
 */
export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? "working" : "missing");
  const [message, setMessage] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  /*
    React runs effects twice in development's strict mode. The second call
    would find the token already spent and report failure for a verification
    that had just succeeded, so the request is fired once per mount.
  */
  const requested = useRef(false);

  useEffect(() => {
    if (!token || requested.current) return;
    requested.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        if (cancelled) return;

        setMessage(payload.message ?? null);
        setState(response.ok ? "verified" : "failed");
      } catch {
        if (!cancelled) {
          setMessage("Could not reach the server.");
          setState("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function resend() {
    if (resending) return;

    setResending(true);
    setResendNotice(null);

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      setResendNotice(
        payload.message ?? "If that address needs confirming, a new link is on its way.",
      );
    } catch {
      setResendNotice("Could not reach the server.");
    } finally {
      setResending(false);
    }
  }

  const disclaimer = (
    <p className="mt-10 border-t border-line-subtle pt-6 text-[0.6875rem] leading-relaxed text-ink-tertiary">
      STOCKX is a paper-trading simulator. All balances, orders and P&amp;L are virtual.
    </p>
  );

  if (state === "working") {
    return (
      <div className="w-full max-w-[26rem]">
        <span className="eyebrow text-ink-tertiary">Confirming</span>
        <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
          Checking your link…
        </h1>
        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
          One moment while we confirm your email address.
        </p>
      </div>
    );
  }

  if (state === "verified") {
    return (
      <div className="w-full max-w-[26rem]">
        <span className="eyebrow text-ink-tertiary">Email confirmed</span>

        <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
          You&rsquo;re verified
        </h1>

        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
          {message ?? "Your email address is confirmed. You can sign in now."}
        </p>

        <Link
          href="/signin"
          className="group relative mt-8 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full border border-transparent bg-ink px-8 text-[0.9375rem] font-medium text-ink-inverse transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-ink/88 active:scale-[0.985]"
        >
          Sign in
          <span
            aria-hidden
            className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1"
          >
            →
          </span>
        </Link>

        {disclaimer}
      </div>
    );
  }

  // `failed` and `missing` share a panel: both mean "this link will not work,
  // here is how to get one that does".
  return (
    <div className="w-full max-w-[26rem]">
      <span className="eyebrow text-ink-tertiary">Link expired</span>

      <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
        This link no longer works
      </h1>

      <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
        {message ??
          "Confirmation links expire after 24 hours and can only be used once. Enter your email and we will send a new one."}
      </p>

      <div className="mt-8">
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {resendNotice ? (
        <p className="mt-6 text-[0.8125rem] text-ink-secondary" role="status">
          {resendNotice}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="mt-8 w-full"
        disabled={resending || email.length === 0}
        onClick={resend}
      >
        {resending ? "Sending…" : "Send a new link"}
      </Button>

      <p className="mt-6 text-[0.8125rem] text-ink-secondary">
        <Link
          href="/signin"
          className="text-ink underline-offset-4 transition-opacity duration-200 hover:opacity-70 hover:underline"
        >
          Back to sign in
        </Link>
      </p>

      {disclaimer}
    </div>
  );
}

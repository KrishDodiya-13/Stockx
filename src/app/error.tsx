"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with the real reporter when observability lands.
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <main className="gutter flex min-h-[100svh] flex-col justify-center">
      <p className="eyebrow">Error</p>
      <h1 className="mt-6 text-display-m">Something broke on our side.</h1>
      <p className="mt-6 max-w-md text-base text-ink-secondary">
        No positions or balances were affected — this build holds no real money and places no real
        orders. Try again, or head back to the overview.
      </p>
      {error.digest ? (
        <p className="tabular mt-4 text-xs text-ink-tertiary">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-10 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Back to overview
        </ButtonLink>
      </div>
    </main>
  );
}

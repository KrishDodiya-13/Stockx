"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mirrors `validatePassword` on the server. That one is the rule; this is feedback. */
const MIN_PASSWORD_LENGTH = 10;
const OTP_LENGTH = 6;

type Step = "email" | "code" | "password" | "done";

/**
 * Password reset, in three steps on one page.
 *
 * `email → code → new password → done`, each replacing the last rather than
 * navigating, so the address and the code survive between steps without ever
 * being put in the URL. A code in a query string ends up in browser history,
 * in the `Referer` header of anything the page loads, and in server access
 * logs — which is most of the reasons a code exists at all, undone.
 *
 * Built from the same pieces as `AuthForm` — same `Input`, same `Button`, same
 * eyebrow-heading-paragraph rhythm — so it reads as another view of the
 * sign-in screen rather than a page bolted on beside it.
 *
 * ── The success state of step one is not a confirmation ────────────────────
 *
 * It says "if an account exists", because the server genuinely does not tell
 * this component whether one does. Wording it as "check your inbox" would be a
 * claim the response cannot support, and would hand anyone with the form a way
 * to test whether an address is registered here.
 */
export function ForgotPasswordForm() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; payload: { message?: string; error?: string } }> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return { ok: response.ok, payload };
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    const { ok, payload } = await post("/api/auth/forgot-password", { email }).catch(() => ({
      ok: false,
      payload: { message: "Could not reach the server." } as { message?: string; error?: string },
    }));

    if (!ok) {
      setError(payload.message ?? "Could not send that code.");
      setPending(false);
      return;
    }

    setNotice(payload.message ?? null);
    setStep("code");
    setPending(false);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (code.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code from your email.`);
      return;
    }

    setPending(true);
    setError(null);

    const { ok, payload } = await post("/api/auth/verify-otp", { email, code }).catch(() => ({
      ok: false,
      payload: { message: "Could not reach the server." } as { message?: string; error?: string },
    }));

    if (!ok) {
      setError(payload.message ?? "That code is not correct.");
      setPending(false);
      return;
    }

    setNotice(null);
    setStep("password");
    setPending(false);
  }

  async function setNewPassword(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    // Immediate feedback only. The server re-runs both of these.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError("Those passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);

    const { ok, payload } = await post("/api/auth/reset-password", {
      email,
      code,
      password,
    }).catch(() => ({
      ok: false,
      payload: { message: "Could not reach the server." } as { message?: string; error?: string },
    }));

    if (!ok) {
      setError(payload.message ?? "Could not reset your password.");
      // The code died — expired, spent, or too many wrong guesses. There is
      // nothing to type that would revive it, so send them back to step one.
      if (payload.error && payload.error !== "weak") {
        setCode("");
        setStep("code");
      }
      setPending(false);
      return;
    }

    // Clear both secrets from state before rendering anything else.
    setPassword("");
    setConfirmation("");
    setCode("");
    setStep("done");
    setPending(false);
  }

  const arrow = (
    <span
      aria-hidden
      className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1"
    >
      →
    </span>
  );

  const backToSignIn = (
    <p className="mt-6 text-[0.8125rem] text-ink-secondary">
      <Link
        href="/signin"
        className="text-ink underline-offset-4 transition-opacity duration-200 hover:opacity-70 hover:underline"
      >
        Back to sign in
      </Link>
    </p>
  );

  const disclaimer = (
    <p className="mt-10 border-t border-line-subtle pt-6 text-[0.6875rem] leading-relaxed text-ink-tertiary">
      STOCKX will never email you asking for your password. All balances, orders and P&amp;L are
      virtual.
    </p>
  );

  const errorLine = error ? (
    <p className="mt-6 text-[0.8125rem] text-down" role="alert">
      {error}
    </p>
  ) : null;

  // --- step four: finished -------------------------------------------------

  if (step === "done") {
    return (
      <div className="w-full max-w-[26rem]">
        <span className="eyebrow text-ink-tertiary">Password changed</span>

        <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
          You&rsquo;re all set
        </h1>

        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
          Your password has been updated. For safety, any other devices that were signed in have
          been signed out.
        </p>

        <Button
          type="button"
          size="lg"
          className="group mt-8 w-full"
          onClick={() => router.push("/signin")}
        >
          Sign in
          {arrow}
        </Button>

        {disclaimer}
      </div>
    );
  }

  // --- step three: the new password ---------------------------------------

  if (step === "password") {
    return (
      <form onSubmit={setNewPassword} className="w-full max-w-[26rem]" noValidate>
        <span className="eyebrow text-ink-tertiary">Password reset</span>

        <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
          Choose a new password
        </h1>

        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
          Code confirmed. Pick something you have not used elsewhere — signing in everywhere else
          will require the new password.
        </p>

        <div className="mt-9 space-y-5">
          <Input
            label="New password"
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={`Minimum ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`}
          />

          <Input
            label="Confirm new password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Type it again"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            error={
              confirmation.length > 0 && confirmation !== password
                ? "Those passwords do not match."
                : undefined
            }
          />
        </div>

        {errorLine}

        <Button type="submit" size="lg" className="group mt-8 w-full" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
          {pending ? null : arrow}
        </Button>

        {backToSignIn}
        {disclaimer}
      </form>
    );
  }

  // --- step two: the code --------------------------------------------------

  if (step === "code") {
    return (
      <form onSubmit={verifyCode} className="w-full max-w-[26rem]" noValidate>
        <span className="eyebrow text-ink-tertiary">Password reset</span>

        <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
          Enter your code
        </h1>

        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
          {notice ?? `If an account exists for ${email}, a ${OTP_LENGTH}-digit code is on its way.`}
        </p>

        <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-tertiary">
          The code expires in 10 minutes and stops working after a few incorrect attempts.
        </p>

        <div className="mt-9">
          <Input
            label="Six-digit code"
            type="text"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={OTP_LENGTH}
            placeholder="000000"
            value={code}
            // Digits only, so a pasted code with a stray space still works.
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
            }
            className="tabular text-center text-[1.5rem] tracking-[0.5em]"
          />
        </div>

        {errorLine}

        <Button type="submit" size="lg" className="group mt-8 w-full" disabled={pending}>
          {pending ? "Checking…" : "Verify code"}
          {pending ? null : arrow}
        </Button>

        <p className="mt-6 text-[0.8125rem] text-ink-secondary">
          Didn&rsquo;t get it?{" "}
          <button
            type="button"
            className="cursor-pointer text-ink underline-offset-4 transition-opacity duration-200 hover:opacity-70 hover:underline"
            onClick={() => {
              setCode("");
              setError(null);
              setNotice(null);
              setStep("email");
            }}
          >
            Send another code
          </button>
        </p>

        {backToSignIn}
        {disclaimer}
      </form>
    );
  }

  // --- step one: the address -----------------------------------------------

  return (
    <form onSubmit={requestCode} className="w-full max-w-[26rem]" noValidate>
      <span className="eyebrow text-ink-tertiary">Password reset</span>

      <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
        Forgot your password?
      </h1>

      <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
        Enter the email address on your account and we will send a {OTP_LENGTH}-digit code to reset
        it.
      </p>

      <div className="mt-9">
        <Input
          label="Email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {errorLine}

      <Button type="submit" size="lg" className="group mt-8 w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset code"}
        {pending ? null : arrow}
      </Button>

      <p className="mt-6 text-[0.8125rem] text-ink-secondary">
        Remembered it?{" "}
        <Link
          href="/signin"
          className="text-ink underline-offset-4 transition-opacity duration-200 hover:opacity-70 hover:underline"
        >
          Back to sign in
        </Link>
      </p>

      {disclaimer}
    </form>
  );
}

import "server-only";

/**
 * Outbound transactional email.
 *
 * ── Why this shape ─────────────────────────────────────────────────────────
 *
 * The project had no email infrastructure at all before password reset needed
 * one, so this is the first of it: a single `sendEmail` seam with one provider
 * behind it. Callers describe the message; nothing above this module knows
 * which vendor sends it, which is what makes swapping Resend for SES later a
 * change to one file.
 *
 * Resend is reached over its REST API with `fetch` rather than through its SDK,
 * matching how this codebase already talks to Upstox: one documented endpoint,
 * no dependency added to a trading app for a single POST.
 *
 * ── Failure is not an exception here ───────────────────────────────────────
 *
 * `sendEmail` returns a result rather than throwing. A password-reset route
 * must return the same generic response whether or not the address exists, and
 * a 500 leaking out of the mail provider would announce "this address is real,
 * we tried to mail it" — the precise thing the generic response exists to
 * hide. Callers decide what to do; none of them may vary their response.
 *
 * ── What is never written to a log ─────────────────────────────────────────
 *
 * No message body, no reset URL, no token. Diagnostics carry the provider's
 * status and its error identifier only. A reset link in an aggregated log is a
 * password reset waiting for whoever can read it.
 */

import { serverEnv } from "@/config/env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** A hung provider must not hold a request open. */
const SEND_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /** Plain-text alternative. Always send one; some clients render only this. */
  readonly text: string;
}

export type SendEmailResult =
  | { readonly ok: true }
  /**
   * `reason` is for the server's own diagnostics and is never surfaced to the
   * caller of an auth route.
   *
   * `unconfigured` is called out separately from a genuine failure because it
   * is the expected state of a fresh checkout, and reads very differently in a
   * log: one is "nobody has set RESEND_API_KEY", the other is "the provider
   * rejected us".
   */
  | { readonly ok: false; readonly reason: "unconfigured" | "failed" };

/**
 * Send one transactional email.
 *
 * Returns `unconfigured` rather than throwing when no provider is set up, so
 * local development and CI — where no API key exists — exercise every path
 * except the network call itself.
 */
export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const apiKey = serverEnv.resendApiKey;
  const from = serverEnv.emailFrom;

  if (!apiKey || !from) {
    console.warn(
      "[email] not sent: RESEND_API_KEY and EMAIL_FROM are not both configured.",
    );
    return { ok: false, reason: "unconfigured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      /*
        The provider's error name only — never the body, which echoes the
        recipient address back, and never the message we tried to send.
      */
      const detail = await response
        .json()
        .then((body: unknown) =>
          body && typeof body === "object" && "name" in body ? String(body.name) : "unknown",
        )
        .catch(() => "unreadable");

      console.error(`[email] provider rejected the message (${response.status}: ${detail})`);
      return { ok: false, reason: "failed" };
    }

    return { ok: true };
  } catch (error) {
    // The error is logged by class, not by message: a fetch error can carry
    // the full request URL, and this one has an Authorization header on it.
    console.error(
      `[email] send failed (${error instanceof Error ? error.name : "unknown error"})`,
    );
    return { ok: false, reason: "failed" };
  }
}

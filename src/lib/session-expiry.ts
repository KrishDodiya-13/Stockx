"use client";

/**
 * What the browser does when a request comes back 401.
 *
 * The server-side gate in `(app)/layout.tsx` means a signed-out visitor never
 * reaches these pages in the first place. A 401 from a fetch therefore means one
 * thing: the session ended *while* the page was open — it expired, or it was
 * signed out in another tab.
 *
 * The honest response is to send them to sign in, not to paint a bespoke
 * "unauthorized" panel on fourteen separate surfaces. Every page already has an
 * error state; what it does not have is a way back, and this is it.
 */

let redirecting = false;

/**
 * Returns true when the response was a 401 and a redirect has been started, so
 * the caller can stop without also flashing an error message.
 *
 * The module-level latch matters: several hooks poll at once, and without it an
 * expiring session fires a redirect per in-flight request.
 */
export function handleSessionExpiry(response: Response): boolean {
  if (response.status !== 401) return false;
  if (redirecting) return true;

  redirecting = true;

  // `replace`, not `assign`: the expired page should not sit in history behind
  // the sign-in screen waiting for a back button.
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/signin?next=${next}`);

  return true;
}

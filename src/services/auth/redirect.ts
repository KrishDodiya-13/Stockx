/**
 * Post-sign-in redirect validation.
 *
 * `?next=` arrives from the URL bar, so it is attacker-controlled. A sign-in
 * page that forwards to an arbitrary host after a successful login is a
 * ready-made phishing step: the victim really did sign in, really did see the
 * genuine form, and lands somewhere chosen by whoever sent the link.
 *
 * So the rule is narrow on purpose — a single leading slash, no scheme, no
 * backslash (which some browsers normalise to `/`), no protocol-relative `//`.
 * Anything else falls back to the default landing page.
 */
export function safeNextPath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("/")) return undefined;
  if (raw.startsWith("//")) return undefined;
  if (raw.includes("\\")) return undefined;
  if (raw.includes(":")) return undefined;

  // Control characters — a newline especially — can split a URL or smuggle a
  // header. Checked by code point rather than a regex escape, which is easy to
  // get subtly wrong and invisible in the source when you do.
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return undefined;
  }

  return raw;
}

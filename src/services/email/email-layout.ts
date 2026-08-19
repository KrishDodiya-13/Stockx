import { PRODUCT_NAME } from "@/domain/constants";

/**
 * Shared chrome for transactional email.
 *
 * ── Written as tables, on purpose ──────────────────────────────────────────
 *
 * Email clients are not browsers. Outlook renders through Word, Gmail strips
 * `<style>` blocks in some contexts, and flexbox is unreliable across the set.
 * So this is inline styles on tables — the boring construction that actually
 * arrives looking the same everywhere — rather than the Tailwind the app uses.
 * The palette and type are lifted from the product's own tokens so it still
 * reads as STOCKX.
 *
 * Extracted here once the second template arrived: the brand mark, the frame
 * and the footer are identical in both, and two copies would have drifted the
 * first time the palette moved.
 */

/** Lifted from `globals.css` — the dark theme's surface and ink. */
export const COLOURS = {
  background: "#09090a",
  surface: "#121214",
  ink: "#f4f3f0",
  inkSecondary: "#96948f",
  inkTertiary: "#7c7a75",
  line: "#26262a",
  accent: "#d4a65e",
} as const;

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface EmailShellOptions {
  /** Document title and, by default, the visible heading. */
  readonly title: string;
  /** The grey line shown beside the subject in most inboxes. */
  readonly preheader: string;
  readonly heading: string;
  /** The paragraph under the heading. */
  readonly intro: string;
  /** The distinctive middle — a button, or a code. */
  readonly bodyHtml: string;
  /** The small print above the standing footer. */
  readonly noticeHtml: string;
}

export function renderEmailShell({
  title,
  preheader,
  heading,
  intro,
  bodyHtml,
  noticeHtml,
}: EmailShellOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLOURS.background};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background-color:${COLOURS.background};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:520px;background-color:${COLOURS.surface};border:1px solid ${COLOURS.line};border-radius:4px;">

            <tr>
              <td style="padding:32px 32px 0 32px;">
                <!-- The brand mark: three bars at unequal heights, as in the app. -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="width:3px;height:12px;background-color:${COLOURS.accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
                          <td style="width:3px;font-size:0;line-height:0;">&nbsp;</td>
                          <td style="width:3px;height:18px;background-color:${COLOURS.accent};opacity:0.45;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
                          <td style="width:3px;font-size:0;line-height:0;">&nbsp;</td>
                          <td style="width:3px;height:9px;background-color:${COLOURS.accent};opacity:0.7;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
                        </tr>
                      </table>
                    </td>
                    <td style="vertical-align:middle;font-family:${FONT_STACK};font-size:15px;font-weight:600;letter-spacing:-0.015em;color:${COLOURS.ink};">
                      ${PRODUCT_NAME}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 0 32px;font-family:${FONT_STACK};">
                <h1 style="margin:0;font-size:22px;line-height:1.25;letter-spacing:-0.02em;font-weight:600;color:${COLOURS.ink};">
                  ${escapeHtml(heading)}
                </h1>
                <p style="margin:16px 0 0 0;font-size:14px;line-height:1.6;color:${COLOURS.inkSecondary};">
                  ${escapeHtml(intro)}
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 0 32px;">
${bodyHtml}
              </td>
            </tr>

            <tr>
              <td style="padding:26px 32px 32px 32px;">
                <div style="border-top:1px solid ${COLOURS.line};padding-top:20px;font-family:${FONT_STACK};">
${noticeHtml}
                  <p style="margin:14px 0 0 0;font-size:11px;line-height:1.6;color:${COLOURS.inkTertiary};">
                    ${PRODUCT_NAME} is a paper-trading simulator. All balances, orders and P&amp;L are
                    virtual. ${PRODUCT_NAME} will never email you asking for your password.
                  </p>
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Escape a value being interpolated into an HTML body.
 *
 * Every value these templates receive is built by this application today, so
 * none is attacker-controlled. Escaped anyway: the day any of it becomes
 * user-supplied — a display name in a greeting, a configurable origin — this is
 * the line that stops it becoming an HTML injection into everyone's inbox.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The standing footer used by both templates, above the product disclaimer. */
export function ignoreNotice(action: string): string {
  return `                  <p style="margin:0;font-size:12px;line-height:1.6;color:${COLOURS.inkTertiary};">
                    <strong style="color:${COLOURS.inkSecondary};">Didn't ask for this?</strong>
                    You can ignore this email — ${escapeHtml(action)} Nobody else was told whether
                    this address has an account.
                  </p>`;
}

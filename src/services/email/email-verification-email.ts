import { PRODUCT_NAME } from "@/domain/constants";
import {
  COLOURS,
  FONT_STACK,
  escapeHtml,
  ignoreNotice,
  renderEmailShell,
} from "@/services/email/email-layout";
import type { EmailMessage } from "@/services/email/send-email";

/**
 * The address-verification email.
 *
 * ── Why this one is a link, when the reset is a code ───────────────────────
 *
 * They are answering different questions. A reset code has to be usable on
 * whichever device the user is sitting at, because they are already locked out
 * and may be resetting on a desktop while the mail lands on a phone. A
 * verification link is opened once, on whatever device is holding the inbox,
 * and nothing depends on it working elsewhere — so the one-tap option is the
 * right one, and it can carry a 256-bit secret instead of six digits.
 */

export interface VerificationEmailOptions {
  readonly to: string;
  /** The full, absolute verification URL including the token. */
  readonly verifyUrl: string;
  /** How long the link remains valid, already worded for a human. */
  readonly expiresInLabel: string;
}

export function buildVerificationEmail({
  to,
  verifyUrl,
  expiresInLabel,
}: VerificationEmailOptions): EmailMessage {
  const safeUrl = escapeHtml(verifyUrl);

  const bodyHtml = `                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:${COLOURS.ink};border-radius:999px;">
                      <a href="${safeUrl}"
                         style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${COLOURS.background};text-decoration:none;">
                        Verify my email
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${COLOURS.inkSecondary};">
                  This link expires in <strong style="color:${COLOURS.ink};">${escapeHtml(expiresInLabel)}</strong>
                  and can be used once.
                </p>
                <p style="margin:16px 0 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLOURS.inkTertiary};">
                  If the button does not work, paste this address into your browser:
                </p>
                <p style="margin:8px 0 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;word-break:break-all;">
                  <a href="${safeUrl}" style="color:${COLOURS.accent};text-decoration:underline;">${safeUrl}</a>
                </p>`;

  const html = renderEmailShell({
    title: `Verify your ${PRODUCT_NAME} email`,
    preheader: `Confirm your email address to finish setting up ${PRODUCT_NAME}. Expires in ${expiresInLabel}.`,
    heading: "Confirm your email",
    intro: `Your ${PRODUCT_NAME} paper-trading account is ready. Confirm this address to sign in for the first time.`,
    bodyHtml,
    noticeHtml: ignoreNotice("no account will be usable at this address until it is confirmed."),
  });

  const text = [
    `Confirm your ${PRODUCT_NAME} email`,
    "",
    `Your ${PRODUCT_NAME} paper-trading account is ready. Confirm this address to`,
    "sign in for the first time:",
    "",
    verifyUrl,
    "",
    `This link expires in ${expiresInLabel} and can be used once.`,
    "",
    "Didn't ask for this? You can ignore this email — no account will be usable",
    "at this address until it is confirmed.",
    "",
    `${PRODUCT_NAME} is a paper-trading simulator. All balances, orders and P&L are virtual.`,
    `${PRODUCT_NAME} will never email you asking for your password.`,
  ].join("\n");

  return {
    to,
    subject: `Confirm your ${PRODUCT_NAME} email`,
    html,
    text,
  };
}

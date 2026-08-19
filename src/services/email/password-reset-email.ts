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
 * The password-reset email, carrying a one-time code.
 *
 * ── Why a code and not a button ────────────────────────────────────────────
 *
 * A link would be fewer steps, but it only works in the client that received
 * it: someone resetting on a desktop while the email lands on a phone has to
 * forward it to themselves, and a forwarded reset link is a reset link in
 * somebody else's inbox. A code is read once and typed wherever the user
 * already is, and the flow it belongs to caps how many times it can be
 * guessed.
 *
 * The code is rendered as text, spaced for reading. Not as an image — images
 * are blocked by default in most clients, and a code nobody can see is a
 * support ticket.
 */

export interface PasswordResetOtpEmailOptions {
  readonly to: string;
  /** The six-digit code. Never logged, never stored — this is its only home. */
  readonly code: string;
  /** How long the code remains valid, already worded for a human. */
  readonly expiresInLabel: string;
}

export function buildPasswordResetOtpEmail({
  to,
  code,
  expiresInLabel,
}: PasswordResetOtpEmailOptions): EmailMessage {
  const safeCode = escapeHtml(code);

  const bodyHtml = `                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center"
                        style="background-color:${COLOURS.background};border:1px solid ${COLOURS.line};border-radius:4px;padding:22px 16px;">
                      <div style="font-family:${FONT_STACK};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${COLOURS.inkTertiary};">
                        Your reset code
                      </div>
                      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:0.32em;color:${COLOURS.ink};padding-top:10px;">
                        ${safeCode}
                      </div>
                    </td>
                  </tr>
                </table>

                <p style="margin:22px 0 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${COLOURS.inkSecondary};">
                  Enter this code on the password reset page. It expires in
                  <strong style="color:${COLOURS.ink};">${escapeHtml(expiresInLabel)}</strong>,
                  can be used once, and stops working after a few incorrect attempts.
                </p>`;

  const html = renderEmailShell({
    title: `Your ${PRODUCT_NAME} password reset code`,
    preheader: `Your password reset code is ${code}. It expires in ${expiresInLabel}.`,
    heading: "Reset your password",
    intro: `We received a request to reset the password for this ${PRODUCT_NAME} account. Use the code below to choose a new one.`,
    bodyHtml,
    noticeHtml: ignoreNotice("your password will not change unless the code above is used."),
  });

  const text = [
    `Reset your ${PRODUCT_NAME} password`,
    "",
    `We received a request to reset the password for this ${PRODUCT_NAME} account.`,
    "Enter this code on the password reset page:",
    "",
    `    ${code}`,
    "",
    `It expires in ${expiresInLabel}, can be used once, and stops working after a`,
    "few incorrect attempts.",
    "",
    "Didn't ask for this? You can ignore this email — your password will not",
    "change unless the code above is used.",
    "",
    `${PRODUCT_NAME} is a paper-trading simulator. All balances, orders and P&L are virtual.`,
    `${PRODUCT_NAME} will never email you asking for your password.`,
  ].join("\n");

  return {
    to,
    subject: `Your ${PRODUCT_NAME} password reset code`,
    html,
    text,
  };
}

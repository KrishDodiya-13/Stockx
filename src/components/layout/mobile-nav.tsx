"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { NavIcon } from "@/components/layout/nav-icon";
import { MOBILE_NAV, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/cn";

/**
 * Mobile bottom navigation.
 *
 * Four destinations plus a raised Trade action in the centre — this is a
 * thumb-first layout, not the desktop sidebar rotated. The bar sits above the
 * home indicator via `env(safe-area-inset-bottom)`.
 */
export function MobileNav({ onTrade }: { onTrade: () => void }) {
  const pathname = usePathname();

  const left = MOBILE_NAV.slice(0, 2);
  const right = MOBILE_NAV.slice(2);

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line-subtle lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 items-end">
        {left.map((item) => (
          <MobileLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onTrade}
            aria-label="Open trade ticket"
            className="mb-2 flex size-12 -translate-y-3 items-center justify-center rounded-full bg-ink text-ink-inverse shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95"
          >
            <svg viewBox="0 0 20 20" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M10 4.5v11M4.5 10h11" />
            </svg>
          </button>
        </div>

        {right.map((item) => (
          <MobileLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}
      </div>
    </nav>
  );
}

function MobileLink({
  item,
  active,
}: {
  item: (typeof MOBILE_NAV)[number];
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center gap-1.5 py-3 text-[0.625rem] tracking-[0.02em] transition-colors duration-200",
        active ? "text-ink" : "text-ink-tertiary",
      )}
    >
      {active ? (
        <motion.span
          layoutId="mobile-active"
          className="absolute inset-x-4 top-0 h-px bg-ink"
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      ) : null}
      <NavIcon name={item.icon} className="size-5" />
      <span className="max-w-full truncate px-1">{shortLabel(item.label)}</span>
    </Link>
  );
}

/**
 * The bar has ~4rem per cell; long labels are shortened, not truncated.
 *
 * "Settings" becomes "Profile" here because on mobile this tab is where the
 * account lives, and a one-word noun scans faster in a 4rem cell than a
 * category name.
 */
function shortLabel(label: string): string {
  if (label === "Market Pulse") return "Markets";
  if (label === "Dashboard") return "Home";
  if (label === "Settings") return "Profile";
  return label;
}

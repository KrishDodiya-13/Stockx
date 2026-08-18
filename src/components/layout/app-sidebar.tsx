"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { NavIcon } from "@/components/layout/nav-icon";
import { useCommandPalette } from "@/components/command/command-palette-provider";
import { NAV_GROUPS, SETTINGS_ITEM, isActivePath } from "@/config/navigation";
import { Wordmark } from "@/components/layout/wordmark";
import { cn } from "@/lib/cn";

/**
 * Desktop sidebar.
 *
 * Collapse is intentionally not offered: at 14rem the labels cost little, and
 * an icon-only rail forces users to decode glyphs on every visit. The screen
 * area is better spent making the labels quiet than removing them.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { open } = useCommandPalette();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line-subtle bg-base lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" className="text-[0.9375rem]">
          <Wordmark />
        </Link>
      </div>

      <button
        type="button"
        onClick={() => open()}
        className="mx-3 flex h-9 items-center justify-between gap-2 rounded-sm border border-line px-3 text-left text-[0.8125rem] text-ink-tertiary transition-colors duration-200 hover:border-line-strong hover:text-ink-secondary"
      >
        Search…
        <kbd className="tabular rounded-[3px] border border-line px-1.5 py-0.5 text-[0.625rem]">
          ⌘K
        </kbd>
      </button>

      <nav className="mt-6 flex-1 overflow-y-auto px-3 pb-6" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-6">
            <p className="eyebrow px-3 pb-2.5">{group.label}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <SidebarLink item={item} active={isActivePath(pathname, item.href)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line-subtle p-3">
        <SidebarLink item={SETTINGS_ITEM} active={isActivePath(pathname, SETTINGS_ITEM.href)} />
        <p className="px-3 pt-4 pb-1 text-[0.625rem] leading-relaxed text-ink-tertiary">
          Paper trading · Virtual money
        </p>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
}: {
  item: (typeof NAV_GROUPS)[number]["items"][number];
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      title={item.description}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-sm px-3 py-2 text-[0.875rem] transition-colors duration-200",
        active ? "text-ink" : "text-ink-secondary hover:text-ink",
      )}
    >
      {active ? (
        // One shared element slides between destinations, so the sidebar reads
        // as a single indicator moving rather than blocks toggling.
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-sm bg-ink/6"
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        />
      ) : null}
      <span className="relative flex items-center gap-3">
        <NavIcon name={item.icon} className={cn(active ? "opacity-100" : "opacity-60")} />
        {item.label}
      </span>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/layout/wordmark";
import { ButtonLink } from "@/components/ui/button";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/cn";
import { ensureGsap, respectMotion } from "@/lib/animation/gsap-core";
import { DURATION, EASE } from "@/lib/animation/motion-tokens";

const NAV = [
  { label: "Market Pulse", href: "#market" },
  { label: "Strategies", href: "#strategy" },
  { label: "Risk", href: "#risk" },
  { label: "Time Machine", href: "#time-machine" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const brandRef = useRef<HTMLAnchorElement>(null);

  /*
    The brand lands first, then the hero badge, then the headline.

    Animated with `fromTo` rather than the `[data-animate]` CSS convention used
    elsewhere. That convention hides an element in CSS and relies on JavaScript
    to bring it back, which is precisely how every masked headline on this site
    ended up permanently invisible. A `fromTo` sets its own start state at
    runtime, so if GSAP never runs the wordmark is simply there — the brand is
    the last thing that should be able to disappear.

    Timing is by delay rather than a shared timeline because the header and the
    hero are separate components mounted independently; coupling them would
    couple their lifecycles for no visual gain. The hero opens on
    `HERO_BADGE_DELAY`, which is this reveal's duration.
  */
  useEffect(() => {
    const brand = brandRef.current;
    if (!brand) return;

    return respectMotion(brand, (context) => {
      context.add(() => {
        ensureGsap().fromTo(
          brand,
          { opacity: 0, y: -6 },
          { opacity: 1, y: 0, duration: DURATION.slow, ease: EASE.out },
        );
      });
    });
  }, []);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A menu that scrolls away behind the user is worse than no menu.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          scrolled ? "glass" : "border-b border-transparent",
        )}
      >
        <div className="gutter flex h-16 items-center justify-between md:h-[4.5rem]">
          <Link ref={brandRef} href="/" className="text-[0.9375rem]">
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-9 lg:flex" aria-label="Sections">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[0.8125rem] text-ink-secondary transition-colors duration-300 hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink href="/dashboard" size="sm" className="hidden sm:inline-flex">
              Start paper trading
            </ButtonLink>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex size-9 items-center justify-center lg:hidden"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <span className="relative block h-3 w-5">
                <span
                  className={cn(
                    "absolute inset-x-0 top-0 h-px bg-ink transition-transform duration-300",
                    menuOpen && "top-1.5 rotate-45",
                  )}
                />
                <span
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-px bg-ink transition-transform duration-300",
                    menuOpen && "bottom-1.5 -rotate-45",
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-40 bg-base lg:hidden"
          >
            <nav className="gutter flex h-full flex-col justify-center gap-2" aria-label="Sections">
              {NAV.map((item, index) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * index + 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="border-b border-line-subtle py-5 text-[2rem] font-medium tracking-[-0.03em]"
                >
                  {item.label}
                </motion.a>
              ))}
              <ButtonLink href="/dashboard" size="lg" className="mt-8 self-start">
                Start paper trading
              </ButtonLink>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex size-9 items-center justify-center rounded-full text-ink-secondary transition-colors duration-300 hover:text-ink"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { CommandPalette } from "@/components/command/command-palette";
import { CommandPaletteProvider } from "@/components/command/command-palette-provider";
import { KeyboardShortcuts } from "@/components/command/keyboard-shortcuts";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";
import { Modal } from "@/components/ui/modal";
import { ToastProvider } from "@/components/ui/toast";

/**
 * The terminal shell: sidebar on desktop, bottom bar on mobile, command
 * palette everywhere.
 *
 * The two navigations are separate components rather than one responsive
 * component, because they are different products of the same nav model — the
 * mobile bar carries four destinations and a raised action, not eleven links
 * at a smaller size.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [tradeOpen, setTradeOpen] = useState(false);

  return (
    <ToastProvider>
      <CommandPaletteProvider>
        <AppSidebar />

        {/* Sidebar is fixed, so the content column is offset rather than flexed. */}
        <div className="lg:pl-56">
          <AppTopbar />
          {/* Bottom padding clears the mobile bar and its safe-area inset. */}
          <main id="main" className="min-h-[calc(100svh-4rem)] pb-28 lg:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>

        <MobileNav onTrade={() => setTradeOpen(true)} />
        <CommandPalette />
        {/* Owns every keyboard binding in the application. */}
        <KeyboardShortcuts />

        <Modal
          open={tradeOpen}
          onClose={() => setTradeOpen(false)}
          title="Trade ticket"
          description="Place a virtual buy or sell order."
          footer={
            <Button variant="secondary" onClick={() => setTradeOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-5">
            <VirtualMoneyBadge />
            <p className="text-[0.9375rem] leading-relaxed text-ink-secondary">
              Orders are placed from an instrument&rsquo;s own page, where the price, chart and your
              current holding are all in view.
            </p>
            <Link
              href="/stocks"
              onClick={() => setTradeOpen(false)}
              className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-medium text-ink-inverse"
            >
              Find an instrument
            </Link>
          </div>
        </Modal>
      </CommandPaletteProvider>
    </ToastProvider>
  );
}

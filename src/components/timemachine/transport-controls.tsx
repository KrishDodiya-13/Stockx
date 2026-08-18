"use client";

import { SPEEDS, type PlaybackSpeed, type SessionStatus } from "@/services/timemachine/session-engine";
import { cn } from "@/lib/cn";

/**
 * Transport controls.
 *
 * Modelled on a tape deck rather than a media player: the session is a
 * recording being played back, and step-forward is a first-class control
 * because moving one bar at a time is how a session is actually studied.
 */
export function TransportControls({
  status,
  speed,
  cursor,
  total,
  onPlay,
  onPause,
  onStep,
  onReset,
  onSpeed,
}: {
  status: SessionStatus;
  speed: PlaybackSpeed;
  cursor: number;
  total: number;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeed: (speed: PlaybackSpeed) => void;
}) {
  const running = status === "running";
  const finished = status === "finished";
  const progress = total === 0 ? 0 : (cursor / total) * 100;

  return (
    <div className="border border-line">
      {/* Progress: how far through the session, never what comes next. */}
      <div className="h-1 w-full bg-line">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-linear"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={cursor}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Session progress"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={running ? onPause : onPlay}
          disabled={finished}
          aria-label={running ? "Pause" : "Play"}
          className={cn(
            "flex size-10 items-center justify-center rounded-full transition-all duration-300",
            "disabled:pointer-events-none disabled:opacity-40",
            running
              ? "border border-line-strong text-ink hover:bg-ink hover:text-ink-inverse"
              : "bg-ink text-ink-inverse hover:-translate-y-px",
          )}
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="currentColor">
            {running ? (
              <>
                <rect x="4" y="3" width="3" height="10" rx="1" />
                <rect x="9" y="3" width="3" height="10" rx="1" />
              </>
            ) : (
              <path d="M5 3.5v9l8-4.5-8-4.5Z" />
            )}
          </svg>
        </button>

        <button
          type="button"
          onClick={onStep}
          disabled={finished || running}
          aria-label="Step forward one bar"
          title="Step forward one bar"
          className="touch-target flex size-9 items-center justify-center rounded-full border border-line text-ink-secondary transition-colors duration-200 hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
            <path d="M4 3.5v9l7-4.5-7-4.5Z" />
            <rect x="11.5" y="3.5" width="2" height="9" rx="1" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onReset}
          aria-label="Reset session"
          title="Reset to the beginning"
          className="flex size-9 items-center justify-center rounded-full border border-line text-ink-secondary transition-colors duration-200 hover:border-ink hover:text-ink"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <path d="M3 8a5 5 0 1 0 1.6-3.7" />
            <path d="M2.5 3v3h3" />
          </svg>
        </button>

        {/*
          Speed buttons sit on their own line on a phone, where cramming
          transport, speed and a counter onto one row leaves every target too
          small to hit reliably.

          ── Why these were hard to click ───────────────────────────────────

          The desktop rule used to collapse them to `px-2.5 py-1` at the `sm`
          breakpoint, giving a target roughly 22px tall — half the height of the
          step and reset buttons sitting right beside them, and under any
          reasonable minimum. They were real buttons with real handlers all
          along; there was simply not much there to hit. `min-h-8` plus
          `touch-target` (which expands the hit area by 8px on coarse pointers)
          brings them into line with their neighbours without changing where
          anything sits.

          `cursor-pointer` is explicit because `.custom-cursor *` sets
          `cursor: none` app-wide for the custom cursor, and buttons carry no
          exemption — so there was no pointer affordance over these at all.
          `data-cursor="pointer"` opts this group out of that rule; see
          globals.css.
        */}
        <div
          className="order-3 flex w-full items-center gap-1.5 sm:order-none sm:ml-2 sm:w-auto"
          role="group"
          aria-label="Playback speed"
          data-cursor="pointer"
        >
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSpeed(option)}
              aria-pressed={speed === option}
              aria-label={`Playback speed ${option} times`}
              title={`${option}× speed`}
              className={cn(
                "touch-target tabular flex min-h-8 flex-1 cursor-pointer items-center justify-center",
                "rounded-full border px-3 text-[0.75rem] transition-colors duration-200",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "sm:flex-none sm:px-3 sm:text-[0.6875rem]",
                speed === option
                  ? // The filled treatment the play button uses: an active speed
                    // should be unmistakable at a glance, not a border tint.
                    "border-ink bg-ink font-medium text-ink-inverse"
                  : "border-line text-ink-tertiary hover:border-line-strong hover:text-ink",
              )}
            >
              {option}×
            </button>
          ))}
        </div>

        <span className="tabular ml-auto text-[0.6875rem] text-ink-tertiary">
          bar {cursor} / {total}
        </span>
      </div>
    </div>
  );
}

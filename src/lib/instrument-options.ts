import type { SelectOption } from "@/components/ui/dropdown";
import type { Instrument } from "@/domain/market";
import { EQUITY_INSTRUMENTS, INSTRUMENTS } from "@/services/market-data";

/**
 * The instrument registry, as dropdown options.
 *
 * Defined once because three pickers — the strategy builder, the risk
 * simulator and the Time Machine — were each mapping `INSTRUMENTS` into the
 * same shape by hand. That is three chances for one of them to fall behind
 * when the option shape gains a field, which is exactly what happened when
 * search keywords were added.
 *
 * Derived from `INSTRUMENTS` at module load, so any instrument added to the
 * registry appears in every picker with no further change.
 */
function toOption(instrument: Instrument): SelectOption {
  return {
    value: instrument.id,
    label: instrument.symbol,
    hint: instrument.name,
    /*
      Searchable but not displayed. The BSE scrip code lets `506655` find
      Sudarshan Chemical, without putting a number in a row that reads better
      as symbol-over-name. Only present for instruments whose code is known.
    */
    ...(instrument.bseCode ? { keywords: [instrument.bseCode] } : {}),
  };
}

/** Equities only — what a strategy or a risk simulation can be built on. */
export const EQUITY_OPTIONS: readonly SelectOption[] = EQUITY_INSTRUMENTS.map(toOption);

/**
 * Everything, indices included.
 *
 * For surfaces that only *display* an instrument. No picker that leads to an
 * order may use this list — the Time Machine used to, and that is how a BUY
 * button ended up pointed at an index. Trading pickers take `EQUITY_OPTIONS`.
 */
export const ALL_INSTRUMENT_OPTIONS: readonly SelectOption[] = INSTRUMENTS.map(toOption);

/** Placeholder shared by the instrument pickers, so the wording matches. */
export const INSTRUMENT_SEARCH_PLACEHOLDER = "Search symbol, company or BSE code…";

import { Wordmark } from "@/components/layout/wordmark";
import { PRODUCT_NAME, VIRTUAL_MONEY_NOTICE } from "@/domain/constants";

export function SiteFooter() {
  return (
    <footer className="gutter border-t border-line-subtle py-14">
      <div className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark className="text-sm" />
          <p className="mt-4 max-w-md text-xs leading-relaxed text-ink-tertiary">
            {VIRTUAL_MONEY_NOTICE}
          </p>
        </div>

        <div className="md:col-span-6 md:col-start-7">
          <p className="max-w-lg text-xs leading-relaxed text-ink-tertiary">
            Market prices shown in this build are produced by a local simulator and are labelled as
            simulated wherever they appear. Nothing here is investment advice, a recommendation, or
            an offer to deal in securities. Simulated results do not reflect brokerage, taxes,
            slippage or the liquidity constraints of a real order book, and past behaviour of any
            instrument does not indicate future results.
          </p>
        </div>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line-subtle pt-6">
        <p className="text-[0.6875rem] text-ink-tertiary">
          © {new Date().getFullYear()} {PRODUCT_NAME}. Paper trading only.
        </p>
        <p className="text-[0.6875rem] tracking-[0.14em] text-ink-tertiary uppercase">
          Virtual money · No real orders
        </p>
      </div>
    </footer>
  );
}

/**
 * Minimal ambient types for the Upstox SDK, which ships no declarations.
 *
 * Deliberately narrow: only the two entry points this app touches are typed, so
 * the surface that can be used without review stays small. The decoded feed
 * payload stays `unknown` on purpose — it is validated where it is read, in
 * `feed.ts`, rather than trusted because a hand-written type said so.
 */
declare module "upstox-js-sdk" {
  interface Authentication {
    accessToken: string;
  }

  export const ApiClient: {
    instance: {
      authentications: Record<string, Authentication>;
    };
  };

  export class MarketDataStreamerV3 {
    constructor(instrumentKeys?: string[], mode?: string);
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(instrumentKeys: string[], mode?: string): void;
    unsubscribe(instrumentKeys: string[]): void;
    on(event: string, handler: (payload: unknown) => void): void;
  }
}

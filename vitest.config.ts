import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /*
        `server-only` is a build-time guard: it throws when a module marked
        server-only is pulled into a client bundle. Under Vitest there is no
        bundle and no client, so it is stubbed out — otherwise server modules
        could not be unit-tested at all. The guard still does its real job in
        `next build`, which is where it matters.
      */
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

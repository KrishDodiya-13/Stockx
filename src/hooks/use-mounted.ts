"use client";

import { useEffect, useState } from "react";

/**
 * False during SSR and the first render, true afterwards.
 *
 * Guards anything that touches `document` — portals, in particular — so the
 * server and the client agree on the first paint.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

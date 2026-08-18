import { describe, expect, it } from "vitest";

import {
  CHORD_TIMEOUT_MS,
  IDLE_CHORD,
  SHORTCUTS,
  SHORTCUT_ROUTES,
  matchShortcut,
  renderKeys,
  shouldIgnoreTarget,
  tokenFor,
  type KeyEventLike,
} from "@/lib/shortcuts";

function key(k: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe("typing safety", () => {
  /*
    The most important behaviour here. Typing "s" into a quantity field must
    never fire the sell shortcut — in a trading application that is not a
    cosmetic bug.
  */
  it("ignores bare keys while typing in a text field", () => {
    const input = { tagName: "INPUT", isContentEditable: false, getAttribute: () => null };
    expect(shouldIgnoreTarget(input as unknown as EventTarget, key("s"))).toBe(true);
  });

  it("ignores bare keys in a textarea and contenteditable", () => {
    const textarea = { tagName: "TEXTAREA", isContentEditable: false, getAttribute: () => null };
    const editable = { tagName: "DIV", isContentEditable: true, getAttribute: () => null };

    expect(shouldIgnoreTarget(textarea as unknown as EventTarget, key("b"))).toBe(true);
    expect(shouldIgnoreTarget(editable as unknown as EventTarget, key("b"))).toBe(true);
  });

  it("ignores bare keys on a custom combobox control", () => {
    const combo = { tagName: "BUTTON", isContentEditable: false, getAttribute: () => "combobox" };
    expect(shouldIgnoreTarget(combo as unknown as EventTarget, key("g"))).toBe(true);
  });

  it("still allows modifier combinations while typing", () => {
    // Cmd+K must open the palette from anywhere, including a text field.
    const input = { tagName: "INPUT", isContentEditable: false, getAttribute: () => null };
    expect(shouldIgnoreTarget(input as unknown as EventTarget, key("k", { metaKey: true }))).toBe(false);
  });

  it("does not ignore keys outside a field", () => {
    const div = { tagName: "DIV", isContentEditable: false, getAttribute: () => null };
    expect(shouldIgnoreTarget(div as unknown as EventTarget, key("b"))).toBe(false);
  });
});

describe("tokenFor", () => {
  it("normalises case", () => {
    expect(tokenFor(key("G"))).toBe("g");
  });

  it("treats meta and control alike", () => {
    expect(tokenFor(key("k", { metaKey: true }))).toBe("mod+k");
    expect(tokenFor(key("k", { ctrlKey: true }))).toBe("mod+k");
  });

  it("leaves alt combinations to the operating system", () => {
    expect(tokenFor(key("k", { altKey: true }))).toBeNull();
  });

  it("recognises ? despite the shift it needs", () => {
    expect(tokenFor(key("?", { shiftKey: true }))).toBe("?");
  });

  it("ignores other shifted single keys", () => {
    expect(tokenFor(key("B", { shiftKey: true }))).toBeNull();
  });
});

describe("matching", () => {
  it("matches a modifier shortcut immediately", () => {
    const result = matchShortcut(key("k", { metaKey: true }), IDLE_CHORD, 0);
    expect(result).toEqual({ kind: "match", id: "palette" });
  });

  it("matches a single-key shortcut", () => {
    expect(matchShortcut(key("b"), IDLE_CHORD, 0)).toEqual({ kind: "match", id: "buy" });
  });

  it("arms a chord prefix rather than firing", () => {
    const result = matchShortcut(key("g"), IDLE_CHORD, 1000);
    expect(result.kind).toBe("armed");
  });

  it("completes a chord", () => {
    const armed = matchShortcut(key("g"), IDLE_CHORD, 1000);
    if (armed.kind !== "armed") throw new Error("expected armed");

    expect(matchShortcut(key("d"), armed.state, 1100)).toEqual({
      kind: "match",
      id: "nav-dashboard",
    });
  });

  it("expires a chord that is left hanging", () => {
    const armed = matchShortcut(key("g"), IDLE_CHORD, 1000);
    if (armed.kind !== "armed") throw new Error("expected armed");

    // Long after the prefix was armed, "d" is just "d" again — and since no
    // shortcut binds it alone, nothing fires.
    const late = matchShortcut(key("d"), armed.state, 1000 + CHORD_TIMEOUT_MS + 1);
    expect(late.kind).toBe("none");
  });

  it("does not fire on an unknown chord completion", () => {
    const armed = matchShortcut(key("g"), IDLE_CHORD, 0);
    if (armed.kind !== "armed") throw new Error("expected armed");

    expect(matchShortcut(key("z"), armed.state, 10)).toEqual({ kind: "none" });
  });

  it("returns none for an unbound key", () => {
    expect(matchShortcut(key("q"), IDLE_CHORD, 0)).toEqual({ kind: "none" });
  });

  it("has no duplicate bindings", () => {
    // Two shortcuts on one key would make behaviour depend on table order.
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      expect(seen.has(shortcut.keys)).toBe(false);
      seen.add(shortcut.keys);
    }
  });

  it("never binds a bare key that also begins a chord", () => {
    /*
      If "g" fired on its own it could never also start "g d" — the direct
      match wins and the chord becomes unreachable.
    */
    const prefixes = new Set(
      SHORTCUTS.filter((s) => s.keys.includes(" ")).map((s) => s.keys.split(" ")[0]),
    );

    for (const shortcut of SHORTCUTS) {
      if (shortcut.keys.includes(" ") || shortcut.keys.includes("+")) continue;
      expect(prefixes.has(shortcut.keys)).toBe(false);
    }
  });
});

describe("renderKeys", () => {
  it("renders the platform modifier", () => {
    expect(renderKeys("mod+k", true)).toEqual(["⌘", "K"]);
    expect(renderKeys("mod+k", false)).toEqual(["Ctrl", "K"]);
  });

  it("renders a chord as separate keys", () => {
    expect(renderKeys("g d", true)).toEqual(["G", "D"]);
  });

  it("renders a single key", () => {
    expect(renderKeys("b", true)).toEqual(["B"]);
  });
});

describe("routes", () => {
  it("gives every navigation shortcut a destination", () => {
    for (const shortcut of SHORTCUTS.filter((s) => s.group === "Navigate")) {
      expect(SHORTCUT_ROUTES[shortcut.id]).toBeTruthy();
    }
  });
});

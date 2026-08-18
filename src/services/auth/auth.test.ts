import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  validateEmail,
  validatePassword,
  verifyPassword,
} from "@/services/auth/password";
import { safeNextPath } from "@/services/auth/redirect";

/*
  scrypt at N=16384 costs roughly 100ms per call by design, so these tests are
  slower than the rest of the suite. That is the point of the parameter and not
  something to tune down for the tests' benefit — a fast test here would mean a
  cheap offline attack in production.
*/

describe("hashPassword / verifyPassword", () => {
  it("accepts the correct password", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse batterY", stored)).resolves.toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password twice");
    const b = await hashPassword("same password twice");

    expect(a).not.toBe(b);
    // Both must still verify — a differing salt is not a differing password.
    await expect(verifyPassword("same password twice", a)).resolves.toBe(true);
    await expect(verifyPassword("same password twice", b)).resolves.toBe(true);
  });

  it("never stores the password in the record", async () => {
    const stored = await hashPassword("plaintext-should-not-appear");
    expect(stored).not.toContain("plaintext-should-not-appear");
  });

  it("embeds the cost parameters so they can be raised later", async () => {
    const stored = await hashPassword("parameters");
    expect(stored.startsWith("scrypt$16384$8$1$64$")).toBe(true);
    expect(stored.split("$")).toHaveLength(7);
  });

  it("treats equivalent Unicode forms as the same password", async () => {
    // "é" composed vs decomposed. A keyboard may produce either; a user who
    // cannot log in from a different device would have no way to diagnose it.
    const stored = await hashPassword("passwordé-long-enough");
    await expect(verifyPassword("passwordé-long-enough", stored)).resolves.toBe(true);
  });

  it("returns false, not a throw, for a malformed record", async () => {
    for (const broken of ["", "garbage", "scrypt$16384$8$1$64$onlyfive", "bcrypt$a$b$c$d$e$f"]) {
      await expect(verifyPassword("anything at all", broken)).resolves.toBe(false);
    }
  });

  /*
    scrypt ends in a single PBKDF2 pass, so its output is prefix-stable: a
    64-byte derivation begins with exactly the bytes of a 32-byte derivation of
    the same inputs.

    Deriving to whatever length the *record* happens to be therefore made
    truncation harmless — a hash cut to one byte would have accepted one
    password in 256. These cases exist because that was the real behaviour
    until the declared length became part of what gets checked.
  */
  describe("truncated records", () => {
    it("rejects a hash trimmed by a few characters", async () => {
      const stored = await hashPassword("truncation test");
      await expect(
        verifyPassword("truncation test", stored.slice(0, stored.length - 10)),
      ).resolves.toBe(false);
    });

    it("rejects a hash cut down to a single byte", async () => {
      const [scheme, n, r, p, , salt, hash] = (await hashPassword("truncation test")).split("$");
      const oneByte = Buffer.from(hash!, "base64").subarray(0, 1).toString("base64");

      const forged = [scheme, n, r, p, 1, salt, oneByte].join("$");

      // Would otherwise accept roughly one password in 256.
      await expect(verifyPassword("truncation test", forged)).resolves.toBe(false);
      await expect(verifyPassword("any other password", forged)).resolves.toBe(false);
    });

    it("rejects a record whose declared length disagrees with its hash", async () => {
      const [scheme, n, r, p, , salt, hash] = (await hashPassword("truncation test")).split("$");
      const lying = [scheme, n, r, p, 32, salt, hash].join("$");

      await expect(verifyPassword("truncation test", lying)).resolves.toBe(false);
    });

    it("rejects a record with a stripped salt", async () => {
      const [scheme, n, r, p, len, , hash] = (await hashPassword("truncation test")).split("$");
      const saltless = [scheme, n, r, p, len, Buffer.alloc(2).toString("base64"), hash].join("$");

      await expect(verifyPassword("truncation test", saltless)).resolves.toBe(false);
    });
  });
});

describe("session tokens", () => {
  it("issues a distinct token every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createSessionToken()));
    expect(tokens.size).toBe(200);
  });

  it("issues tokens with 256 bits of entropy", () => {
    // 32 bytes, base64url — 43 characters with no padding.
    expect(createSessionToken()).toHaveLength(43);
  });

  it("hashes deterministically, so a session can be looked up", () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("does not store the token itself", () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });
});

describe("validatePassword", () => {
  it("rejects anything under ten characters", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("123456789").ok).toBe(false);
  });

  it("accepts ten characters", () => {
    expect(validatePassword("1234567890").ok).toBe(true);
  });

  it("rejects a password long enough to be a denial of service against scrypt", () => {
    expect(validatePassword("x".repeat(201)).ok).toBe(false);
  });

  it("explains every rejection", () => {
    expect(validatePassword("short").message).toBeTruthy();
    expect(validatePassword("x".repeat(201)).message).toBeTruthy();
    expect(validatePassword("1234567890").message).toBeNull();
  });
});

describe("validateEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(validateEmail("someone@example.com")).toBe(true);
    expect(validateEmail("first.last+tag@sub.example.co.in")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "no-at-sign", "@example.com", "a@b", "a b@example.com", "a@ex ample.com"]) {
      expect(validateEmail(bad)).toBe(false);
    }
  });

  it("rejects an address past the RFC length limit", () => {
    expect(validateEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows an ordinary in-app path", () => {
    expect(safeNextPath("/portfolio")).toBe("/portfolio");
    expect(safeNextPath("/stocks/RELIANCE?tab=chart")).toBe("/stocks/RELIANCE?tab=chart");
  });

  it("refuses a protocol-relative URL", () => {
    // The classic open redirect: the browser reads this as another host.
    expect(safeNextPath("//evil.example.com")).toBeUndefined();
  });

  it("refuses an absolute URL", () => {
    expect(safeNextPath("https://evil.example.com")).toBeUndefined();
    expect(safeNextPath("/\\evil.example.com")).toBeUndefined();
  });

  it("refuses a javascript: payload", () => {
    expect(safeNextPath("javascript:alert(1)")).toBeUndefined();
    expect(safeNextPath("/javascript:alert(1)")).toBeUndefined();
  });

  it("refuses a backslash, which some browsers normalise to a slash", () => {
    expect(safeNextPath("/\\/evil.example.com")).toBeUndefined();
  });

  it("refuses embedded control characters", () => {
    expect(safeNextPath("/portfolio\nLocation: https://evil.example.com")).toBeUndefined();
    expect(safeNextPath("/portfolio\r\n")).toBeUndefined();
  });

  it("refuses anything that is not a path", () => {
    expect(safeNextPath(undefined)).toBeUndefined();
    expect(safeNextPath(null)).toBeUndefined();
    expect(safeNextPath("")).toBeUndefined();
    expect(safeNextPath("portfolio")).toBeUndefined();
  });
});

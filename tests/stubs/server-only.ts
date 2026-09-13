/**
 * Stand-in for the `server-only` package, used by the Vitest runner alone.
 *
 * The real package throws on import outside a React Server Component, which is
 * exactly what it is for — importing a server module into client code becomes a
 * build error rather than a leaked secret. Vitest is neither, so the real
 * package would fail on any module that guards itself this way.
 *
 * This does not weaken the guarantee. Next.js resolves the genuine package
 * through the `react-server` export condition when it builds, and
 * tests/notification-config.test.ts asserts that the modules holding secrets
 * still carry the import.
 */
export {};

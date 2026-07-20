/**
 * @syncforge/core
 *
 * The functional core. Everything in here is a pure function: data in, data
 * out. No sockets, no database, no OpenAI client, no clock, no randomness.
 *
 * This is where the algorithms live:
 *   - transform()  operational transform  (Phases 13-15)
 *   - chunk()      source code chunking   (Phase 24)
 *   - rank()       retrieval ranking      (Phase 27)
 *
 * Purity is the point. These are the parts of the system that are hard to get
 * right, so they need to be testable at machine speed -- thousands of randomized
 * cases per second, no server running, no database container.
 *
 * The compiler enforces this: tsconfig sets `"types": []`, so there is no
 * `process`, no `fetch`, no Node globals available in this package at all.
 */

export const CORE_PACKAGE = "@syncforge/core" as const;

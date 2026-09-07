import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/lib/rateLimiter";

describe("RateLimiter", () => {
  it("allows up to the configured max within the window", () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = 1_000_000;
    expect(limiter.tryAcquire("a", now)).toBe(true);
    expect(limiter.tryAcquire("a", now + 1)).toBe(true);
    expect(limiter.tryAcquire("a", now + 2)).toBe(true);
    expect(limiter.tryAcquire("a", now + 3)).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    const now = 1_000_000;
    expect(limiter.tryAcquire("a", now)).toBe(true);
    expect(limiter.tryAcquire("b", now)).toBe(true);
    expect(limiter.tryAcquire("a", now)).toBe(false);
    expect(limiter.tryAcquire("b", now)).toBe(false);
  });

  it("allows more attempts once the window slides past old hits", () => {
    const limiter = new RateLimiter(2, 1000);
    const now = 1_000_000;
    expect(limiter.tryAcquire("a", now)).toBe(true);
    expect(limiter.tryAcquire("a", now + 100)).toBe(true);
    expect(limiter.tryAcquire("a", now + 200)).toBe(false);
    // First hit (at `now`) has fallen out of the 1000ms window.
    expect(limiter.tryAcquire("a", now + 1001)).toBe(true);
  });

  it("does not record rejected attempts against the window", () => {
    const limiter = new RateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.tryAcquire("a", now)).toBe(true);
    expect(limiter.tryAcquire("a", now + 10)).toBe(false);
    expect(limiter.tryAcquire("a", now + 20)).toBe(false);
    expect(limiter.remaining("a", now + 20)).toBe(0);
  });

  it("reset() clears tracked state for a key", () => {
    const limiter = new RateLimiter(1, 60_000);
    const now = 1_000_000;
    expect(limiter.tryAcquire("a", now)).toBe(true);
    expect(limiter.tryAcquire("a", now + 1)).toBe(false);
    limiter.reset("a");
    expect(limiter.tryAcquire("a", now + 2)).toBe(true);
  });

  it("rejects non-positive constructor arguments", () => {
    expect(() => new RateLimiter(0, 1000)).toThrow();
    expect(() => new RateLimiter(5, 0)).toThrow();
  });
});

/**
 * Sliding-window rate limiter. Pure logic, no Telegram/DB dependency, so it's
 * fully unit-testable and independent of wall-clock time in tests via the
 * injectable `now` parameter.
 *
 * Used to cap the delete-and-repost loop per (user, topic) so a bug or a
 * spam burst can't blow through Bot API rate limits.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {
    if (max <= 0) throw new Error("max must be positive");
    if (windowMs <= 0) throw new Error("windowMs must be positive");
  }

  /**
   * Records an attempt for `key` and returns whether it's allowed under the
   * limit. Rejected attempts are NOT recorded (so a caller that backs off
   * doesn't dig itself deeper into the window).
   */
  tryAcquire(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const existing = this.hits.get(key) ?? [];
    const recent = existing.filter((t) => t > windowStart);

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Number of allowed hits remaining in the current window for `key`. */
  remaining(key: string, now: number = Date.now()): number {
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    return Math.max(0, this.max - recent.length);
  }

  /** Drops tracked state for `key`. Mostly useful for tests. */
  reset(key: string): void {
    this.hits.delete(key);
  }
}

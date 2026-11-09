/**
 * Small in-memory, per-IP sliding-window rate limiter (no extra packages).
 * Protects the LLM key from being burned by a script hammering the API.
 * For several server instances you would back this with Redis.
 */
type Req = { ip?: string; path?: string; originalUrl?: string; socket?: { remoteAddress?: string } };
type Res = { status: (code: number) => Res; setHeader: (k: string, v: string) => void; json: (b: unknown) => void };

export function rateLimit(rules: { prefix: string; max: number; windowMs: number }[]) {
  const hits = new Map<string, number[]>();

  // Drop stale entries now and then so the map can't grow forever.
  const sweeper: any = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) if (!times.length || now - times[times.length - 1] > 10 * 60_000) hits.delete(key);
  }, 60_000);
  sweeper.unref?.(); // don't keep the process alive just for this

  return (req: Req, res: Res, next: () => void) => {
    const path = req.originalUrl ?? req.path ?? '';
    const rule = rules.find((r) => path.startsWith(r.prefix));
    if (!rule) return next();

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const key = `${rule.prefix}|${ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
    if (recent.length >= rule.max) {
      const retry = Math.ceil((rule.windowMs - (now - recent[0])) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ statusCode: 429, message: `Too many requests. Please wait ${retry} seconds.` });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

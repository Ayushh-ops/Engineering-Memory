import type { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
    count: number;
    resetTime: number;
}

export function createRateLimiter(options: { maxRequests: number; windowMs?: number }) {
    const windowMs = options.windowMs ?? 60_000;
    const ipMap = new Map<string, RateLimitRecord>();

    const interval = setInterval(() => {
        const now = Date.now();
        for (const [ip, record] of ipMap.entries()) {
            if (now >= record.resetTime) {
                ipMap.delete(ip);
            }
        }
    }, windowMs);

    if (interval.unref) {
        interval.unref();
    }

    return (req: Request, res: Response, next: NextFunction) => {
        const ip = (req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "");
        const now = Date.now();
        let record = ipMap.get(ip);

        if (!record || now >= record.resetTime) {
            record = { count: 1, resetTime: now + windowMs };
            ipMap.set(ip, record);
            return next();
        }

        if (record.count >= options.maxRequests) {
            const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
            res.setHeader("Retry-After", String(retryAfterSeconds));
            return res.status(429).json({
                error: "rate_limited",
                retryAfterSeconds
            });
        }

        record.count++;
        next();
    };
}

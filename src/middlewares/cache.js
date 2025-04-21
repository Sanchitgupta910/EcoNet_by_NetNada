import redis from '../utils/redisClient.js';

export function cache(ttlSeconds) {
  return async (req, res, next) => {
    const key = `${req.originalUrl}`; // or include user/branch ID
    try {
      const cached = await redis.get(key);
      if (cached) {
        // return it immediately
        return res.json(JSON.parse(cached));
      }
    } catch (err) {
      console.error('Cache read error', err);
      // proceed without failing
    }

    // replace res.json to also write to cache
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        redis.setex(key, ttlSeconds, JSON.stringify(body));
      } catch (err) {
        console.error('Cache write error', err);
      }
      return originalJson(body);
    };

    next();
  };
}

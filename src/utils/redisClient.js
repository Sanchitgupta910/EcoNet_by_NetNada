import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({
  path: './.env',
});
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // important for long‑lived connections
  enableReadyCheck: true,
});

redis.on('ready', () => console.log('✅ Redis connection ready'));
redis.on('error', (err) => console.error('🔥 Redis error', err));

export default redis;

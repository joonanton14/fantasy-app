import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.warn('REDIS_URL is not set. Sessions will not work correctly in production.');
}

export const redis = redisUrl ? new Redis(redisUrl) : null;

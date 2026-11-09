// Redis connection used by the scanner to keep the hourly snapshot.
const Redis = require('ioredis')

let redis

async function initRedis() {
  redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASS || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    lazyConnect: true,
  })
  await redis.connect()
  await redis.ping()
}

function getRedis() {
  if (!redis) throw new Error('Redis not initialized')
  return redis
}

module.exports = { initRedis, getRedis }

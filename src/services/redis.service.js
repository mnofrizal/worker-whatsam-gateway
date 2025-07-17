import Redis from "ioredis";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

let client = null;
let initialized = false;
const redisConfigOptions = config.redis;

const initialize = async () => {
  try {
    logger.info("Initializing Redis service...");

    if (!redisConfigOptions.enabled) {
      logger.info(
        "Redis is disabled via configuration, Redis service will be disabled"
      );
      return;
    }

    if (!redisConfigOptions.url && !redisConfigOptions.host) {
      logger.warn("Redis not configured, Redis service will be disabled");
      return;
    }

    const redisConnectionConfig = {
      retryDelayOnFailover: redisConfigOptions.retryDelayOnFailover,
      enableOfflineQueue: redisConfigOptions.enableOfflineQueue,
      maxRetriesPerRequest: redisConfigOptions.maxRetriesPerRequest,
      lazyConnect: redisConfigOptions.lazyConnect,
      keyPrefix: redisConfigOptions.keyPrefix,
    };

    if (redisConfigOptions.url) {
      client = new Redis(redisConfigOptions.url, redisConnectionConfig);
    } else {
      client = new Redis({
        host: redisConfigOptions.host,
        port: redisConfigOptions.port,
        password: redisConfigOptions.password,
        db: redisConfigOptions.db,
        ...redisConnectionConfig,
      });
    }

    await client.ping();
    initialized = true;
    logger.info("Redis service initialized successfully", {
      host: redisConfigOptions.host,
      port: redisConfigOptions.port,
      db: redisConfigOptions.db,
      keyPrefix: redisConfigOptions.keyPrefix,
    });
  } catch (error) {
    logger.error("Failed to initialize Redis service:", error);
    logger.warn("Redis service will be disabled");
  }
};

const set = async (key, value, ttl = null) => {
  if (!initialized) {
    logger.warn("Redis not available, skipping set operation");
    return;
  }

  try {
    if (ttl) {
      await client.setex(key, ttl, JSON.stringify(value));
    } else {
      await client.set(key, JSON.stringify(value));
    }
  } catch (error) {
    logger.error("Redis set error:", error);
  }
};

const get = async (key) => {
  if (!initialized) {
    logger.warn("Redis not available, skipping get operation");
    return null;
  }

  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error("Redis get error:", error);
    return null;
  }
};

const del = async (key) => {
  if (!initialized) {
    logger.warn("Redis not available, skipping delete operation");
    return;
  }

  try {
    await client.del(key);
  } catch (error) {
    logger.error("Redis delete error:", error);
  }
};

const exists = async (key) => {
  if (!initialized) {
    return false;
  }

  try {
    const result = await client.exists(key);
    return result === 1;
  } catch (error) {
    logger.error("Redis exists error:", error);
    return false;
  }
};

const close = async () => {
  if (client) {
    client.disconnect();
    logger.info("Redis connection closed");
  }
};

const isInitialized = () => {
  return initialized;
};

const setSessionRouting = async (sessionId, workerId) => {
  await set(`session:${sessionId}:worker`, workerId, 3600); // 1 hour TTL
};

const getSessionRouting = async (sessionId) => {
  return await get(`session:${sessionId}:worker`);
};

const deleteSessionRouting = async (sessionId) => {
  await del(`session:${sessionId}:worker`);
};

const setWorkerStatus = async (workerId, status) => {
  await set(`worker:${workerId}:status`, status, 60); // 1 minute TTL
};

const getWorkerStatus = async (workerId) => {
  return await get(`worker:${workerId}:status`);
};

const setQRCode = async (sessionId, qrData) => {
  await set(`qr:${sessionId}`, qrData, config.whatsapp.qrTimeout / 1000); // Use QR timeout from config
};

const getQRCode = async (sessionId) => {
  return await get(`qr:${sessionId}`);
};

const deleteQRCode = async (sessionId) => {
  await del(`qr:${sessionId}`);
};

export default {
  initialize,
  set,
  get,
  del,
  exists,
  close,
  isInitialized,
  setSessionRouting,
  getSessionRouting,
  deleteSessionRouting,
  setWorkerStatus,
  getWorkerStatus,
  setQRCode,
  getQRCode,
  deleteQRCode,
};

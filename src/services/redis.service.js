import Redis from "ioredis";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

class RedisService {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.config = config.redis;
  }

  async initialize() {
    try {
      logger.info("Initializing Redis service...");

      // Check if Redis is enabled
      if (!this.config.enabled) {
        logger.info(
          "Redis is disabled via configuration, Redis service will be disabled"
        );
        return;
      }

      // Check if Redis configuration is available
      if (!this.config.url && !this.config.host) {
        logger.warn("Redis not configured, Redis service will be disabled");
        return;
      }

      // Create Redis configuration
      const redisConfig = {
        retryDelayOnFailover: this.config.retryDelayOnFailover,
        enableOfflineQueue: this.config.enableOfflineQueue,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        lazyConnect: this.config.lazyConnect,
        keyPrefix: this.config.keyPrefix,
      };

      // Use connection string if available, otherwise use individual parameters
      if (this.config.url) {
        this.client = new Redis(this.config.url, redisConfig);
      } else {
        this.client = new Redis({
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
          db: this.config.db,
          ...redisConfig,
        });
      }

      // Test connection
      await this.client.ping();

      this.initialized = true;
      logger.info("Redis service initialized successfully", {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
      });
    } catch (error) {
      logger.error("Failed to initialize Redis service:", error);
      // Don't throw error to allow worker to start without Redis
      logger.warn("Redis service will be disabled");
    }
  }

  async set(key, value, ttl = null) {
    if (!this.initialized) {
      logger.warn("Redis not available, skipping set operation");
      return;
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, JSON.stringify(value));
      } else {
        await this.client.set(key, JSON.stringify(value));
      }
    } catch (error) {
      logger.error("Redis set error:", error);
    }
  }

  async get(key) {
    if (!this.initialized) {
      logger.warn("Redis not available, skipping get operation");
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error("Redis get error:", error);
      return null;
    }
  }

  async del(key) {
    if (!this.initialized) {
      logger.warn("Redis not available, skipping delete operation");
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      logger.error("Redis delete error:", error);
    }
  }

  async exists(key) {
    if (!this.initialized) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error("Redis exists error:", error);
      return false;
    }
  }

  async close() {
    if (this.client) {
      this.client.disconnect();
      logger.info("Redis connection closed");
    }
  }

  isInitialized() {
    return this.initialized;
  }

  // Session-related Redis operations
  async setSessionRouting(sessionId, workerId) {
    await this.set(`session:${sessionId}:worker`, workerId, 3600); // 1 hour TTL
  }

  async getSessionRouting(sessionId) {
    return await this.get(`session:${sessionId}:worker`);
  }

  async deleteSessionRouting(sessionId) {
    await this.del(`session:${sessionId}:worker`);
  }

  async setWorkerStatus(workerId, status) {
    await this.set(`worker:${workerId}:status`, status, 60); // 1 minute TTL
  }

  async getWorkerStatus(workerId) {
    return await this.get(`worker:${workerId}:status`);
  }

  async setQRCode(sessionId, qrData) {
    await this.set(`qr:${sessionId}`, qrData, config.whatsapp.qrTimeout / 1000); // Use QR timeout from config
  }

  async getQRCode(sessionId) {
    return await this.get(`qr:${sessionId}`);
  }

  async deleteQRCode(sessionId) {
    await this.del(`qr:${sessionId}`);
  }
}

export default RedisService;

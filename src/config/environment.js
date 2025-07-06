import dotenv from "dotenv";
import os from "os";

// Load environment variables
dotenv.config();

/**
 * Environment Configuration
 * Centralized configuration management for all environment variables
 */
const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT) || 8001,
    nodeEnv: process.env.NODE_ENV || "development",
    workerId: process.env.WORKER_ID || `worker-${Date.now()}`,
    workerEndpoint: process.env.WORKER_ENDPOINT || "http://localhost:8001",
    maxSessions: parseInt(process.env.MAX_SESSIONS) || 50,
    description: process.env.WORKER_DESCRIPTION || "WhatsApp Worker Instance",
  },

  // Backend Integration
  backend: {
    url: process.env.BACKEND_URL || "http://localhost:8000",
    workerAuthToken: process.env.WORKER_AUTH_TOKEN || "worker-secret-token",
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000, // 30 seconds
    registrationRetryInterval:
      parseInt(process.env.REGISTRATION_RETRY_INTERVAL) || 5000, // 5 seconds
    maxRegistrationRetries: parseInt(process.env.MAX_REGISTRATION_RETRIES) || 5,
  },

  // Database Configuration
  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://user:password@localhost:5432/whatsapp_gateway",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || "whatsapp_gateway",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "password",
    ssl: process.env.DB_SSL === "true",
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis:
      parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  },

  // Redis Configuration
  redis: {
    enabled: process.env.REDIS_ENABLED !== "false", // Default enabled, can be disabled
    url: process.env.REDIS_URL || null,
    host: process.env.REDIS_HOST || null,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: process.env.REDIS_KEY_PREFIX || "whatsapp:",
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
    retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY) || 100,
    enableOfflineQueue: process.env.REDIS_OFFLINE_QUEUE !== "false",
    lazyConnect: process.env.REDIS_LAZY_CONNECT === "true",
  },

  // MinIO Configuration
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || "localhost",
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    region: process.env.MINIO_REGION || "us-east-1",
    buckets: {
      sessions: process.env.MINIO_SESSIONS_BUCKET || "whatsapp-sessions",
      media: process.env.MINIO_MEDIA_BUCKET || "whatsapp-media",
      backups: process.env.MINIO_BACKUPS_BUCKET || "whatsapp-backups",
    },
  },

  // Security Configuration
  security: {
    jwtSecret:
      process.env.JWT_SECRET || "your-jwt-secret-key-change-in-production",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    encryptionKey:
      process.env.ENCRYPTION_KEY || "your-encryption-key-change-in-production",
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
    corsOrigin: process.env.CORS_ORIGIN || "*",
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === "true",
    skipFailedRequests: process.env.RATE_LIMIT_SKIP_FAILED === "true",
    keyGenerator: process.env.RATE_LIMIT_KEY_GENERATOR || "ip", // ip, user, session
  },

  // File Upload Configuration
  fileUpload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE) || 10 * 1024 * 1024, // 10MB
    allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(",") || [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "audio/mpeg",
      "audio/wav",
      "video/mp4",
      "video/webm",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    uploadPath: process.env.UPLOAD_PATH || "./uploads",
    tempPath: process.env.TEMP_PATH || "./temp",
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    filePath: process.env.LOG_FILE_PATH || "./logs",
    maxSize: process.env.LOG_MAX_SIZE || "20m",
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
    datePattern: process.env.LOG_DATE_PATTERN || "YYYY-MM-DD",
    enableConsole: process.env.LOG_ENABLE_CONSOLE !== "false",
    enableFile: process.env.LOG_ENABLE_FILE !== "false",
    enableJson: process.env.LOG_ENABLE_JSON === "true",
  },

  // WhatsApp/Baileys Configuration
  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || "./storage/sessions",
    mediaPath: process.env.WHATSAPP_MEDIA_PATH || "./storage/media",
    qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT) || 60000, // 1 minute
    connectionTimeout:
      parseInt(process.env.WHATSAPP_CONNECTION_TIMEOUT) || 30000, // 30 seconds
    reconnectInterval:
      parseInt(process.env.WHATSAPP_RECONNECT_INTERVAL) || 5000, // 5 seconds
    maxReconnectAttempts:
      parseInt(process.env.WHATSAPP_MAX_RECONNECT_ATTEMPTS) || 5,
    enableLogging: process.env.WHATSAPP_ENABLE_LOGGING === "true",
    printQRInTerminal: process.env.WHATSAPP_PRINT_QR === "true",
    generateHighQualityLinkPreview:
      process.env.WHATSAPP_HIGH_QUALITY_PREVIEW !== "false",
  },

  // Health Check Configuration
  health: {
    enableHealthCheck: process.env.ENABLE_HEALTH_CHECK !== "false",
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
    healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000, // 5 seconds
    enableReadinessCheck: process.env.ENABLE_READINESS_CHECK !== "false",
    enableLivenessCheck: process.env.ENABLE_LIVENESS_CHECK !== "false",
  },

  // Monitoring Configuration
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS !== "false",
    metricsPath: process.env.METRICS_PATH || "/metrics",
    enablePrometheus: process.env.ENABLE_PROMETHEUS === "true",
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT) || 9090,
    collectDefaultMetrics: process.env.COLLECT_DEFAULT_METRICS !== "false",
    metricsInterval: parseInt(process.env.METRICS_INTERVAL) || 10000, // 10 seconds
  },

  // Development Configuration
  development: {
    enableDebug: process.env.ENABLE_DEBUG === "true",
    enableHotReload: process.env.ENABLE_HOT_RELOAD === "true",
    enableCors: process.env.ENABLE_CORS !== "false",
    enableMockData: process.env.ENABLE_MOCK_DATA === "true",
    mockDelay: parseInt(process.env.MOCK_DELAY) || 1000,
  },

  // Production Configuration
  production: {
    enableCompression: process.env.ENABLE_COMPRESSION !== "false",
    enableHelmet: process.env.ENABLE_HELMET !== "false",
    enableHttps: process.env.ENABLE_HTTPS === "true",
    httpsPort: parseInt(process.env.HTTPS_PORT) || 8443,
    sslCertPath: process.env.SSL_CERT_PATH || "./ssl/cert.pem",
    sslKeyPath: process.env.SSL_KEY_PATH || "./ssl/key.pem",
    enableCluster: process.env.ENABLE_CLUSTER === "true",
    clusterWorkers: parseInt(process.env.CLUSTER_WORKERS) || os.cpus().length,
  },

  // Feature Flags
  features: {
    enableBulkMessages: process.env.ENABLE_BULK_MESSAGES !== "false",
    enableMediaMessages: process.env.ENABLE_MEDIA_MESSAGES !== "false",
    enableWebhooks: process.env.ENABLE_WEBHOOKS !== "false",
    enableSessionMigration: process.env.ENABLE_SESSION_MIGRATION === "true",
    enableAutoBackup: process.env.ENABLE_AUTO_BACKUP === "true",
    enableMessageHistory: process.env.ENABLE_MESSAGE_HISTORY !== "false",
    enableAnalytics: process.env.ENABLE_ANALYTICS === "true",
  },
};

/**
 * Validate required environment variables
 */
const validateConfig = () => {
  const requiredVars = [];

  // Check critical environment variables
  if (config.server.nodeEnv === "production") {
    if (
      config.security.jwtSecret === "your-jwt-secret-key-change-in-production"
    ) {
      requiredVars.push("JWT_SECRET");
    }
    if (
      config.security.encryptionKey ===
      "your-encryption-key-change-in-production"
    ) {
      requiredVars.push("ENCRYPTION_KEY");
    }
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
      requiredVars.push("DATABASE_URL or DB_HOST");
    }
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      requiredVars.push("REDIS_URL or REDIS_HOST");
    }
    if (
      !process.env.MINIO_ACCESS_KEY ||
      config.minio.accessKey === "minioadmin"
    ) {
      requiredVars.push("MINIO_ACCESS_KEY");
    }
    if (
      !process.env.MINIO_SECRET_KEY ||
      config.minio.secretKey === "minioadmin"
    ) {
      requiredVars.push("MINIO_SECRET_KEY");
    }
  }

  if (requiredVars.length > 0) {
    throw new Error(
      `Missing required environment variables for production: ${requiredVars.join(", ")}`
    );
  }
};

/**
 * Get configuration for specific environment
 */
const getEnvConfig = (env = config.server.nodeEnv) => {
  const envConfigs = {
    development: {
      ...config,
      logging: { ...config.logging, level: "debug" },
      rateLimit: { ...config.rateLimit, maxRequests: 1000 },
      whatsapp: {
        ...config.whatsapp,
        enableLogging: true,
        printQRInTerminal: true,
      },
    },
    test: {
      ...config,
      server: { ...config.server, port: 0 }, // Random port for testing
      logging: { ...config.logging, level: "error", enableConsole: false },
      database: { ...config.database, name: "whatsapp_gateway_test" },
      redis: { ...config.redis, db: 1 }, // Use different Redis DB for testing
    },
    production: {
      ...config,
      logging: { ...config.logging, level: "warn" },
      whatsapp: {
        ...config.whatsapp,
        enableLogging: false,
        printQRInTerminal: false,
      },
      development: {
        ...config.development,
        enableDebug: false,
        enableMockData: false,
      },
    },
  };

  return envConfigs[env] || config;
};

/**
 * Check if running in development mode
 */
const isDevelopment = () => config.server.nodeEnv === "development";

/**
 * Check if running in production mode
 */
const isProduction = () => config.server.nodeEnv === "production";

/**
 * Check if running in test mode
 */
const isTest = () => config.server.nodeEnv === "test";

// Validate configuration on import (except in test environment)
if (!isTest()) {
  try {
    validateConfig();
  } catch (error) {
    console.error("Configuration validation failed:", error.message);
    if (isProduction()) {
      process.exit(1);
    }
  }
}

export default config;
export { getEnvConfig, isDevelopment, isProduction, isTest, validateConfig };

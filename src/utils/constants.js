/**
 * HTTP Status Codes
 * Standard HTTP response status codes used throughout the application
 */
export const HTTP_STATUS = {
  // Success responses (2xx)
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // Redirection responses (3xx)
  NOT_MODIFIED: 304,

  // Client error responses (4xx)
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // Server error responses (5xx)
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
};

/**
 * Error Codes
 * Application-specific error codes for better error handling
 */
export const ERROR_CODES = {
  // Authentication & Authorization
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",

  // Validation Errors
  VALIDATION_FAILED: "VALIDATION_FAILED",
  VALIDATION_ERROR: "VALIDATION_ERROR", // Added for message controller compatibility
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_REQUEST: "INVALID_REQUEST", // Added for message controller compatibility
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_FORMAT: "INVALID_FORMAT",

  // Session Errors
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_ALREADY_EXISTS: "SESSION_ALREADY_EXISTS",
  SESSION_NOT_CONNECTED: "SESSION_NOT_CONNECTED",
  SESSION_CREATION_FAILED: "SESSION_CREATION_FAILED",
  SESSION_DELETION_FAILED: "SESSION_DELETION_FAILED",
  QR_CODE_EXPIRED: "QR_CODE_EXPIRED",
  QR_CODE_NOT_READY: "QR_CODE_NOT_READY",

  // WhatsApp/Baileys Errors
  WHATSAPP_CONNECTION_LOST: "WHATSAPP_CONNECTION_LOST",
  WHATSAPP_AUTH_FAILED: "WHATSAPP_AUTH_FAILED",
  MESSAGE_SEND_FAILED: "MESSAGE_SEND_FAILED",
  INVALID_PHONE_NUMBER: "INVALID_PHONE_NUMBER",
  RECIPIENT_NOT_FOUND: "RECIPIENT_NOT_FOUND",

  // File Upload Errors
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
  FILE_UPLOAD_FAILED: "FILE_UPLOAD_FAILED",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",

  // Database Errors
  DATABASE_CONNECTION_FAILED: "DATABASE_CONNECTION_FAILED",
  DATABASE_QUERY_FAILED: "DATABASE_QUERY_FAILED",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  DUPLICATE_RECORD: "DUPLICATE_RECORD",

  // Storage Errors
  STORAGE_CONNECTION_FAILED: "STORAGE_CONNECTION_FAILED",
  STORAGE_UPLOAD_FAILED: "STORAGE_UPLOAD_FAILED",
  STORAGE_DOWNLOAD_FAILED: "STORAGE_DOWNLOAD_FAILED",

  // Service Errors
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",

  // General Errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
};

/**
 * Session Status Constants
 * WhatsApp session connection states
 */
export const SESSION_STATUS = {
  INITIALIZING: "initializing",
  QR_READY: "qr_ready",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
  DESTROYED: "destroyed",
};

/**
 * Message Types
 * Supported WhatsApp message types
 */
export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  DOCUMENT: "document",
  AUDIO: "audio",
  VIDEO: "video",
  STICKER: "sticker",
  LOCATION: "location",
  CONTACT: "contact",
  LINK: "link",
  POLL: "poll",
  SEEN: "seen",
  TYPING_START: "typing_start",
  TYPING_STOP: "typing_stop",
  SYSTEM: "system", // Added for message controller logging
};

// Message management actions
export const MESSAGE_ACTIONS = {
  DELETE: "delete",
  UNSEND: "unsend",
  STAR: "star",
  UNSTAR: "unstar",
  EDIT: "edit",
  REACTION: "reaction",
  READ: "read",
};

/**
 * Message Status
 * WhatsApp message delivery status
 */
export const MESSAGE_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
};

/**
 * Worker Status
 * Worker health and operational status
 */
export const WORKER_STATUS = {
  STARTING: "starting",
  ONLINE: "online",
  OFFLINE: "offline",
  MAINTENANCE: "maintenance",
  ERROR: "error",
};

/**
 * File Upload Constants
 * File upload limitations and configurations
 */
export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  ALLOWED_DOCUMENT_TYPES: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
  ],
  ALLOWED_AUDIO_TYPES: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"],
  ALLOWED_VIDEO_TYPES: [
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
  ],
};

/**
 * Rate Limiting Constants
 * Rate limiting configurations for different tiers
 */
export const RATE_LIMITS = {
  FREE_TIER: {
    GENERAL: { windowMs: 15 * 60 * 1000, max: 50 },
    SESSION: { windowMs: 5 * 60 * 1000, max: 5 },
    MESSAGE: { windowMs: 60 * 1000, max: 10 },
  },
  PRO_TIER: {
    GENERAL: { windowMs: 15 * 60 * 1000, max: 200 },
    SESSION: { windowMs: 5 * 60 * 1000, max: 20 },
    MESSAGE: { windowMs: 60 * 1000, max: 60 },
  },
  PREMIUM_TIER: {
    GENERAL: { windowMs: 15 * 60 * 1000, max: 1000 },
    SESSION: { windowMs: 5 * 60 * 1000, max: 100 },
    MESSAGE: { windowMs: 60 * 1000, max: 300 },
  },
};

/**
 * Pagination Constants
 * Default pagination settings
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100,
  MAX_PAGE: 1000,
};

/**
 * Cache TTL Constants
 * Time-to-live values for different cache types (in seconds)
 */
export const CACHE_TTL = {
  QR_CODE: 120, // 2 minutes
  SESSION_STATUS: 30, // 30 seconds
  WORKER_METRICS: 60, // 1 minute
  MESSAGE_HISTORY: 300, // 5 minutes
  USER_SESSION: 3600, // 1 hour
};

/**
 * Retry Constants
 * Retry configurations for different operations
 */
export const RETRY_CONFIG = {
  DEFAULT: {
    attempts: 3,
    delay: 1000,
    backoff: 2,
  },
  DATABASE: {
    attempts: 5,
    delay: 500,
    backoff: 1.5,
  },
  WHATSAPP: {
    attempts: 3,
    delay: 2000,
    backoff: 2,
  },
  STORAGE: {
    attempts: 3,
    delay: 1000,
    backoff: 2,
  },
};

/**
 * Validation Constants
 * Validation rules and patterns
 */
export const VALIDATION = {
  SESSION_ID: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 50,
    PATTERN: /^[a-zA-Z0-9_-]+$/,
  },
  PHONE_NUMBER: {
    PATTERN: /^(\+?62|62|0)8[1-9][0-9]{6,11}$/,
    MIN_LENGTH: 10,
    MAX_LENGTH: 15,
  },
  MESSAGE: {
    MAX_LENGTH: 4096,
    MIN_LENGTH: 1,
  },
  API_KEY: {
    MIN_LENGTH: 32,
    PATTERN: /^[a-zA-Z0-9]{32,}$/,
  },
};

/**
 * Environment Constants
 * Environment-specific configurations
 */
export const ENVIRONMENT = {
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
  TEST: "test",
};

/**
 * Log Levels
 * Logging level constants
 */
export const LOG_LEVELS = {
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  HTTP: "http",
  VERBOSE: "verbose",
  DEBUG: "debug",
  SILLY: "silly",
};

/**
 * Health Check Constants
 * Health check status and thresholds
 */
export const HEALTH_CHECK = {
  STATUS: {
    HEALTHY: "healthy",
    UNHEALTHY: "unhealthy",
    DEGRADED: "degraded",
  },
  THRESHOLDS: {
    CPU_WARNING: 70, // 70%
    CPU_CRITICAL: 90, // 90%
    MEMORY_WARNING: 80, // 80%
    MEMORY_CRITICAL: 95, // 95%
    RESPONSE_TIME_WARNING: 1000, // 1 second
    RESPONSE_TIME_CRITICAL: 5000, // 5 seconds
  },
};

/**
 * Default Configuration Values
 * Default values for various configurations
 */
export const DEFAULTS = {
  PORT: 8001,
  MAX_SESSIONS_PER_WORKER: 50,
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  QR_CODE_TIMEOUT: 120000, // 2 minutes
  SESSION_TIMEOUT: 300000, // 5 minutes
  REQUEST_TIMEOUT: 30000, // 30 seconds
  UPLOAD_TIMEOUT: 60000, // 1 minute
};

/**
 * Regular Expressions
 * Common regex patterns used throughout the application
 */
export const REGEX = {
  PHONE_NUMBER: /^(\+?62|62|0)8[1-9][0-9]{6,11}$/,
  SESSION_ID: /^[a-zA-Z0-9_-]+$/,
  API_KEY: /^[a-zA-Z0-9]{32,}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  FILENAME: /^[a-zA-Z0-9._-]+$/,
  WHATSAPP_ID: /^[0-9]{10,15}@s\.whatsapp\.net$/,
};

/**
 * Time Constants
 * Time-related constants in milliseconds
 */
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Service Initialization Order
 * Order in which services should be initialized and shut down
 */
export const SERVICE_ORDER = {
  INIT: ["storage", "database", "redis", "baileys", "workerRegistry"],
  SHUTDOWN: ["workerRegistry", "baileys", "redis", "storage", "database"],
};

/**
 * Export all constants as a single object for convenience
 */
export default {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
  MESSAGE_TYPES,
  MESSAGE_STATUS,
  WORKER_STATUS,
  FILE_UPLOAD,
  RATE_LIMITS,
  PAGINATION,
  CACHE_TTL,
  RETRY_CONFIG,
  VALIDATION,
  ENVIRONMENT,
  LOG_LEVELS,
  HEALTH_CHECK,
  DEFAULTS,
  REGEX,
  TIME,
  SERVICE_ORDER,
};

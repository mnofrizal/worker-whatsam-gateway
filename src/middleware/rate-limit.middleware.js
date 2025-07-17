import rateLimit from "express-rate-limit";
import { ApiResponse } from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES, RATE_LIMITS } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Create rate limit handler with standardized response
 */
const createRateLimitHandler = (
  message = "Too many requests, please try again later"
) => {
  return (req, res) => {
    logger.warn("Rate limit exceeded", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
      method: req.method,
    });

    return res
      .status(HTTP_STATUS.TOO_MANY_REQUESTS)
      .json(ApiResponse.createRateLimitResponse(message));
  };
};

/**
 * General API Rate Limiting
 * Applied to all API endpoints
 */
export const generalRateLimit = rateLimit({
  windowMs: RATE_LIMITS.FREE_TIER.GENERAL.windowMs,
  max: RATE_LIMITS.FREE_TIER.GENERAL.max,
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: createRateLimitHandler(
    "Too many requests from this IP, please try again later"
  ),
  skip: (req) => {
    // Skip rate limiting for health checks
    return (
      req.path === "/health" || req.path === "/ready" || req.path === "/live"
    );
  },
  keyGenerator: (req) => {
    // Use IP address as the key, but consider X-Forwarded-For for proxied requests
    return req.ip || req.connection.remoteAddress;
  },
});

/**
 * Session Management Rate Limiting
 * More restrictive for session operations
 */
export const sessionRateLimit = rateLimit({
  windowMs: RATE_LIMITS.FREE_TIER.SESSION.windowMs,
  max: RATE_LIMITS.FREE_TIER.SESSION.max,
  message: "Too many session operations, please try again later",
  handler: createRateLimitHandler(
    "Too many session operations, please try again later"
  ),
  keyGenerator: (req) => {
    // Use IP + User ID if available for more granular limiting
    const userId = req.user?.id || req.headers["x-user-id"];
    return userId ? `${req.ip}-${userId}` : req.ip;
  },
});

/**
 * Message Sending Rate Limiting
 * Prevents spam and abuse
 */
export const messageRateLimit = rateLimit({
  windowMs: RATE_LIMITS.FREE_TIER.MESSAGE.windowMs,
  max: RATE_LIMITS.FREE_TIER.MESSAGE.max,
  message: "Message rate limit exceeded, please slow down",
  handler: createRateLimitHandler(
    "Message rate limit exceeded, please slow down"
  ),
  keyGenerator: (req) => {
    // Use session ID for per-session rate limiting
    const sessionId = req.params.sessionId || req.body.sessionId;
    return sessionId ? `msg-${sessionId}` : req.ip;
  },
});

/**
 * QR Code Generation Rate Limiting
 * Prevents excessive QR code requests
 */
export const qrCodeRateLimit = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 5, // 5 QR code requests per 2 minutes
  message: "QR code request rate limit exceeded, please try again later",
  handler: createRateLimitHandler(
    "QR code request rate limit exceeded, please try again later"
  ),
  keyGenerator: (req) => {
    const sessionId = req.params.sessionId;
    return sessionId ? `qr-${sessionId}` : req.ip;
  },
});

/**
 * File Upload Rate Limiting
 * Prevents excessive file uploads
 */
export const fileUploadRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 file uploads per 5 minutes
  message: "File upload rate limit exceeded, please try again later",
  handler: createRateLimitHandler(
    "File upload rate limit exceeded, please try again later"
  ),
  keyGenerator: (req) => {
    const sessionId = req.params.sessionId;
    return sessionId ? `upload-${sessionId}` : req.ip;
  },
});

/**
 * Authentication Rate Limiting
 * Prevents brute force attacks
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per 15 minutes
  message: "Too many authentication attempts, please try again later",
  handler: createRateLimitHandler(
    "Too many authentication attempts, please try again later"
  ),
  skipSuccessfulRequests: true, // Don't count successful requests
  keyGenerator: (req) => {
    // Use IP for auth attempts
    return req.ip;
  },
});

/**
 * Health Check Rate Limiting
 * Light rate limiting for health endpoints
 */
export const healthRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute (1 per second)
  message: "Health check rate limit exceeded",
  handler: createRateLimitHandler("Health check rate limit exceeded"),
  keyGenerator: (req) => {
    return req.ip;
  },
});

/**
 * Webhook Rate Limiting
 * For incoming webhook notifications
 */
export const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute
  message: "Webhook rate limit exceeded",
  handler: createRateLimitHandler("Webhook rate limit exceeded"),
  keyGenerator: (req) => {
    // Use source IP or webhook source identifier
    const webhookSource = req.headers["x-webhook-source"];
    return webhookSource ? `webhook-${webhookSource}` : req.ip;
  },
});

/**
 * Dynamic Rate Limiting based on user tier
 * Adjusts limits based on user subscription level
 */
export const createDynamicRateLimit = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: (req) => {
      // Default limits
      let maxRequests = options.defaultMax || 30;

      // Adjust based on user tier (if available)
      const userTier = req.user?.tier || req.headers["x-user-tier"];

      switch (userTier) {
        case "free":
          maxRequests = Math.floor(maxRequests * 0.5); // 50% of default
          break;
        case "pro":
          maxRequests = Math.floor(maxRequests * 2); // 200% of default
          break;
        case "premium":
          maxRequests = Math.floor(maxRequests * 5); // 500% of default
          break;
        default:
          // Use default
          break;
      }

      return maxRequests;
    },
    message:
      options.message || "Rate limit exceeded for your subscription tier",
    handler: createRateLimitHandler(
      options.message || "Rate limit exceeded for your subscription tier"
    ),
    keyGenerator: (req) => {
      const userId = req.user?.id || req.headers["x-user-id"];
      return userId ? `dynamic-${userId}` : req.ip;
    },
  });
};

/**
 * Rate Limiting Configuration
 * Export configuration for different environments
 */
export const rateLimitConfig = {
  development: {
    general: { windowMs: 15 * 60 * 1000, max: 1000 },
    session: { windowMs: 5 * 60 * 1000, max: 50 },
    message: { windowMs: 60 * 1000, max: 100 },
  },
  production: {
    general: { windowMs: 15 * 60 * 1000, max: 100 },
    session: { windowMs: 5 * 60 * 1000, max: 10 },
    message: { windowMs: 60 * 1000, max: 30 },
  },
};

/**
 * Get rate limit configuration for current environment
 */
export const getCurrentRateLimitConfig = () => {
  const env = process.env.NODE_ENV || "development";
  return rateLimitConfig[env] || rateLimitConfig.development;
};

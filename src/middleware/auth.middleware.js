import jwt from "jsonwebtoken";
import { ApiResponse } from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * JWT Authentication Middleware
 * Validates JWT tokens for API access
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    logger.warn("Authentication failed: No token provided", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json(ApiResponse.createUnauthorizedResponse("Access token required"));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn("Authentication failed: Invalid token", {
        error: err.message,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        path: req.path,
      });

      const message =
        err.name === "TokenExpiredError"
          ? "Token expired"
          : "Invalid or expired token";

      return res
        .status(HTTP_STATUS.FORBIDDEN)
        .json(ApiResponse.createUnauthorizedResponse(message));
    }

    req.user = user;
    next();
  });
};

/**
 * Worker Authentication Middleware
 * Validates worker tokens for internal communication
 */
export const authenticateWorker = (req, res, next) => {
  const workerToken = req.headers["x-worker-token"];

  if (!workerToken) {
    logger.warn("Worker authentication failed: No worker token provided", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json(ApiResponse.createUnauthorizedResponse("Worker token required"));
  }

  if (workerToken !== process.env.WORKER_AUTH_TOKEN) {
    logger.warn("Worker authentication failed: Invalid worker token", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json(ApiResponse.createUnauthorizedResponse("Invalid worker token"));
  }

  next();
};

/**
 * API Key Authentication Middleware
 * Validates API keys for external API access
 */
export const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    logger.warn("API key authentication failed: No API key provided", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json(ApiResponse.createUnauthorizedResponse("API key required"));
  }

  // TODO: Validate API key against database
  // For now, just check if it matches a basic pattern
  if (!/^[a-zA-Z0-9]{32,}$/.test(apiKey)) {
    logger.warn("API key authentication failed: Invalid API key format", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json(ApiResponse.createUnauthorizedResponse("Invalid API key"));
  }

  req.apiKey = apiKey;
  next();
};

/**
 * Optional Authentication Middleware
 * Validates token if present, but doesn't require it
 */
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (!err) {
      req.user = user;
    }
    next();
  });
};

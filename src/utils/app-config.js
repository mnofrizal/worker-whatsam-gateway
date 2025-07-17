import multer from "multer";
import config from "../config/environment.js";
import logger from "./logger.js";
import { ApiResponse } from "./helpers.js";

/**
 * Application Configuration Utilities
 * Factory functions for creating middleware configurations
 */

/**
 * Create Helmet security configuration
 * @returns {Object} Helmet configuration object
 */
export const createHelmetConfig = () => ({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
});

/**
 * Create CORS configuration
 * @returns {Object} CORS configuration object
 */
export const createCorsConfig = () => ({
  origin: config.security.corsOrigin,
  credentials: true,
});

/**
 * Create Multer file upload configuration
 * @returns {Object} Multer configuration object
 */
export const createMulterConfig = () => ({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.fileUpload.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (config.fileUpload.allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error(`File type ${file.mimetype} not allowed`);
      error.code = "INVALID_FILE_TYPE";
      cb(error, false);
    }
  },
});

/**
 * Create root route handler
 * @returns {Function} Express middleware function
 */
export const createRootRouteHandler = () => (req, res) => {
  const response = ApiResponse.createSuccessResponse(
    {
      name: "WhatsApp Gateway Worker",
      version: process.env.npm_package_version || "1.0.0",
      workerId: config.server.workerId,
      status: "running",
      uptime: process.uptime(),
      environment: config.server.nodeEnv,
      maxSessions: config.server.maxSessions,
      endpoint: config.server.workerEndpoint,
    },
    "WhatsApp Gateway Worker is running"
  );
  res.json(response);
};

/**
 * Create 404 error handler
 * @returns {Function} Express middleware function
 */
export const create404Handler = () => (req, res) => {
  logger.warn("404 - Endpoint not found", {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
  });

  const response = ApiResponse.createNotFoundResponse(
    `Endpoint not found: ${req.method} ${req.originalUrl}`
  );
  res.status(404).json(response);
};

/**
 * Create request logger middleware
 * @returns {Function} Express middleware function
 */
export const createRequestLogger = () => (req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });
  next();
};

/**
 * Create service injection middleware
 * @param {Object} services - Services object to inject
 * @returns {Function} Express middleware function
 */
export const createServiceInjector = (services) => (req, res, next) => {
  req.services = services;
  next();
};

export default {
  createHelmetConfig,
  createCorsConfig,
  createMulterConfig,
  createRootRouteHandler,
  create404Handler,
  createRequestLogger,
  createServiceInjector,
};

import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";

import config from "./config/environment.js";
import logger from "./utils/logger.js";
import { ApiResponse } from "./utils/helpers.js";
import errorHandler from "./middleware/error-handler.middleware.js";
import { generalRateLimit } from "./middleware/rate-limit.middleware.js";

// Import services
import BaileysService from "./services/baileys.service.js";
import StorageService from "./services/storage.service.js";
import DatabaseService from "./services/database.service.js";
import RedisService from "./services/redis.service.js";
import WorkerRegistryService from "./services/worker-registry.service.js";

// Import controllers
import SessionController from "./controllers/session.controller.js";
import MessageController from "./controllers/message.controller.js";
import HealthController from "./controllers/health.controller.js";

// Application state
const appState = {
  app: null,
  server: null,
  services: {},
  controllers: {},
  isShuttingDown: false,
};

// Constants
const PORT = config.server.port;
const SERVICE_INIT_ORDER = [
  "storage",
  "database",
  "redis",
  "baileys",
  "workerRegistry",
];
const SHUTDOWN_ORDER = [
  "workerRegistry",
  "baileys",
  "redis",
  "storage",
  "database",
];

// ===== UTILITY FUNCTIONS =====

const createServiceInstances = () => ({
  baileys: new BaileysService(),
  storage: new StorageService(),
  database: new DatabaseService(),
  redis: new RedisService(),
  workerRegistry: new WorkerRegistryService(),
});

const createControllerInstances = (services) => ({
  session: new SessionController(
    services.baileys,
    services.storage,
    services.database,
    services.redis,
    services.workerRegistry
  ),
  message: new MessageController(
    services.baileys,
    services.storage,
    services.database,
    services.redis,
    services.workerRegistry
  ),
  health: new HealthController(
    services.baileys,
    services.storage,
    services.database,
    services.redis,
    services.workerRegistry
  ),
});

const createHelmetConfig = () => ({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
});

const createCorsConfig = () => ({
  origin: config.security.corsOrigin,
  credentials: true,
});

const createMulterConfig = () => ({
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

const createRootRouteHandler = () => (req, res) => {
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

const create404Handler = () => (req, res) => {
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

const createRequestLogger = () => (req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });
  next();
};

// ===== INITIALIZATION FUNCTIONS =====

const initializeServices = () => {
  logger.info("Initializing services...");
  appState.services = createServiceInstances();
  global.services = appState.services;
};

const initializeControllers = () => {
  logger.info("Initializing controllers...");
  appState.controllers = createControllerInstances(appState.services);
  global.controllers = appState.controllers;
};

const setupSecurityMiddleware = () => {
  if (config.production.enableHelmet) {
    appState.app.use(helmet(createHelmetConfig()));
  }

  if (config.development.enableCors) {
    appState.app.use(cors(createCorsConfig()));
  }

  if (config.security.trustProxy) {
    appState.app.set("trust proxy", true);
  }
};

const setupRateLimiting = () => {
  const rateLimitingEnabled =
    config.server.nodeEnv === "production" &&
    process.env.RATE_LIMITING_ENABLED !== "false";

  if (rateLimitingEnabled) {
    appState.app.use(generalRateLimit);
    logger.info("Rate limiting enabled");
  } else {
    logger.info(
      `Rate limiting disabled (NODE_ENV: ${config.server.nodeEnv}, RATE_LIMITING_ENABLED: ${process.env.RATE_LIMITING_ENABLED || "not set"})`
    );
  }
};

const setupBodyParsing = () => {
  const jsonConfig = { limit: config.fileUpload.maxRequestSize };
  const urlencodedConfig = {
    extended: true,
    limit: config.fileUpload.maxRequestSize,
  };

  appState.app.use(express.json(jsonConfig));
  appState.app.use(express.urlencoded(urlencodedConfig));
};

const setupFileUpload = () => {
  const upload = multer(createMulterConfig());
  global.upload = upload;
};

const setupMiddleware = () => {
  setupSecurityMiddleware();
  setupRateLimiting();
  setupBodyParsing();
  setupFileUpload();
  appState.app.use(createRequestLogger());
};

const setupHealthEndpoints = () => {
  const { health } = appState.controllers;
  appState.app.get("/health", health.getHealth.bind(health));
  appState.app.get("/metrics", health.getMetrics.bind(health));
  appState.app.get("/ready", health.getReadiness.bind(health));
  appState.app.get("/live", health.getLiveness.bind(health));
};

const setupRoutes = async () => {
  const { default: routes } = await import("./routes/index.js");

  appState.app.get("/", createRootRouteHandler());
  appState.app.use("/api", routes);
  setupHealthEndpoints();
  appState.app.use("*", create404Handler());
};

const setupErrorHandling = () => {
  appState.app.use(errorHandler);
};

// ===== SERVICE MANAGEMENT =====

const initializeAllServices = async () => {
  logger.info("Initializing all services...");

  try {
    for (const serviceName of SERVICE_INIT_ORDER) {
      await appState.services[serviceName].initialize();
      logger.info(`${serviceName} service initialized`);
    }

    // Set service dependencies
    appState.services.workerRegistry.setServices(appState.services.baileys);
    logger.info("Worker Registry service dependencies set");
    logger.info("All services initialized successfully");
  } catch (error) {
    logger.error("Service initialization failed:", error);
    throw error;
  }
};

const shutdownAllServices = async () => {
  logger.info("Shutting down services...");

  for (const serviceName of SHUTDOWN_ORDER) {
    const service = appState.services[serviceName];
    if (service) {
      try {
        if (service.shutdown) {
          await service.shutdown();
        } else if (service.close) {
          await service.close();
        }
        logger.info(`${serviceName} service shut down`);
      } catch (error) {
        logger.error(`Error shutting down ${serviceName} service:`, error);
      }
    }
  }
};

// ===== BACKEND INTEGRATION =====

const registerWithBackend = async () => {
  if (!config.backend.url) {
    logger.warn("BACKEND_URL not configured, skipping worker registration");
    return null;
  }

  try {
    logger.info("Starting worker registration with backend", {
      backendUrl: config.backend.url,
      workerId: config.server.workerId,
    });

    return await appState.services.workerRegistry.startRegistration();
  } catch (error) {
    logger.error("Failed to register with backend:", error);

    if (config.server.nodeEnv === "production") {
      throw error;
    }
    return null;
  }
};

const startSessionRecovery = async () => {
  try {
    logger.info("Starting session recovery process...");

    if (!config.sessionRecovery.enabled) {
      logger.info("Session recovery disabled, skipping recovery process");
      return;
    }

    if (!appState.services.workerRegistry.isInitialized()) {
      logger.warn("Worker registry not initialized, skipping session recovery");
      return;
    }

    if (!appState.services.workerRegistry.isRecoveryRequired()) {
      logger.info(
        "Backend indicates no recovery required, skipping session recovery"
      );
      return;
    }

    const recoveryDelay = config.sessionRecovery.startupDelay;
    logger.info(
      `Waiting ${recoveryDelay}ms before starting session recovery...`
    );
    await new Promise((resolve) => setTimeout(resolve, recoveryDelay));

    const recoveryResult =
      await appState.services.baileys.loadPersistedSessions();

    if (recoveryResult.success) {
      logger.info("Session recovery completed successfully", {
        totalSessions: recoveryResult.totalSessions,
        recoveredSessions: recoveryResult.recoveredSessions,
        failedSessions: recoveryResult.failedSessions,
      });
    } else {
      logger.warn("Session recovery completed with issues", recoveryResult);
    }
  } catch (error) {
    logger.error("Session recovery process failed:", error);
    logger.warn("Worker will continue without session recovery");
  }
};

// ===== SHUTDOWN MANAGEMENT =====

const gracefulShutdown = async (signal) => {
  if (appState.isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring signal:", signal);
    return;
  }

  appState.isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    if (appState.server) {
      appState.server.close(() => {
        logger.info("HTTP server closed");
      });
    }

    await shutdownAllServices();
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

const setupGracefulShutdown = () => {
  const signals = ["SIGTERM", "SIGINT"];
  signals.forEach((signal) => {
    process.on(signal, () => gracefulShutdown(signal));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);
    gracefulShutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    gracefulShutdown("UNHANDLED_REJECTION");
  });
};

const startServer = () => {
  return new Promise((resolve, reject) => {
    appState.server = appState.app.listen(PORT, (error) => {
      if (error) {
        reject(error);
      } else {
        logger.info(`WhatsApp Worker started on port ${PORT}`, {
          workerId: config.server.workerId,
          environment: config.server.nodeEnv,
          maxSessions: config.server.maxSessions,
          endpoint: config.server.workerEndpoint,
        });
        resolve();
      }
    });
  });
};

// ===== MAIN APPLICATION FLOW =====

const start = async () => {
  try {
    // Initialize Express app
    appState.app = express();

    // Initialize services and controllers
    initializeServices();
    setupMiddleware();
    setupErrorHandling();

    // Initialize all services
    await initializeAllServices();
    initializeControllers();

    // Setup routes and start server
    await setupRoutes();
    await startServer();

    // Post-startup tasks
    await registerWithBackend();
    await startSessionRecovery();
    setupGracefulShutdown();
  } catch (error) {
    logger.error("Failed to start WhatsApp Worker:", error);
    process.exit(1);
  }
};

// ===== APPLICATION ENTRY POINT =====

start().catch((error) => {
  logger.error("Failed to start worker:", error);
  process.exit(1);
});

// ===== EXPORTS =====

export {
  start,
  setupMiddleware,
  setupRoutes,
  initializeServices,
  initializeControllers,
  initializeAllServices,
  registerWithBackend,
  startSessionRecovery,
  setupGracefulShutdown,
};

export const { app, services, controllers } = appState;

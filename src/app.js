import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";

import config from "./config/environment.js";
import logger from "./utils/logger.js";
import { SERVICE_ORDER } from "./utils/constants.js";
import {
  createHelmetConfig,
  createCorsConfig,
  createMulterConfig,
  createRootRouteHandler,
  create404Handler,
  createRequestLogger,
  createServiceInjector,
} from "./utils/app-config.js";
import errorHandler from "./middleware/error-handler.middleware.js";
import { generalRateLimit } from "./middleware/rate-limit.middleware.js";

// Import services as modules
import baileysService from "./services/baileys.service.js";
import storageService from "./services/storage.service.js";
import databaseService from "./services/database.service.js";
import redisService from "./services/redis.service.js";
import workerRegistryService from "./services/worker-registry.service.js";

// Import routes
import apiRoutes from "./routes/index.js";
import healthRoutes from "./routes/health.routes.js";

const appState = {
  app: null,
  server: null,
  services: {
    baileys: baileysService,
    storage: storageService,
    database: databaseService,
    redis: redisService,
    workerRegistry: workerRegistryService,
  },
  isShuttingDown: false,
};

const PORT = config.server.port;

const setupMiddleware = () => {
  if (config.production.enableHelmet) {
    appState.app.use(helmet(createHelmetConfig()));
  }
  if (config.development.enableCors) {
    appState.app.use(cors(createCorsConfig()));
  }
  if (config.security.trustProxy) {
    appState.app.set("trust proxy", true);
  }

  const rateLimitingEnabled =
    config.server.nodeEnv === "production" &&
    process.env.RATE_LIMITING_ENABLED !== "false";

  if (rateLimitingEnabled) {
    appState.app.use(generalRateLimit);
    logger.info("Rate limiting enabled");
  } else {
    logger.info(
      `Rate limiting disabled (NODE_ENV: ${config.server.nodeEnv}, RATE_LIMITING_ENABLED: ${
        process.env.RATE_LIMITING_ENABLED || "not set"
      })`
    );
  }

  appState.app.use(express.json({ limit: config.fileUpload.maxRequestSize }));
  appState.app.use(
    express.urlencoded({
      extended: true,
      limit: config.fileUpload.maxRequestSize,
    })
  );

  const upload = multer(createMulterConfig());
  appState.app.use((req, res, next) => {
    req.upload = upload;
    next();
  });

  appState.app.use(createRequestLogger());

  // Inject services into all requests
  appState.app.use(createServiceInjector(appState.services));
};

const setupRoutes = async () => {
  // Root route
  appState.app.get("/", createRootRouteHandler());

  // API routes with services injected via middleware
  appState.app.use("/api", apiRoutes);

  // Direct health endpoints for backend compatibility (backend expects these at root level)
  appState.app.use("/health", healthRoutes);
  appState.app.use("/metrics", healthRoutes);
  appState.app.use("/ready", healthRoutes);
  appState.app.use("/live", healthRoutes);

  // 404 handler
  appState.app.use("*", create404Handler());
};

const setupErrorHandling = () => {
  appState.app.use(errorHandler);
};

const initializeAllServices = async () => {
  logger.info("Initializing all services...");

  try {
    for (const serviceName of SERVICE_ORDER.INIT) {
      await appState.services[serviceName].initialize();
      logger.info(`${serviceName} service initialized`);
    }

    // Set service dependencies
    appState.services.workerRegistry.setServices(appState.services);
    appState.services.baileys.setServices(appState.services);

    logger.info("All services initialized successfully");
  } catch (error) {
    logger.error("Service initialization failed:", error);
    throw error;
  }
};

const shutdownAllServices = async () => {
  logger.info("Shutting down services...");

  for (const serviceName of SERVICE_ORDER.SHUTDOWN) {
    const service = appState.services[serviceName];
    if (service && service.shutdown) {
      try {
        await service.shutdown();
        logger.info(`${serviceName} service shut down`);
      } catch (error) {
        logger.error(`Error shutting down ${serviceName} service:`, error);
      }
    } else if (service && service.close) {
      try {
        await service.close();
        logger.info(`${serviceName} service shut down`);
      } catch (error) {
        logger.error(`Error shutting down ${serviceName} service:`, error);
      }
    }
  }
};

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

const gracefulShutdown = async (signal) => {
  if (appState.isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring signal:", signal);
    return;
  }

  appState.isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
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

const start = async () => {
  try {
    appState.app = express();
    setupMiddleware();
    setupErrorHandling();
    await initializeAllServices();
    await setupRoutes();
    await startServer();
    await registerWithBackend();
    await startSessionRecovery();
    setupGracefulShutdown();
  } catch (error) {
    logger.error("Failed to start WhatsApp Worker:", error);
    process.exit(1);
  }
};

start().catch((error) => {
  logger.error("Failed to start worker:", error);
  process.exit(1);
});

export { start, appState as appDetails };

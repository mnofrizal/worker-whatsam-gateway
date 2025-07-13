import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";

import config from "./config/environment.js";
import logger from "./utils/logger.js";
import { ApiResponse, Utils } from "./utils/helpers.js";
import errorHandler from "./middleware/error-handler.middleware.js";
import { generalRateLimit } from "./middleware/rate-limit.middleware.js";
// Routes will be imported after middleware setup

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

class WhatsAppWorker {
  constructor() {
    this.app = express();
    this.config = config;
    this.port = config.server.port;
    this.services = {};
    this.controllers = {};

    this.initializeServices();
    this.setupMiddleware();
    this.setupErrorHandling();
  }

  initializeServices() {
    logger.info("Initializing services...");

    // Initialize core services
    this.services.baileys = new BaileysService();
    this.services.storage = new StorageService();
    this.services.database = new DatabaseService();
    this.services.redis = new RedisService();
    this.services.workerRegistry = new WorkerRegistryService();

    // Make services available globally for cross-service communication
    global.services = this.services;
  }

  initializeControllers() {
    logger.info("Initializing controllers...");

    // Initialize controllers with service dependencies
    this.controllers.session = new SessionController(
      this.services.baileys,
      this.services.storage,
      this.services.database,
      this.services.redis,
      this.services.workerRegistry
    );

    this.controllers.message = new MessageController(
      this.services.baileys,
      this.services.storage,
      this.services.database,
      this.services.redis,
      this.services.workerRegistry
    );

    this.controllers.health = new HealthController(
      this.services.baileys,
      this.services.storage,
      this.services.database,
      this.services.redis,
      this.services.workerRegistry
    );

    // Make controllers available globally for routes
    global.controllers = this.controllers;
  }

  setupMiddleware() {
    // Security middleware
    if (this.config.production.enableHelmet) {
      this.app.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'"],
              imgSrc: ["'self'", "data:", "https:"],
            },
          },
        })
      );
    }

    // CORS configuration
    if (this.config.development.enableCors) {
      this.app.use(
        cors({
          origin: this.config.security.corsOrigin,
          credentials: true,
        })
      );
    }

    // Trust proxy if configured
    if (this.config.security.trustProxy) {
      this.app.set("trust proxy", true);
    }

    // Rate limiting
    this.app.use(generalRateLimit);

    // Body parsing middleware
    this.app.use(
      express.json({
        limit: this.config.fileUpload.maxRequestSize,
      })
    );
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: this.config.fileUpload.maxRequestSize,
      })
    );

    // File upload middleware
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: this.config.fileUpload.maxFileSize,
      },
      fileFilter: (req, file, cb) => {
        if (this.config.fileUpload.allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          const error = new Error(`File type ${file.mimetype} not allowed`);
          error.code = "INVALID_FILE_TYPE";
          cb(error, false);
        }
      },
    });

    // Make upload middleware available globally
    global.upload = upload;

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });
      next();
    });
  }

  async setupRoutes() {
    // Import routes after middleware is set up
    const { default: routes } = await import("./routes/index.js");

    // Root route
    this.app.get("/", (req, res) => {
      const response = ApiResponse.createSuccessResponse(
        {
          name: "WhatsApp Gateway Worker",
          version: process.env.npm_package_version || "1.0.0",
          workerId: this.config.server.workerId,
          status: "running",
          uptime: process.uptime(),
          environment: this.config.server.nodeEnv,
          maxSessions: this.config.server.maxSessions,
          endpoint: this.config.server.workerEndpoint,
        },
        "WhatsApp Gateway Worker is running"
      );

      res.json(response);
    });

    // API routes
    this.app.use("/api", routes);

    // Direct health endpoints (for load balancers)
    this.app.get(
      "/health",
      this.controllers.health.getHealth.bind(this.controllers.health)
    );
    this.app.get(
      "/metrics",
      this.controllers.health.getMetrics.bind(this.controllers.health)
    );
    this.app.get(
      "/ready",
      this.controllers.health.getReadiness.bind(this.controllers.health)
    );
    this.app.get(
      "/live",
      this.controllers.health.getLiveness.bind(this.controllers.health)
    );

    // 404 handler
    this.app.use("*", (req, res) => {
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
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);
  }

  async start() {
    try {
      // Initialize services
      await this.initializeAllServices();

      // Initialize controllers
      this.initializeControllers();

      // Setup routes after controllers are ready
      await this.setupRoutes();

      // Start server and wait for it to be ready
      await new Promise((resolve, reject) => {
        this.server = this.app.listen(this.port, (error) => {
          if (error) {
            reject(error);
          } else {
            logger.info(`WhatsApp Worker started on port ${this.port}`, {
              workerId: this.config.server.workerId,
              environment: this.config.server.nodeEnv,
              maxSessions: this.config.server.maxSessions,
              endpoint: this.config.server.workerEndpoint,
            });
            resolve();
          }
        });
      });

      // Register worker with backend AFTER server is listening
      await this.registerWithBackend();

      // Start session recovery process AFTER worker registration
      await this.startSessionRecovery();

      // Setup graceful shutdown
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error("Failed to start WhatsApp Worker:", error);
      process.exit(1);
    }
  }

  async initializeAllServices() {
    logger.info("Initializing all services...");

    try {
      // Initialize storage service
      await this.services.storage.initialize();
      logger.info("Storage service initialized");

      // Initialize database service
      await this.services.database.initialize();
      logger.info("Database service initialized");

      // Initialize Redis service
      await this.services.redis.initialize();
      logger.info("Redis service initialized");

      // Initialize Baileys service
      await this.services.baileys.initialize();
      logger.info("Baileys service initialized");

      // Initialize Worker Registry service
      await this.services.workerRegistry.initialize();
      logger.info("Worker Registry service initialized");

      // Set service dependencies for Worker Registry
      this.services.workerRegistry.setServices(this.services.baileys);
      logger.info("Worker Registry service dependencies set");

      logger.info("All services initialized successfully");
    } catch (error) {
      logger.error("Service initialization failed:", error);
      throw error;
    }
  }

  async registerWithBackend() {
    try {
      if (this.config.backend.url) {
        // Start worker registration after server is listening
        logger.info("Starting worker registration with backend", {
          backendUrl: this.config.backend.url,
          workerId: this.config.server.workerId,
        });

        const registrationResult =
          await this.services.workerRegistry.startRegistration();
        return registrationResult;
      } else {
        logger.warn("BACKEND_URL not configured, skipping worker registration");
        return null;
      }
    } catch (error) {
      logger.error("Failed to register with backend:", error);
      // Don't exit on registration failure in development
      if (this.config.server.nodeEnv === "production") {
        throw error;
      }
      return null;
    }
  }

  async startSessionRecovery() {
    try {
      logger.info("Starting session recovery process...");

      // Check if session recovery is enabled
      if (!this.config.sessionRecovery.enabled) {
        logger.info("Session recovery disabled, skipping recovery process");
        return;
      }

      // Only attempt recovery if backend registration was successful
      if (!this.services.workerRegistry.isInitialized()) {
        logger.warn(
          "Worker registry not initialized, skipping session recovery"
        );
        return;
      }

      // Check if recovery is required from backend response
      if (!this.services.workerRegistry.isRecoveryRequired()) {
        logger.info(
          "Backend indicates no recovery required, skipping session recovery"
        );
        return;
      }

      // Add delay to allow backend to be fully ready
      const recoveryDelay = this.config.sessionRecovery.startupDelay;
      logger.info(
        `Waiting ${recoveryDelay}ms before starting session recovery...`
      );
      await new Promise((resolve) => setTimeout(resolve, recoveryDelay));

      // Start session recovery
      const recoveryResult =
        await this.services.baileys.loadPersistedSessions();

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
      // Don't throw error to allow worker to continue without recovery
      logger.warn("Worker will continue without session recovery");
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      try {
        // Stop accepting new connections
        if (this.server) {
          this.server.close(() => {
            logger.info("HTTP server closed");
          });
        }

        // Shutdown services in reverse order
        if (this.services.workerRegistry) {
          await this.services.workerRegistry.shutdown();
        }

        if (this.services.baileys) {
          await this.services.baileys.shutdown();
        }

        if (this.services.redis) {
          await this.services.redis.close();
        }

        if (this.services.storage) {
          await this.services.storage.close();
        }

        if (this.services.database) {
          await this.services.database.close();
        }

        logger.info("Graceful shutdown completed");
        process.exit(0);
      } catch (error) {
        logger.error("Error during shutdown:", error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      shutdown("UNHANDLED_REJECTION");
    });
  }
}

// Start the worker
const worker = new WhatsAppWorker();
worker.start().catch((error) => {
  logger.error("Failed to start worker:", error);
  process.exit(1);
});

export default WhatsAppWorker;

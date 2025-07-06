import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  HEALTH_CHECK,
  WORKER_STATUS,
  SESSION_STATUS,
} from "../utils/constants.js";

class HealthController {
  constructor(
    baileysService,
    storageService,
    databaseService,
    redisService,
    workerRegistryService
  ) {
    this.baileysService = baileysService;
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.redisService = redisService;
    this.workerRegistryService = workerRegistryService;
    this.startTime = Date.now();
  }

  async getHealth(req, res) {
    try {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Get session statistics
      const sessionStats = this.baileysService.getSessionStatistics();

      // Check service health
      const serviceHealth = {
        baileys: true, // Always true if we can get sessions
        storage: this.storageService.isInitialized(),
        database: this.databaseService.isInitialized(),
        redis: this.redisService.isInitialized(),
        workerRegistry: this.workerRegistryService.isInitialized(),
      };

      // Determine overall health status
      const criticalServices = ["baileys"];
      const isHealthy = criticalServices.every(
        (service) => serviceHealth[service]
      );
      const status = isHealthy
        ? HEALTH_CHECK.STATUS.HEALTHY
        : HEALTH_CHECK.STATUS.UNHEALTHY;

      const healthData = {
        status,
        workerId: this.workerRegistryService.getWorkerId(),
        endpoint: this.workerRegistryService.getWorkerEndpoint(),
        uptime,
        timestamp: new Date().toISOString(),
        sessions: {
          total: sessionStats.total,
          connected: sessionStats.connected,
          disconnected: sessionStats.disconnected,
          initializing: sessionStats.initializing,
          qr_required: sessionStats.qr_required,
          reconnecting: sessionStats.reconnecting,
          error: sessionStats.error,
          maxSessions: parseInt(process.env.MAX_SESSIONS) || 50,
        },
        resources: {
          memory: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
            external: Math.round(memoryUsage.external / 1024 / 1024), // MB
            usage: Math.round(
              (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
            ), // %
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
          },
        },
        services: serviceHealth,
        version: process.env.npm_package_version || "1.0.0",
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };

      // Set appropriate HTTP status code
      const httpStatus = isHealthy
        ? HTTP_STATUS.OK
        : HTTP_STATUS.SERVICE_UNAVAILABLE;

      res.status(httpStatus).json(healthData);
    } catch (error) {
      logger.error("Error in health check:", error);
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json(
        ApiResponse.createErrorResponse(
          "HEALTH_CHECK_FAILED",
          "Health check failed",
          {
            status: HEALTH_CHECK.STATUS.UNHEALTHY,
            timestamp: new Date().toISOString(),
          }
        )
      );
    }
  }

  async getMetrics(req, res) {
    try {
      // Get detailed metrics from worker registry service
      const metrics = await this.workerRegistryService.getWorkerMetrics();

      // Add additional metrics
      const sessions = this.baileysService.getAllSessions();
      const sessionDetails = [];

      for (const [sessionId, sessionInfo] of sessions) {
        sessionDetails.push({
          sessionId,
          status: sessionInfo.status,
          phoneNumber: sessionInfo.phoneNumber || null,
          lastSeen: sessionInfo.lastSeen || null,
          uptime: sessionInfo.connectedAt
            ? Date.now() - new Date(sessionInfo.connectedAt).getTime()
            : 0,
        });
      }

      // Get message statistics if database is available
      let messageStats = null;
      if (this.databaseService.isInitialized()) {
        try {
          const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
          messageStats =
            await this.databaseService.getGlobalMessageStats(last24h);
        } catch (error) {
          logger.warn("Failed to get message statistics:", error);
        }
      }

      const detailedMetrics = {
        ...metrics,
        sessionDetails,
        messageStats,
        performance: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          eventLoopDelay: process.hrtime.bigint
            ? Number(process.hrtime.bigint())
            : null,
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
        },
      };

      res
        .status(HTTP_STATUS.OK)
        .json(ApiResponse.createSuccessResponse(detailedMetrics));
    } catch (error) {
      logger.error("Error getting metrics:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(ApiResponse.createInternalErrorResponse("Failed to get metrics"));
    }
  }

  async getReadiness(req, res) {
    try {
      // Check if worker is ready to accept requests
      const isReady = this.baileysService !== null;

      // Check if critical services are available
      const criticalServicesReady = {
        baileys: isReady,
        storage: this.storageService.isInitialized(),
        // Database and Redis are not critical for basic functionality
      };

      const allCriticalReady = Object.values(criticalServicesReady).every(
        (ready) => ready
      );

      const readinessData = {
        ready: allCriticalReady,
        services: criticalServicesReady,
        timestamp: new Date().toISOString(),
      };

      const httpStatus = allCriticalReady
        ? HTTP_STATUS.OK
        : HTTP_STATUS.SERVICE_UNAVAILABLE;
      res.status(httpStatus).json(readinessData);
    } catch (error) {
      logger.error("Error in readiness check:", error);
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        ready: false,
        error: "Readiness check failed",
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getLiveness(req, res) {
    try {
      // Simple liveness check - if we can respond, we're alive
      res.status(HTTP_STATUS.OK).json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid,
      });
    } catch (error) {
      logger.error("Error in liveness check:", error);
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        alive: false,
        error: "Liveness check failed",
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getServiceStatus(req, res) {
    try {
      const services = {
        baileys: {
          status: HEALTH_CHECK.STATUS.HEALTHY,
          initialized: true,
          sessions: this.baileysService.getSessionCount(),
          details: "WhatsApp connection service",
        },
        storage: {
          status: this.storageService.isInitialized()
            ? HEALTH_CHECK.STATUS.HEALTHY
            : "unavailable",
          initialized: this.storageService.isInitialized(),
          details: "MinIO object storage service",
        },
        database: {
          status: this.databaseService.isInitialized()
            ? HEALTH_CHECK.STATUS.HEALTHY
            : "unavailable",
          initialized: this.databaseService.isInitialized(),
          details: "PostgreSQL database service",
        },
        redis: {
          status: this.redisService.isInitialized()
            ? HEALTH_CHECK.STATUS.HEALTHY
            : "unavailable",
          initialized: this.redisService.isInitialized(),
          details: "Redis caching service",
        },
        workerRegistry: {
          status: this.workerRegistryService.isInitialized()
            ? HEALTH_CHECK.STATUS.HEALTHY
            : "unavailable",
          initialized: this.workerRegistryService.isInitialized(),
          details: "Backend worker registry service",
        },
      };

      // Test service connections
      for (const [serviceName, serviceInfo] of Object.entries(services)) {
        if (serviceInfo.initialized) {
          try {
            // Perform basic health check for each service
            switch (serviceName) {
              case "database":
                if (this.databaseService.isInitialized()) {
                  await this.databaseService.testConnection();
                }
                break;
              case "redis":
                if (this.redisService.isInitialized()) {
                  await this.redisService.get("health-check");
                }
                break;
              case "storage":
                // MinIO health check would go here if needed
                break;
            }
          } catch (error) {
            services[serviceName].status = "error";
            services[serviceName].error = error.message;
          }
        }
      }

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          services,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      logger.error("Error getting service status:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse(
            "Failed to get service status"
          )
        );
    }
  }
}

export default HealthController;

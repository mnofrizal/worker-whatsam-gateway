import logger from "../utils/logger.js";
import { ApiResponse } from "../utils/helpers.js";
import { HTTP_STATUS, HEALTH_CHECK } from "../utils/constants.js";

const startTime = Date.now();

const getHealth = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      storage: storageService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
    } = req.services;

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const sessionStats = baileysService.getSessionStatistics();

    const serviceHealth = {
      baileys: true, // Assuming baileys is always critical
      storage: storageService.isInitialized(),
      database: databaseService.isInitialized(),
      redis: redisService.isInitialized(),
      workerRegistry: workerRegistryService.isInitialized(),
    };

    const isHealthy = serviceHealth.baileys; // Only Baileys is critical for basic health
    const status = isHealthy
      ? HEALTH_CHECK.STATUS.HEALTHY
      : HEALTH_CHECK.STATUS.UNHEALTHY;

    const healthData = {
      status,
      workerId: workerRegistryService.getWorkerId(),
      endpoint: workerRegistryService.getWorkerEndpoint(),
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
};

const getMetrics = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      workerRegistry: workerRegistryService,
    } = req.services;

    const metrics = await workerRegistryService.getWorkerMetrics();
    const sessions = baileysService.getAllSessions();
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

    let messageStats = null;
    if (databaseService.isInitialized()) {
      try {
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        messageStats = await databaseService.getGlobalMessageStats(last24h);
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
};

const getReadiness = async (req, res) => {
  try {
    const { baileys: baileysService, storage: storageService } = req.services;
    const isReady = baileysService !== null;

    const criticalServicesReady = {
      baileys: isReady,
      storage: storageService.isInitialized(),
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
};

const getLiveness = async (req, res) => {
  try {
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
};

const getServiceStatus = async (req, res) => {
  try {
    const {
      storage: storageService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
      baileys: baileysService,
    } = req.services;

    const serviceStatus = {
      baileys: {
        status: HEALTH_CHECK.STATUS.HEALTHY,
        initialized: true,
        sessions: baileysService.getSessionCount(),
        details: "WhatsApp connection service",
      },
      storage: {
        status: storageService.isInitialized()
          ? HEALTH_CHECK.STATUS.HEALTHY
          : "unavailable",
        initialized: storageService.isInitialized(),
        details: "MinIO object storage service",
      },
      database: {
        status: databaseService.isInitialized()
          ? HEALTH_CHECK.STATUS.HEALTHY
          : "unavailable",
        initialized: databaseService.isInitialized(),
        details: "PostgreSQL database service",
      },
      redis: {
        status: redisService.isInitialized()
          ? HEALTH_CHECK.STATUS.HEALTHY
          : "unavailable",
        initialized: redisService.isInitialized(),
        details: "Redis caching service",
      },
      workerRegistry: {
        status: workerRegistryService.isInitialized()
          ? HEALTH_CHECK.STATUS.HEALTHY
          : "unavailable",
        initialized: workerRegistryService.isInitialized(),
        details: "Backend worker registry service",
      },
    };

    for (const [serviceName, serviceInfo] of Object.entries(serviceStatus)) {
      if (serviceInfo.initialized) {
        try {
          switch (serviceName) {
            case "database":
              if (databaseService.isInitialized()) {
                await databaseService.testConnection(); // Assuming this method exists
              }
              break;
            case "redis":
              if (redisService.isInitialized()) {
                await redisService.get("health-check");
              }
              break;
          }
        } catch (error) {
          serviceStatus[serviceName].status = "error";
          serviceStatus[serviceName].error = error.message;
        }
      }
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        services: serviceStatus,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    logger.error("Error getting service status:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to get service status")
      );
  }
};

export { getHealth, getMetrics, getReadiness, getLiveness, getServiceStatus };

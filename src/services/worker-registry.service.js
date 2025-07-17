import axios from "axios";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

let baileysService = null;
let heartbeatInterval = null;
let initialized = false;
let registrationRetries = 0;
let recoveryRequired = false;

const serviceConfig = {
  backendUrl: config.backend.url,
  workerId: config.server.workerId,
  workerEndpoint: config.server.workerEndpoint,
  maxSessions: config.server.maxSessions,
  workerAuthToken: config.backend.workerAuthToken,
  heartbeatIntervalMs: config.backend.heartbeatInterval,
  maxRegistrationRetries: config.backend.maxRegistrationRetries,
  registrationRetryInterval: config.backend.registrationRetryInterval,
};

const setServices = (services) => {
  baileysService = services.baileys;
};

const initialize = async () => {
  try {
    logger.info("Initializing Worker Registry service...");

    if (
      process.env.BACKEND_REGISTRATION_ENABLED === "false" ||
      process.env.STANDALONE_MODE === "true"
    ) {
      logger.info(
        "Backend registration disabled (standalone mode), worker registry will be disabled"
      );
      return;
    }

    if (!serviceConfig.backendUrl) {
      logger.warn(
        "Backend URL not configured, worker registry will be disabled"
      );
      return;
    }

    logger.info(
      "Worker Registry service initialized (registration deferred until server is ready)"
    );
  } catch (error) {
    logger.error("Failed to initialize Worker Registry service:", error);
    throw error;
  }
};

const startRegistration = async () => {
  try {
    logger.info("Starting worker registration process...");

    if (
      process.env.BACKEND_REGISTRATION_ENABLED === "false" ||
      process.env.STANDALONE_MODE === "true"
    ) {
      logger.info("Backend registration disabled, skipping registration");
      return;
    }

    if (!serviceConfig.backendUrl) {
      logger.warn("Backend URL not configured, skipping registration");
      return;
    }

    const startupDelay = parseInt(process.env.WORKER_STARTUP_DELAY) || 5000;
    await new Promise((resolve) => setTimeout(resolve, startupDelay));

    await registerWorkerWithRetry();
    initialized = true;
    logger.info("Worker registration completed successfully", {
      workerId: serviceConfig.workerId,
      backendUrl: serviceConfig.backendUrl,
      maxSessions: serviceConfig.maxSessions,
    });
  } catch (error) {
    logger.error("Failed to register worker:", error);
    logger.warn("Worker will continue without backend registration");
  }
};

const registerWorkerWithRetry = async () => {
  while (registrationRetries < serviceConfig.maxRegistrationRetries) {
    try {
      await registerWorker();
      registrationRetries = 0; // Reset on success
      return;
    } catch (error) {
      registrationRetries++;
      logger.warn(
        `Worker registration attempt ${registrationRetries} failed:`,
        {
          error: error.message,
          workerId: serviceConfig.workerId,
          retriesLeft:
            serviceConfig.maxRegistrationRetries - registrationRetries,
        }
      );

      if (registrationRetries >= serviceConfig.maxRegistrationRetries) {
        throw new Error(
          `Failed to register worker after ${serviceConfig.maxRegistrationRetries} attempts`
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, serviceConfig.registrationRetryInterval)
      );
    }
  }
};

const registerWorker = async () => {
  const registrationData = {
    workerId: serviceConfig.workerId,
    endpoint: serviceConfig.workerEndpoint,
    maxSessions: serviceConfig.maxSessions,
    description: config.server.description || "WhatsApp Worker Instance",
    version: process.env.npm_package_version || "1.0.0",
    environment: config.server.nodeEnv.toUpperCase(),
  };

  logger.debug("Attempting worker registration:", {
    url: `${serviceConfig.backendUrl}/api/v1/workers/register`,
    workerId: serviceConfig.workerId,
    endpoint: serviceConfig.workerEndpoint,
    authToken: serviceConfig.workerAuthToken
      ? `${serviceConfig.workerAuthToken.substring(0, 10)}...`
      : "NOT_SET",
    payload: registrationData,
  });

  try {
    const response = await axios.post(
      `${serviceConfig.backendUrl}/api/v1/workers/register`,
      registrationData,
      {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
        },
      }
    );

    logger.info("Worker registered successfully:", {
      workerId: serviceConfig.workerId,
      endpoint: serviceConfig.workerEndpoint,
      version: registrationData.version,
      environment: registrationData.environment,
      recoveryRequired: response.data.data?.recoveryRequired || false,
      assignedSessionCount: response.data.data?.assignedSessionCount || 0,
      response: response.data,
    });

    recoveryRequired = response.data.data?.recoveryRequired || false;
    startHeartbeat();
    return response.data;
  } catch (error) {
    logger.error("Worker registration failed:", {
      workerId: serviceConfig.workerId,
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
};

const startHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(async () => {
    try {
      const heartbeatPayload = await getEnhancedHeartbeatPayload();
      await axios.put(
        `${serviceConfig.backendUrl}/api/v1/workers/${serviceConfig.workerId}/heartbeat`,
        heartbeatPayload,
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
          },
        }
      );
      logger.debug("Enhanced heartbeat sent successfully", {
        workerId: serviceConfig.workerId,
        sessionCount: heartbeatPayload.metrics.totalSessions,
        activeSessions: heartbeatPayload.metrics.activeSessions,
      });
    } catch (error) {
      logger.error("Heartbeat failed:", {
        error: error.message,
        workerId: serviceConfig.workerId,
      });
    }
  }, serviceConfig.heartbeatIntervalMs);

  logger.info("Enhanced heartbeat started", {
    workerId: serviceConfig.workerId,
    interval: serviceConfig.heartbeatIntervalMs,
  });
};

const getEnhancedHeartbeatPayload = async () => {
  const sessions = [];
  let messageCount = 0;

  if (baileysService) {
    try {
      const allSessions = baileysService.getAllSessions();
      for (const [sessionId, sessionInfo] of allSessions) {
        let status = "DISCONNECTED";
        switch (sessionInfo.status) {
          case "connected":
            status = "CONNECTED";
            break;
          case "qr_ready":
            status = "QR_REQUIRED";
            break;
          case "reconnecting":
          case "restarting":
            status = "RECONNECTING";
            break;
          case "initializing":
            status = "INIT";
            break;
          case "logged_out":
            status = "LOGGED_OUT";
            break;
          case "disconnected":
          case "failed":
          default:
            status = "DISCONNECTED";
            break;
        }
        sessions.push({
          sessionId,
          status,
          phoneNumber: formatPhoneNumber(sessionInfo.phoneNumber) || null,
          displayName: sessionInfo.displayName || null,
          lastActivity: sessionInfo.lastSeen || new Date().toISOString(),
        });
      }
      messageCount = 0;
    } catch (error) {
      logger.warn(
        "Failed to get detailed session information from Baileys service:",
        error
      );
    }
  }

  const memoryUsage = process.memoryUsage();
  const memoryPercent = Math.round(
    (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
  );
  const cpuUsage = Math.round(Math.random() * 20 + 30);
  const activeSessions = sessions.filter(
    (s) => s.status === "CONNECTED"
  ).length;

  return {
    sessions,
    metrics: {
      cpuUsage,
      memoryUsage: memoryPercent,
      uptime: Math.round(process.uptime()),
      messageCount,
      totalSessions: sessions.length,
      activeSessions,
    },
    lastActivity: new Date().toISOString(),
  };
};

const formatPhoneNumber = (whatsappId) => {
  if (!whatsappId || typeof whatsappId !== "string") {
    return null;
  }
  try {
    const phoneNumber = whatsappId.split(":")[0].split("@")[0];
    return phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
  } catch (error) {
    logger.warn("Failed to format phone number:", {
      whatsappId,
      error: error.message,
    });
    return null;
  }
};

const notifyBackend = async (event, sessionId, data = {}) => {
  if (!initialized) {
    logger.warn(
      "Worker Registry not initialized, skipping backend notification"
    );
    return;
  }
  if (!event || !sessionId) {
    logger.error("Invalid parameters for notifyBackend:", {
      event,
      sessionId,
      data,
    });
    return;
  }
  if (!serviceConfig.backendUrl) {
    logger.warn("Backend URL not configured, skipping notification");
    return;
  }

  let endpoint = null;
  let payload = null;

  try {
    if (event === "message_status") {
      endpoint = `${serviceConfig.backendUrl}/api/v1/webhooks/message-status`;
      payload = {
        sessionId,
        messageId: data.messageId,
        status: data.status,
        timestamp: new Date().toISOString(),
        ...data,
      };
    } else {
      endpoint = `${serviceConfig.backendUrl}/api/v1/webhooks/session-status`;
      let status;
      switch (event) {
        case "session_created":
          status = "INIT";
          break;
        case "qr_ready":
          status = "QR_REQUIRED";
          break;
        case "connected":
          status = "CONNECTED";
          break;
        case "disconnected":
        case "session_auto_disconnected":
        case "session_deleted":
          status = "DISCONNECTED";
          break;
        case "session_logged_out":
          status = "DISCONNECTED";
          break;
        case "reconnecting":
          status = "RECONNECTING";
          break;
        case "error":
          status = "ERROR";
          break;
        default:
          status = "INIT";
      }
      payload = {
        sessionId,
        status,
        timestamp: new Date().toISOString(),
      };
      if (status === "QR_REQUIRED" && data.qrCode) {
        payload.qrCode = data.qrCode;
      } else if (status === "CONNECTED" && data.phoneNumber) {
        const formattedPhoneNumber = formatPhoneNumber(data.phoneNumber);
        if (formattedPhoneNumber) {
          payload.phoneNumber = formattedPhoneNumber;
        }
        payload.displayName = data.displayName || null;
      } else if (event === "session_logged_out") {
        if (data.phoneNumber) {
          const formattedPhoneNumber = formatPhoneNumber(data.phoneNumber);
          if (formattedPhoneNumber) {
            payload.phoneNumber = formattedPhoneNumber;
          }
        }
        if (data.displayName) {
          payload.displayName = data.displayName;
        }
        if (data.reason) {
          payload.reason = data.reason;
        }
        payload.loggedOutAt = new Date().toISOString();
        payload.loggedOutFromPhone = true;
      }
      if (status !== "CONNECTED") {
        if (status === "RECONNECTING" && data.displayName) {
          payload.displayName = data.displayName;
        } else if (data.displayName) {
          payload.displayName = data.displayName;
        } else {
          payload.displayName = null;
        }
      }
    }

    logger.info("Sending webhook to backend:", {
      sessionId,
      event,
      endpoint,
      method: "POST",
      payload: JSON.stringify(payload, null, 2),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceConfig.workerAuthToken ? serviceConfig.workerAuthToken.substring(0, 10) + "..." : "NOT_SET"}`,
      },
      timeout: 5000,
    });

    if (!endpoint || !payload) {
      throw new Error(
        `Invalid webhook configuration: endpoint=${endpoint}, payload=${!!payload}`
      );
    }
    if (!serviceConfig.workerAuthToken) {
      throw new Error("Worker auth token not configured");
    }

    const response = await axios.post(endpoint, payload, {
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
      },
    });

    logger.info("Webhook sent successfully:", {
      sessionId,
      event,
      status: payload.status || event,
      endpoint,
      method: "POST",
      responseStatus: response.status,
      responseData: response.data,
      phoneNumber: payload.phoneNumber || "N/A",
      displayName: payload.displayName || "N/A",
    });
  } catch (error) {
    logger.error("Failed to send webhook:", {
      sessionId,
      event,
      endpoint: endpoint || "UNDEFINED",
      method: "POST",
      payload: payload ? JSON.stringify(payload, null, 2) : "UNDEFINED",
      error: error.message,
      errorCode: error.code,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      requestConfig: {
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceConfig.workerAuthToken ? serviceConfig.workerAuthToken.substring(0, 10) + "..." : "NOT_SET"}`,
        },
      },
      isNetworkError:
        error.code === "ECONNREFUSED" ||
        error.code === "ENOTFOUND" ||
        error.code === "ETIMEDOUT",
      backendUrl: serviceConfig.backendUrl,
    });
  }
};

const getAssignedSessions = async () => {
  if (!initialized) {
    logger.warn(
      "Worker Registry not initialized, cannot get assigned sessions"
    );
    return [];
  }
  try {
    const response = await axios.get(
      `${serviceConfig.backendUrl}/api/v1/workers/${serviceConfig.workerId}/sessions/assigned`,
      {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
        },
      }
    );
    const sessions = response.data?.data?.sessions || [];
    logger.info(`Retrieved ${sessions.length} assigned sessions from backend`);
    return sessions;
  } catch (error) {
    logger.error("Failed to get assigned sessions from backend:", {
      error: error.message,
      status: error.response?.status,
      workerId: serviceConfig.workerId,
    });
    return [];
  }
};

const reportRecoveryStatus = async (recoveryData) => {
  if (!initialized) {
    logger.warn(
      "Worker Registry not initialized, cannot report recovery status"
    );
    return;
  }
  try {
    const payload = {
      recoveryResults: recoveryData.sessionResults || [],
      summary: {
        totalSessions: recoveryData.totalSessions || 0,
        successfulRecoveries: recoveryData.recoveredSessions || 0,
        failedRecoveries: recoveryData.failedSessions || 0,
        skippedRecoveries: recoveryData.skippedSessions || 0,
      },
    };
    await axios.post(
      `${serviceConfig.backendUrl}/api/v1/workers/${serviceConfig.workerId}/sessions/recovery-status`,
      payload,
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
        },
      }
    );
    logger.info("Recovery status reported to backend successfully", {
      totalSessions: recoveryData.totalSessions,
      recoveredSessions: recoveryData.recoveredSessions,
      failedSessions: recoveryData.failedSessions,
    });
  } catch (error) {
    logger.error("Failed to report recovery status to backend:", {
      error: error.message,
      status: error.response?.status,
      workerId: serviceConfig.workerId,
    });
  }
};

const notifySessionsPreserved = async (preservedSessions) => {
  if (!initialized) {
    logger.warn(
      "Worker Registry not initialized, cannot notify about preserved sessions"
    );
    return;
  }
  try {
    await axios.post(
      `${serviceConfig.backendUrl}/api/v1/workers/${serviceConfig.workerId}/sessions-preserved`,
      {
        workerId: serviceConfig.workerId,
        preservedSessions,
        timestamp: new Date().toISOString(),
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
        },
      }
    );
    logger.info(
      `Notified backend about ${preservedSessions.length} preserved sessions`
    );
  } catch (error) {
    logger.error("Failed to notify backend about preserved sessions:", {
      error: error.message,
      status: error.response?.status,
      workerId: serviceConfig.workerId,
    });
  }
};

const unregisterWorker = async () => {
  if (!initialized) {
    return;
  }
  try {
    const unregisterPayload = {
      workerId: serviceConfig.workerId,
      endpoint: serviceConfig.workerEndpoint,
    };
    logger.info("Attempting to unregister worker from backend:", {
      workerId: serviceConfig.workerId,
      workerEndpoint: serviceConfig.workerEndpoint,
      backendEndpoint: `${serviceConfig.backendUrl}/api/v1/workers/unregister`,
      authToken: serviceConfig.workerAuthToken
        ? `${serviceConfig.workerAuthToken.substring(0, 10)}...`
        : "NOT_SET",
      payload: unregisterPayload,
    });
    await axios.delete(
      `${serviceConfig.backendUrl}/api/v1/workers/unregister`,
      {
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceConfig.workerAuthToken}`,
        },
        data: unregisterPayload,
      }
    );
    logger.info("Worker unregistered successfully", {
      workerId: serviceConfig.workerId,
      endpoint: serviceConfig.workerEndpoint,
    });
  } catch (error) {
    logger.error("Failed to unregister worker:", {
      error: error.message,
      workerId: serviceConfig.workerId,
      workerEndpoint: serviceConfig.workerEndpoint,
      status: error.response?.status,
      responseData: error.response?.data,
      backendEndpoint: `${serviceConfig.backendUrl}/api/v1/workers/unregister`,
    });
  }
};

const stopHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info("Heartbeat stopped", { workerId: serviceConfig.workerId });
  }
};

const shutdown = async () => {
  logger.info("Shutting down Worker Registry service...");
  stopHeartbeat();
  await unregisterWorker();
  initialized = false;
  logger.info("Worker Registry service shutdown complete");
};

const isInitialized = () => {
  return initialized;
};

const isRecoveryRequired = () => {
  return recoveryRequired;
};

const getWorkerId = () => {
  return serviceConfig.workerId;
};

const getWorkerEndpoint = () => {
  return serviceConfig.workerEndpoint;
};

export default {
  setServices,
  initialize,
  startRegistration,
  notifyBackend,
  getAssignedSessions,
  reportRecoveryStatus,
  notifySessionsPreserved,
  shutdown,
  isInitialized,
  isRecoveryRequired,
  getWorkerId,
  getWorkerEndpoint,
};

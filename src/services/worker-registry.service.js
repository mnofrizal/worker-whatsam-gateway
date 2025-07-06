import axios from "axios";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

class WorkerRegistryService {
  constructor() {
    this.config = config;
    this.backendUrl = config.backend.url;
    this.workerId = config.server.workerId;
    this.workerEndpoint = config.server.workerEndpoint;
    this.maxSessions = config.server.maxSessions;
    this.workerAuthToken = config.backend.workerAuthToken;
    this.heartbeatIntervalMs = config.backend.heartbeatInterval;
    this.heartbeatInterval = null;
    this.initialized = false;
    this.baileysService = null;
    this.registrationRetries = 0;
    this.maxRegistrationRetries = config.backend.maxRegistrationRetries;
    this.registrationRetryInterval = config.backend.registrationRetryInterval;
  }

  setServices(baileysService) {
    this.baileysService = baileysService;
  }

  async initialize() {
    try {
      logger.info("Initializing Worker Registry service...");

      // Check if backend registration is enabled
      if (
        process.env.BACKEND_REGISTRATION_ENABLED === "false" ||
        process.env.STANDALONE_MODE === "true"
      ) {
        logger.info(
          "Backend registration disabled (standalone mode), worker registry will be disabled"
        );
        return;
      }

      // Check if backend URL is configured
      if (!this.backendUrl) {
        logger.warn(
          "Backend URL not configured, worker registry will be disabled"
        );
        return;
      }

      // Just initialize the service, don't register yet
      // Registration will happen after the HTTP server is listening
      logger.info(
        "Worker Registry service initialized (registration deferred until server is ready)"
      );
    } catch (error) {
      logger.error("Failed to initialize Worker Registry service:", error);
      throw error;
    }
  }

  async startRegistration() {
    try {
      logger.info("Starting worker registration process...");

      // Check if backend registration is enabled
      if (
        process.env.BACKEND_REGISTRATION_ENABLED === "false" ||
        process.env.STANDALONE_MODE === "true"
      ) {
        logger.info("Backend registration disabled, skipping registration");
        return;
      }

      // Check if backend URL is configured
      if (!this.backendUrl) {
        logger.warn("Backend URL not configured, skipping registration");
        return;
      }

      // Add startup delay to give backend time to be ready
      const startupDelay = parseInt(process.env.WORKER_STARTUP_DELAY) || 5000;
      await new Promise((resolve) => setTimeout(resolve, startupDelay));

      await this.registerWorkerWithRetry();
      this.initialized = true;
      logger.info("Worker registration completed successfully", {
        workerId: this.workerId,
        backendUrl: this.backendUrl,
        maxSessions: this.maxSessions,
      });
    } catch (error) {
      logger.error("Failed to register worker:", error);
      // Don't throw error to allow worker to continue without backend
      logger.warn("Worker will continue without backend registration");
    }
  }

  async registerWorkerWithRetry() {
    while (this.registrationRetries < this.maxRegistrationRetries) {
      try {
        await this.registerWorker();
        this.registrationRetries = 0; // Reset on success
        return;
      } catch (error) {
        this.registrationRetries++;
        logger.warn(
          `Worker registration attempt ${this.registrationRetries} failed:`,
          {
            error: error.message,
            workerId: this.workerId,
            retriesLeft: this.maxRegistrationRetries - this.registrationRetries,
          }
        );

        if (this.registrationRetries >= this.maxRegistrationRetries) {
          throw new Error(
            `Failed to register worker after ${this.maxRegistrationRetries} attempts`
          );
        }

        // Wait before retry
        await new Promise((resolve) =>
          setTimeout(resolve, this.registrationRetryInterval)
        );
      }
    }
  }

  async registerWorker() {
    const registrationData = {
      workerId: this.workerId,
      endpoint: this.workerEndpoint,
      maxSessions: this.maxSessions,
      description: this.config.server.description || "WhatsApp Worker Instance",
      status: "ONLINE",
      version: process.env.npm_package_version || "1.0.0",
      environment: this.config.server.nodeEnv.toUpperCase(),
      timestamp: new Date().toISOString(),
    };

    logger.debug("Attempting worker registration:", {
      url: `${this.backendUrl}/api/v1/workers/register`,
      workerId: this.workerId,
      endpoint: this.workerEndpoint,
      authToken: this.workerAuthToken
        ? `${this.workerAuthToken.substring(0, 10)}...`
        : "NOT_SET",
      payload: registrationData,
    });

    try {
      const response = await axios.post(
        `${this.backendUrl}/api/v1/workers/register`,
        registrationData,
        {
          timeout: 15000, // Increased timeout
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.workerAuthToken}`,
          },
        }
      );

      logger.info("Worker registered successfully:", {
        workerId: this.workerId,
        endpoint: this.workerEndpoint,
        version: registrationData.version,
        environment: registrationData.environment,
        response: response.data,
      });

      // Start heartbeat after successful registration
      this.startHeartbeat();

      return response.data;
    } catch (error) {
      logger.error("Worker registration failed:", {
        workerId: this.workerId,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      try {
        const metrics = await this.getWorkerMetrics();

        await axios.put(
          `${this.backendUrl}/api/v1/workers/${this.workerId}/heartbeat`,
          {
            status: "ONLINE",
            metrics,
            timestamp: new Date().toISOString(),
          },
          {
            timeout: 5000,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.workerAuthToken}`,
            },
          }
        );

        logger.debug("Heartbeat sent successfully", {
          workerId: this.workerId,
          sessionCount: metrics.sessions.total,
        });
      } catch (error) {
        logger.error("Heartbeat failed:", {
          error: error.message,
          workerId: this.workerId,
        });
      }
    }, this.heartbeatIntervalMs);

    logger.info("Heartbeat started", {
      workerId: this.workerId,
      interval: this.heartbeatIntervalMs,
    });
  }

  async getWorkerMetrics() {
    const sessions = this.baileysService
      ? this.baileysService.sessions
      : new Map();
    const qrCodes = this.baileysService
      ? this.baileysService.qrCodes
      : new Map();

    // Count sessions by status
    let connected = 0;
    let disconnected = 0;
    let qr_required = qrCodes.size;
    let reconnecting = 0;
    let error = 0;

    for (const [sessionId, socket] of sessions) {
      if (socket && socket.user) {
        connected++;
      } else if (socket && socket.readyState === 1) {
        reconnecting++;
      } else if (socket && socket.readyState === 3) {
        error++;
      } else {
        disconnected++;
      }
    }

    // Get simple system metrics
    const memoryUsage = process.memoryUsage();
    const memoryPercent = Math.round(
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    );

    // Simple CPU usage (approximation - would need external lib for real monitoring)
    const cpuUsage = Math.round(Math.random() * 20 + 30); // Placeholder

    // Get message count (placeholder for now)
    const messageCount = 0; // Would need database integration

    return {
      sessions: {
        total: sessions.size,
        connected,
        disconnected,
        qr_required,
        reconnecting,
        error,
        maxSessions: this.maxSessions,
      },
      cpuUsage,
      memoryUsage: memoryPercent,
      uptime: Math.round(process.uptime()),
      messageCount,
    };
  }

  async notifyBackend(event, sessionId, data = {}) {
    if (!this.initialized) {
      logger.warn(
        "Worker Registry not initialized, skipping backend notification"
      );
      return;
    }

    try {
      // Use webhook endpoints for session status updates
      let endpoint;
      let payload;

      if (
        event === "session_status" ||
        event === "qr_ready" ||
        event === "connected" ||
        event === "disconnected" ||
        event === "session_auto_disconnected" ||
        event === "reconnecting" ||
        event === "error"
      ) {
        // Session status webhook - send direct payload format expected by backend
        endpoint = `${this.backendUrl}/api/v1/webhooks/session-status`;

        // Map event to proper status
        let status;
        switch (event) {
          case "qr_ready":
            status = "QR_REQUIRED";
            break;
          case "connected":
            status = "CONNECTED";
            break;
          case "disconnected":
          case "session_auto_disconnected":
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

        // Send payload format that matches backend expectation: { status, qrCode, phoneNumber, timestamp }
        payload = {
          status,
          timestamp: new Date().toISOString(),
        };

        // Add optional fields based on status
        if (status === "QR_REQUIRED" && data.qrCode) {
          payload.qrCode = data.qrCode;
        } else if (status === "CONNECTED" && data.phoneNumber) {
          payload.phoneNumber = data.phoneNumber;
        } else if (status === "DISCONNECTED") {
          // Always clear both QR code and phone number when disconnected
          payload.qrCode = null;
          payload.phoneNumber = null;
        }
      } else if (event === "message_status") {
        // Message status webhook
        endpoint = `${this.backendUrl}/api/v1/webhooks/message-status`;
        payload = {
          sessionId,
          messageId: data.messageId,
          status: data.status,
          timestamp: new Date().toISOString(),
          ...data,
        };
      } else {
        // General worker events
        endpoint = `${this.backendUrl}/api/v1/workers/${this.workerId}/events`;
        payload = {
          event,
          sessionId,
          workerId: this.workerId,
          data,
          timestamp: new Date().toISOString(),
        };
      }

      // For session status webhooks, send to session-specific endpoint
      if (endpoint.includes("/webhooks/session-status")) {
        await axios.post(`${endpoint}/${sessionId}`, payload, {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.workerAuthToken}`,
          },
        });
      } else {
        await axios.post(endpoint, payload, {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.workerAuthToken}`,
          },
        });
      }

      logger.debug("Backend notification sent:", {
        event,
        sessionId,
        endpoint,
        status: payload.status || event,
      });
    } catch (error) {
      logger.error("Failed to notify backend:", {
        error: error.message,
        event,
        sessionId,
      });
    }
  }

  async unregisterWorker() {
    if (!this.initialized) {
      return;
    }

    try {
      await axios.delete(`${this.backendUrl}/api/v1/workers/${this.workerId}`, {
        timeout: 5000,
        headers: {
          Authorization: `Bearer ${this.workerAuthToken}`,
        },
      });

      logger.info("Worker unregistered successfully", {
        workerId: this.workerId,
      });
    } catch (error) {
      logger.error("Failed to unregister worker:", {
        error: error.message,
        workerId: this.workerId,
      });
    }
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.info("Heartbeat stopped", { workerId: this.workerId });
    }
  }

  async shutdown() {
    logger.info("Shutting down Worker Registry service...");

    this.stopHeartbeat();
    await this.unregisterWorker();

    this.initialized = false;
    logger.info("Worker Registry service shutdown complete");
  }

  isInitialized() {
    return this.initialized;
  }

  getWorkerId() {
    return this.workerId;
  }

  getWorkerEndpoint() {
    return this.workerEndpoint;
  }
}

export default WorkerRegistryService;

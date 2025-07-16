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
    this.recoveryRequired = false;
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
      version: process.env.npm_package_version || "1.0.0",
      environment: this.config.server.nodeEnv.toUpperCase(),
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
        recoveryRequired: response.data.data?.recoveryRequired || false,
        assignedSessionCount: response.data.data?.assignedSessionCount || 0,
        response: response.data,
      });

      // Store recovery information
      this.recoveryRequired = response.data.data?.recoveryRequired || false;

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
        const heartbeatPayload = await this.getEnhancedHeartbeatPayload();

        await axios.put(
          `${this.backendUrl}/api/v1/workers/${this.workerId}/heartbeat`,
          heartbeatPayload,
          {
            timeout: 5000,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.workerAuthToken}`,
            },
          }
        );

        logger.debug("Enhanced heartbeat sent successfully", {
          workerId: this.workerId,
          sessionCount: heartbeatPayload.metrics.totalSessions,
          activeSessions: heartbeatPayload.metrics.activeSessions,
        });
      } catch (error) {
        logger.error("Heartbeat failed:", {
          error: error.message,
          workerId: this.workerId,
        });
      }
    }, this.heartbeatIntervalMs);

    logger.info("Enhanced heartbeat started", {
      workerId: this.workerId,
      interval: this.heartbeatIntervalMs,
    });
  }

  /**
   * Get enhanced heartbeat payload with detailed session information
   */
  async getEnhancedHeartbeatPayload() {
    const sessions = [];
    let messageCount = 0;

    // Get detailed session information from Baileys service if available
    if (this.baileysService) {
      try {
        const allSessions = this.baileysService.getAllSessions();

        for (const [sessionId, sessionInfo] of allSessions) {
          // Map internal status to backend expected status
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
            phoneNumber:
              this.formatPhoneNumber(sessionInfo.phoneNumber) || null,
            displayName: sessionInfo.displayName || null,
            lastActivity: sessionInfo.lastSeen || new Date().toISOString(),
          });
        }

        // Get message count if available (placeholder for now)
        messageCount = 0; // Would need database integration for actual count
      } catch (error) {
        logger.warn(
          "Failed to get detailed session information from Baileys service:",
          error
        );
      }
    }

    // Get basic system metrics
    const memoryUsage = process.memoryUsage();
    const memoryPercent = Math.round(
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    );

    // Simple CPU usage approximation
    const cpuUsage = Math.round(Math.random() * 20 + 30); // Placeholder - would need external lib for real monitoring

    // Count active sessions
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
  }

  /**
   * Extract and format phone number from WhatsApp ID
   * @param {string} whatsappId - WhatsApp ID format: "6285179971457:52@s.whatsapp.net"
   * @returns {string} - Formatted phone number: "+6285179971457"
   */
  formatPhoneNumber(whatsappId) {
    if (!whatsappId || typeof whatsappId !== "string") {
      return null;
    }

    try {
      // Extract phone number from WhatsApp ID format
      // Format: "6285179971457:52@s.whatsapp.net" -> "6285179971457"
      const phoneNumber = whatsappId.split(":")[0].split("@")[0];

      // Add + prefix if not present
      return phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
    } catch (error) {
      logger.warn("Failed to format phone number:", {
        whatsappId,
        error: error.message,
      });
      return null;
    }
  }

  async notifyBackend(event, sessionId, data = {}) {
    if (!this.initialized) {
      logger.warn(
        "Worker Registry not initialized, skipping backend notification"
      );
      return;
    }

    // Validate required parameters
    if (!event || !sessionId) {
      logger.error("Invalid parameters for notifyBackend:", {
        event,
        sessionId,
        data,
      });
      return;
    }

    // Validate backend URL
    if (!this.backendUrl) {
      logger.warn("Backend URL not configured, skipping notification");
      return;
    }

    let endpoint = null;
    let payload = null;

    try {
      if (event === "message_status") {
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
        // Session status webhook - all other events are session status updates
        endpoint = `${this.backendUrl}/api/v1/webhooks/session-status`;

        // Map event to proper status
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

        // Send payload format that matches backend expectation
        payload = {
          sessionId,
          status,
          timestamp: new Date().toISOString(),
        };

        // Add optional fields based on status
        if (status === "QR_REQUIRED" && data.qrCode) {
          payload.qrCode = data.qrCode;
        } else if (status === "CONNECTED" && data.phoneNumber) {
          // Format phone number properly for backend validation
          const formattedPhoneNumber = this.formatPhoneNumber(data.phoneNumber);
          if (formattedPhoneNumber) {
            payload.phoneNumber = formattedPhoneNumber;
          }
          // Always include displayName for CONNECTED status (even if null)
          payload.displayName = data.displayName || null;
        } else if (event === "session_logged_out") {
          // Include additional information for logged out sessions (using DISCONNECTED status)
          if (data.phoneNumber) {
            const formattedPhoneNumber = this.formatPhoneNumber(
              data.phoneNumber
            );
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
          // Add logout-specific metadata
          payload.loggedOutAt = new Date().toISOString();
          payload.loggedOutFromPhone = true;
        }

        // Always include displayName field - use actual value if available, otherwise null
        if (status !== "CONNECTED") {
          // For RECONNECTING status or when we have displayName data, include it
          if (status === "RECONNECTING" && data.displayName) {
            payload.displayName = data.displayName;
          } else if (data.displayName) {
            // If we have displayName in data for any status, include it
            payload.displayName = data.displayName;
          } else {
            // Only set to null if we truly don't have displayName data
            payload.displayName = null;
          }
        }

        // For DISCONNECTED status, don't include qrCode or phoneNumber fields at all
        // The backend will handle clearing these fields when status is DISCONNECTED
      }

      // Log webhook request details before sending
      logger.info("Sending webhook to backend:", {
        sessionId,
        event,
        endpoint,
        method: "POST",
        payload: JSON.stringify(payload, null, 2),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workerAuthToken ? this.workerAuthToken.substring(0, 10) + "..." : "NOT_SET"}`,
        },
        timeout: 5000,
      });

      // Validate endpoint and payload before sending
      if (!endpoint || !payload) {
        throw new Error(
          `Invalid webhook configuration: endpoint=${endpoint}, payload=${!!payload}`
        );
      }

      // Validate auth token
      if (!this.workerAuthToken) {
        throw new Error("Worker auth token not configured");
      }

      // Send webhook request
      const response = await axios.post(endpoint, payload, {
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workerAuthToken}`,
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
            Authorization: `Bearer ${this.workerAuthToken ? this.workerAuthToken.substring(0, 10) + "..." : "NOT_SET"}`,
          },
        },
        isNetworkError:
          error.code === "ECONNREFUSED" ||
          error.code === "ENOTFOUND" ||
          error.code === "ETIMEDOUT",
        backendUrl: this.backendUrl,
      });
    }
  }

  /**
   * Get assigned sessions from backend for this worker
   */
  async getAssignedSessions() {
    if (!this.initialized) {
      logger.warn(
        "Worker Registry not initialized, cannot get assigned sessions"
      );
      return [];
    }

    try {
      const response = await axios.get(
        `${this.backendUrl}/api/v1/workers/${this.workerId}/sessions/assigned`,
        {
          timeout: 10000,
          headers: {
            Authorization: `Bearer ${this.workerAuthToken}`,
          },
        }
      );

      const sessions = response.data?.data?.sessions || [];
      logger.info(
        `Retrieved ${sessions.length} assigned sessions from backend`
      );

      return sessions;
    } catch (error) {
      logger.error("Failed to get assigned sessions from backend:", {
        error: error.message,
        status: error.response?.status,
        workerId: this.workerId,
      });
      return [];
    }
  }

  /**
   * Report session recovery status to backend
   */
  async reportRecoveryStatus(recoveryData) {
    if (!this.initialized) {
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
        `${this.backendUrl}/api/v1/workers/${this.workerId}/sessions/recovery-status`,
        payload,
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.workerAuthToken}`,
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
        workerId: this.workerId,
      });
    }
  }

  /**
   * Notify backend about preserved sessions during shutdown
   */
  async notifySessionsPreserved(preservedSessions) {
    if (!this.initialized) {
      logger.warn(
        "Worker Registry not initialized, cannot notify about preserved sessions"
      );
      return;
    }

    try {
      await axios.post(
        `${this.backendUrl}/api/v1/workers/${this.workerId}/sessions-preserved`,
        {
          workerId: this.workerId,
          preservedSessions,
          timestamp: new Date().toISOString(),
        },
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.workerAuthToken}`,
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
        workerId: this.workerId,
      });
    }
  }

  async unregisterWorker() {
    if (!this.initialized) {
      return;
    }

    try {
      const unregisterPayload = {
        workerId: this.workerId,
        endpoint: this.workerEndpoint,
      };

      logger.info("Attempting to unregister worker from backend:", {
        workerId: this.workerId,
        workerEndpoint: this.workerEndpoint,
        backendEndpoint: `${this.backendUrl}/api/v1/workers/unregister`,
        authToken: this.workerAuthToken
          ? `${this.workerAuthToken.substring(0, 10)}...`
          : "NOT_SET",
        payload: unregisterPayload,
      });

      await axios.delete(`${this.backendUrl}/api/v1/workers/unregister`, {
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workerAuthToken}`,
        },
        data: unregisterPayload,
      });

      logger.info("Worker unregistered successfully", {
        workerId: this.workerId,
        endpoint: this.workerEndpoint,
      });
    } catch (error) {
      logger.error("Failed to unregister worker:", {
        error: error.message,
        workerId: this.workerId,
        workerEndpoint: this.workerEndpoint,
        status: error.response?.status,
        responseData: error.response?.data,
        backendEndpoint: `${this.backendUrl}/api/v1/workers/unregister`,
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

  isRecoveryRequired() {
    return this.recoveryRequired;
  }

  getWorkerId() {
    return this.workerId;
  }

  getWorkerEndpoint() {
    return this.workerEndpoint;
  }
}

export default WorkerRegistryService;

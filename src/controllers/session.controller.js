import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
} from "../utils/constants.js";

class SessionController {
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
  }

  async startSession(req, res) {
    try {
      const { sessionId, userId, sessionName } = req.body;

      // Validate required fields
      if (!sessionId || !userId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse([
            { field: "sessionId", message: "sessionId is required" },
            { field: "userId", message: "userId is required" },
          ])
        );
      }

      // Check if session already exists
      const existingSession = this.baileysService.getSessionStatus(sessionId);

      if (existingSession.status !== "not_found") {
        // Session exists - check its current status
        if (existingSession.status === SESSION_STATUS.CONNECTED) {
          return res.status(HTTP_STATUS.OK).json(
            ApiResponse.createSuccessResponse({
              sessionId,
              status: SESSION_STATUS.CONNECTED,
              message: "Session is already connected",
              phoneNumber: existingSession.phoneNumber,
            })
          );
        }

        if (
          existingSession.status === "initializing" ||
          existingSession.status === "qr_ready"
        ) {
          return res.status(HTTP_STATUS.OK).json(
            ApiResponse.createSuccessResponse({
              sessionId,
              status: existingSession.status,
              message:
                "Session is already starting. Check QR code endpoint if needed.",
              qrCode: existingSession.qrCode || null,
            })
          );
        }

        // Session exists but is disconnected/logged_out - restart it
        logger.info(`Restarting existing session: ${sessionId}`, {
          currentStatus: existingSession.status,
        });

        try {
          const result = await this.baileysService.restartSession(sessionId);

          // Update database status
          if (this.databaseService.isInitialized()) {
            await this.databaseService.updateSessionStatus(
              sessionId,
              "initializing"
            );
          }

          // Notify backend about session restart
          await this.workerRegistryService.notifyBackend(
            "reconnecting",
            sessionId,
            {
              userId,
              sessionName,
              status: "initializing",
            }
          );

          logger.info("Existing session restarted successfully", {
            sessionId,
            userId,
          });

          return res.status(HTTP_STATUS.OK).json(
            ApiResponse.createSuccessResponse({
              sessionId,
              status: SESSION_STATUS.INITIALIZING,
              message:
                "Existing session restarted successfully. QR code will be available shortly.",
            })
          );
        } catch (error) {
          logger.error(
            `Failed to restart existing session ${sessionId}:`,
            error
          );
          // Fall through to create new session if restart fails
        }
      }

      // Session doesn't exist or restart failed - create new session
      logger.info(`Creating new session: ${sessionId}`, { userId });

      const result = await this.baileysService.createSession(
        sessionId,
        userId,
        sessionName
      );

      // Store session metadata in database
      if (this.databaseService.isInitialized()) {
        await this.databaseService.createSession({
          sessionId,
          userId,
          sessionName: sessionName || sessionId,
          status: "initializing",
          workerId: this.workerRegistryService.getWorkerId(),
          createdAt: new Date(),
        });
      }

      // Store session routing in Redis
      if (this.redisService.isInitialized()) {
        await this.redisService.setSessionRouting(
          sessionId,
          this.workerRegistryService.getWorkerId()
        );
      }

      // Notify backend about session creation
      await this.workerRegistryService.notifyBackend(
        "session_created",
        sessionId,
        {
          userId,
          sessionName,
          status: "initializing",
        }
      );

      logger.info("New session created successfully", { sessionId, userId });

      res.status(HTTP_STATUS.CREATED).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          status: SESSION_STATUS.INITIALIZING,
          message:
            "Session started successfully. QR code will be available shortly.",
        })
      );
    } catch (error) {
      logger.error("Error starting session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to start session")
        );
    }
  }

  async createSession(req, res) {
    try {
      const { sessionId, userId, sessionName } = req.body;

      // Validate required fields
      if (!sessionId || !userId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse([
            { field: "sessionId", message: "sessionId is required" },
            { field: "userId", message: "userId is required" },
          ])
        );
      }

      // Check if session already exists
      const existingSession = this.baileysService.getSessionStatus(sessionId);
      if (existingSession.status !== "not_found") {
        return res
          .status(HTTP_STATUS.CONFLICT)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.SESSION_ALREADY_EXISTS,
              "Session already exists"
            )
          );
      }

      // Create session
      const result = await this.baileysService.createSession(
        sessionId,
        userId,
        sessionName
      );

      // Store session metadata in database
      if (this.databaseService.isInitialized()) {
        await this.databaseService.createSession({
          sessionId,
          userId,
          sessionName: sessionName || sessionId,
          status: "initializing",
          workerId: this.workerRegistryService.getWorkerId(),
          createdAt: new Date(),
        });
      }

      // Store session routing in Redis
      if (this.redisService.isInitialized()) {
        await this.redisService.setSessionRouting(
          sessionId,
          this.workerRegistryService.getWorkerId()
        );
      }

      // Notify backend about session creation
      await this.workerRegistryService.notifyBackend(
        "session_created",
        sessionId,
        {
          userId,
          sessionName,
          status: "initializing",
        }
      );

      logger.info("Session created successfully", { sessionId, userId });

      res.status(HTTP_STATUS.CREATED).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          status: SESSION_STATUS.INITIALIZING,
          message:
            "Session created successfully. QR code will be available shortly.",
        })
      );
    } catch (error) {
      logger.error("Error creating session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to create session")
        );
    }
  }

  async getQRCode(req, res) {
    try {
      const { sessionId } = req.params;

      // Get QR code from Baileys service
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);

      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      if (sessionStatus.status === SESSION_STATUS.CONNECTED) {
        return res.status(HTTP_STATUS.OK).json(
          ApiResponse.createSuccessResponse({
            status: SESSION_STATUS.CONNECTED,
            message: "Session is already connected",
          })
        );
      }

      if (sessionStatus.status === "qr_ready" && sessionStatus.qrCode) {
        // Also store in Redis for caching
        if (this.redisService.isInitialized()) {
          await this.redisService.setQRCode(sessionId, sessionStatus.qrCode);
        }

        return res.status(HTTP_STATUS.OK).json(
          ApiResponse.createSuccessResponse({
            qrCode: sessionStatus.qrCode,
            status: SESSION_STATUS.QR_READY,
            expiresAt: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
          })
        );
      }

      // Check Redis cache if Baileys doesn't have QR yet
      if (this.redisService.isInitialized()) {
        const cachedQR = await this.redisService.getQRCode(sessionId);
        if (cachedQR) {
          return res.status(HTTP_STATUS.OK).json(
            ApiResponse.createSuccessResponse({
              qrCode: cachedQR,
              status: SESSION_STATUS.QR_READY,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            })
          );
        }
      }

      res.status(HTTP_STATUS.ACCEPTED).json(
        ApiResponse.createSuccessResponse({
          status: SESSION_STATUS.INITIALIZING,
          message:
            "QR code is being generated. Please try again in a few seconds.",
        })
      );
    } catch (error) {
      logger.error("Error getting QR code:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(ApiResponse.createInternalErrorResponse("Failed to get QR code"));
    }
  }

  async getSessionStatus(req, res) {
    try {
      const { sessionId } = req.params;

      const sessionStatus = this.baileysService.getSessionStatus(sessionId);

      if (sessionStatus.status === "not_found") {
        return res
          .status(404)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      // Get additional info from database if available
      let additionalInfo = {};
      if (this.databaseService.isInitialized()) {
        try {
          const dbSession = await this.databaseService.getSession(sessionId);
          if (dbSession) {
            additionalInfo = {
              userId: dbSession.userId,
              sessionName: dbSession.sessionName,
              createdAt: dbSession.createdAt,
              messageCount: dbSession.messageCount || 0,
            };
          }
        } catch (error) {
          logger.warn("Failed to get session info from database:", error);
        }
      }

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          ...sessionStatus,
          ...additionalInfo,
        })
      );
    } catch (error) {
      logger.error("Error getting session status:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse(
            "Failed to get session status"
          )
        );
    }
  }

  async deleteSession(req, res) {
    try {
      const { sessionId } = req.params;

      // Check if session exists
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      // Delete session from Baileys
      await this.baileysService.deleteSession(sessionId);

      // Clean up database
      if (this.databaseService.isInitialized()) {
        await this.databaseService.deleteSession(sessionId);
      }

      // Clean up Redis
      if (this.redisService.isInitialized()) {
        await this.redisService.deleteSessionRouting(sessionId);
        await this.redisService.deleteQRCode(sessionId);
      }

      // Notify backend about session deletion
      await this.workerRegistryService.notifyBackend(
        "session_deleted",
        sessionId
      );

      logger.info("Session deleted successfully", { sessionId });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          message: "Session deleted successfully",
        })
      );
    } catch (error) {
      logger.error("Error deleting session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to delete session")
        );
    }
  }

  async sendMessage(req, res) {
    try {
      const { sessionId } = req.params;
      const { to, message, type = "text" } = req.body;

      // Validate required fields
      if (!to || !message) {
        const errors = [];
        if (!to) errors.push({ field: "to", message: "to is required" });
        if (!message)
          errors.push({ field: "message", message: "message is required" });

        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(ApiResponse.createValidationErrorResponse(errors));
      }

      // Validate phone number format
      if (!Utils.isValidPhoneNumber(to)) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createValidationErrorResponse([
              { field: "to", message: "Invalid phone number format" },
            ])
          );
      }

      // Check if session exists and is connected
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.SESSION_NOT_CONNECTED,
              `Session is not connected. Current status: ${sessionStatus.status}`
            )
          );
      }

      // Format WhatsApp number using Utils helper
      const formattedTo = to.includes("@") ? to : Utils.formatWhatsAppId(to);

      // Send message
      const result = await this.baileysService.sendMessage(
        sessionId,
        formattedTo,
        {
          text: message,
        }
      );

      // Log message in database
      if (this.databaseService.isInitialized()) {
        await this.databaseService.saveMessage({
          sessionId,
          messageId: result.messageId,
          from: sessionStatus.phoneNumber,
          to: formattedTo,
          content: message,
          type,
          status: result.status,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info("Message sent successfully", {
        sessionId,
        to: formattedTo,
        messageId: result.messageId,
      });

      res
        .status(HTTP_STATUS.OK)
        .json(ApiResponse.createSuccessResponse(result));
    } catch (error) {
      logger.error("Error sending message:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to send message")
        );
    }
  }

  async listSessions(req, res) {
    try {
      const sessions = this.baileysService.getAllSessions();

      // Get additional info from database if available
      const sessionsWithInfo = [];

      for (const [sessionId, status] of sessions) {
        let sessionInfo = { sessionId, ...status };

        if (this.databaseService.isInitialized()) {
          try {
            const dbSession = await this.databaseService.getSession(sessionId);
            if (dbSession) {
              sessionInfo = {
                ...sessionInfo,
                userId: dbSession.userId,
                sessionName: dbSession.sessionName,
                createdAt: dbSession.createdAt,
                messageCount: dbSession.messageCount || 0,
              };
            }
          } catch (error) {
            logger.warn(`Failed to get session info for ${sessionId}:`, error);
          }
        }

        sessionsWithInfo.push(sessionInfo);
      }

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          sessions: sessionsWithInfo,
          total: sessionsWithInfo.length,
        })
      );
    } catch (error) {
      logger.error("Error listing sessions:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to list sessions")
        );
    }
  }

  async restartSession(req, res) {
    try {
      const { sessionId } = req.params;

      // Check if session exists
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      // Restart session via Baileys service
      const result = await this.baileysService.restartSession(sessionId);

      // Update database status
      if (this.databaseService.isInitialized()) {
        await this.databaseService.updateSessionStatus(sessionId, "restarting");
      }

      // Notify backend about session restart
      await this.workerRegistryService.notifyBackend(
        "reconnecting",
        sessionId,
        {
          status: "restarting",
        }
      );

      logger.info("Session restarted successfully", { sessionId });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          status: SESSION_STATUS.INITIALIZING,
          message:
            "Session restarted successfully. QR code will be available shortly.",
        })
      );
    } catch (error) {
      logger.error("Error restarting session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to restart session")
        );
    }
  }

  async disconnectSession(req, res) {
    try {
      const { sessionId } = req.params;

      // Check if session exists
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      // Disconnect session via Baileys service
      const result = await this.baileysService.disconnectSession(sessionId);

      // Update database status
      if (this.databaseService.isInitialized()) {
        await this.databaseService.updateSessionStatus(
          sessionId,
          "disconnected"
        );
      }

      // Notify backend about session disconnect
      await this.workerRegistryService.notifyBackend(
        "disconnected",
        sessionId,
        {
          status: "disconnected",
        }
      );

      logger.info("Session disconnected successfully", { sessionId });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          status: SESSION_STATUS.DISCONNECTED,
          message: "Session disconnected successfully. Session data preserved.",
        })
      );
    } catch (error) {
      logger.error("Error disconnecting session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse(
            "Failed to disconnect session"
          )
        );
    }
  }

  async logoutSession(req, res) {
    try {
      const { sessionId } = req.params;

      // Check if session exists
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
      if (sessionStatus.status === "not_found") {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(ApiResponse.createNotFoundResponse("Session"));
      }

      // Logout session via Baileys service (this will delete auth data)
      const result = await this.baileysService.logoutSession(sessionId);

      // Update database status
      if (this.databaseService.isInitialized()) {
        await this.databaseService.updateSessionStatus(sessionId, "logged_out");
      }

      // Clean up Redis QR code cache
      if (this.redisService.isInitialized()) {
        await this.redisService.deleteQRCode(sessionId);
      }

      // Notify backend about session logout
      await this.workerRegistryService.notifyBackend(
        "disconnected",
        sessionId,
        {
          status: "logged_out",
        }
      );

      logger.info("Session logged out successfully", { sessionId });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          sessionId,
          status: SESSION_STATUS.DISCONNECTED,
          message:
            "Session logged out successfully. Auth data deleted, QR scan required for reconnection.",
        })
      );
    } catch (error) {
      logger.error("Error logging out session:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to logout session")
        );
    }
  }
}

export default SessionController;

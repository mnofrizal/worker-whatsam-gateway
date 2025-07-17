import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
} from "../utils/constants.js";

const startSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId, userId, sessionName } = req.body;

    if (!sessionId || !userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(
        ApiResponse.createValidationErrorResponse([
          { field: "sessionId", message: "sessionId is required" },
          { field: "userId", message: "userId is required" },
        ])
      );
    }

    const existingSession = baileysService.getSessionStatus(sessionId);

    if (existingSession.status !== "not_found") {
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

      logger.info(`Restarting existing session: ${sessionId}`, {
        currentStatus: existingSession.status,
      });

      try {
        await baileysService.restartSession(sessionId);

        if (databaseService.isInitialized()) {
          await databaseService.updateSessionStatus(sessionId, "initializing");
        }

        await workerRegistryService.notifyBackend("reconnecting", sessionId, {
          userId,
          sessionName,
          status: "initializing",
        });

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
        logger.error(`Failed to restart existing session ${sessionId}:`, error);
      }
    }

    logger.info(`Creating new session: ${sessionId}`, { userId });

    await baileysService.createSession(sessionId, userId, sessionName);

    if (databaseService.isInitialized()) {
      await databaseService.createSession({
        sessionId,
        userId,
        sessionName: sessionName || sessionId,
        status: "initializing",
        workerId: workerRegistryService.getWorkerId(),
        createdAt: new Date(),
      });
    }

    if (redisService.isInitialized()) {
      await redisService.setSessionRouting(
        sessionId,
        workerRegistryService.getWorkerId()
      );
    }

    await workerRegistryService.notifyBackend("session_created", sessionId, {
      userId,
      sessionName,
      status: "initializing",
    });

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
      .json(ApiResponse.createInternalErrorResponse("Failed to start session"));
  }
};

const createSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId, userId, sessionName } = req.body;

    if (!sessionId || !userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(
        ApiResponse.createValidationErrorResponse([
          { field: "sessionId", message: "sessionId is required" },
          { field: "userId", message: "userId is required" },
        ])
      );
    }

    const existingSession = baileysService.getSessionStatus(sessionId);
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

    await baileysService.createSession(sessionId, userId, sessionName);

    if (databaseService.isInitialized()) {
      await databaseService.createSession({
        sessionId,
        userId,
        sessionName: sessionName || sessionId,
        status: "initializing",
        workerId: workerRegistryService.getWorkerId(),
        createdAt: new Date(),
      });
    }

    if (redisService.isInitialized()) {
      await redisService.setSessionRouting(
        sessionId,
        workerRegistryService.getWorkerId()
      );
    }

    await workerRegistryService.notifyBackend("session_created", sessionId, {
      userId,
      sessionName,
      status: "initializing",
    });

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
};

const getSessionStatus = async (req, res) => {
  try {
    const { baileys: baileysService, database: databaseService } = req.services;
    const { sessionId } = req.params;
    const sessionStatus = baileysService.getSessionStatus(sessionId);

    if (sessionStatus.status === "not_found") {
      return res
        .status(404)
        .json(ApiResponse.createNotFoundResponse("Session"));
    }

    let additionalInfo = {};
    if (databaseService.isInitialized()) {
      try {
        const dbSession = await databaseService.getSession(sessionId);
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
        ApiResponse.createInternalErrorResponse("Failed to get session status")
      );
  }
};

const deleteSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId } = req.params;

    const sessionStatus = baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status === "not_found") {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(ApiResponse.createNotFoundResponse("Session"));
    }

    await baileysService.deleteSession(sessionId);

    if (databaseService.isInitialized()) {
      await databaseService.deleteSession(sessionId);
    }

    if (redisService.isInitialized()) {
      await redisService.deleteSessionRouting(sessionId);
      await redisService.deleteQRCode(sessionId);
    }

    await workerRegistryService.notifyBackend("session_deleted", sessionId);

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
};

const listSessions = async (req, res) => {
  try {
    const { baileys: baileysService, database: databaseService } = req.services;
    const sessions = baileysService.getAllSessions();
    const sessionsWithInfo = [];

    for (const [sessionId, status] of sessions) {
      let sessionInfo = { sessionId, ...status };

      if (databaseService.isInitialized()) {
        try {
          const dbSession = await databaseService.getSession(sessionId);
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
      .json(ApiResponse.createInternalErrorResponse("Failed to list sessions"));
  }
};

const restartSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId } = req.params;

    const sessionStatus = baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status === "not_found") {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(ApiResponse.createNotFoundResponse("Session"));
    }

    await baileysService.restartSession(sessionId);

    if (databaseService.isInitialized()) {
      await databaseService.updateSessionStatus(sessionId, "restarting");
    }

    await workerRegistryService.notifyBackend("reconnecting", sessionId, {
      status: "restarting",
    });

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
};

const disconnectSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId } = req.params;

    const sessionStatus = baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status === "not_found") {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(ApiResponse.createNotFoundResponse("Session"));
    }

    await baileysService.disconnectSession(sessionId);
    if (databaseService.isInitialized()) {
      await databaseService.updateSessionStatus(sessionId, "disconnected");
    }

    await workerRegistryService.notifyBackend("disconnected", sessionId, {
      status: "disconnected",
    });

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
        ApiResponse.createInternalErrorResponse("Failed to disconnect session")
      );
  }
};

const logoutSession = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      database: databaseService,
      redis: redisService,
      workerRegistry: workerRegistryService,
    } = req.services;
    const { sessionId } = req.params;

    const sessionStatus = baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status === "not_found") {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(ApiResponse.createNotFoundResponse("Session"));
    }

    await baileysService.logoutSession(sessionId);

    if (databaseService.isInitialized()) {
      await databaseService.updateSessionStatus(sessionId, "logged_out");
    }

    if (redisService.isInitialized()) {
      await redisService.deleteQRCode(sessionId);
    }

    await workerRegistryService.notifyBackend("disconnected", sessionId, {
      status: "logged_out",
    });

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
};

export default {
  startSession,
  createSession,
  getSessionStatus,
  deleteSession,
  listSessions,
  restartSession,
  disconnectSession,
  logoutSession,
};

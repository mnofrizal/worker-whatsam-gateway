import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
} from "../utils/constants.js";

/**
 * Unified user management endpoint for WhatsApp sessions
 * POST /api/user/{sessionId}/manage
 */
const manageUser = async (req, res) => {
  try {
    const { baileys: baileysService } = req.services;
    const { sessionId } = req.params;
    const { type } = req.body;

    logger.info(`Managing user for session: ${sessionId}, type: ${type}`);

    // Check if session exists and is connected
    const sessionStatus = baileysService.getSessionStatus(sessionId);
    if (!sessionStatus || sessionStatus.status === "not_found") {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_FOUND,
            `Session ${sessionId} not found`
          )
        );
    }

    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            `Session not connected. Status: ${sessionStatus.status}`
          )
        );
    }

    // Handle different types of user management operations
    switch (type) {
      case "info":
        return await handleGetUserInfo(
          req,
          res,
          baileysService,
          sessionId,
          sessionStatus
        );

      default:
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.INVALID_REQUEST,
              `Unsupported user management type: ${type}`
            )
          );
    }
  } catch (error) {
    logger.error(
      `Error managing user for session ${req.params.sessionId}:`,
      error
    );

    // Handle specific error types
    if (error.message.includes("not authenticated")) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_AUTHENTICATED,
            "Session is not authenticated with WhatsApp"
          )
        );
    }

    if (error.message.includes("not connected")) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected to WhatsApp"
          )
        );
    }

    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          "Failed to manage user operation"
        )
      );
  }
};

/**
 * Handle get user info operation
 */
const handleGetUserInfo = async (
  req,
  res,
  baileysService,
  sessionId,
  sessionStatus
) => {
  try {
    logger.info(`Getting user info for session: ${sessionId}`);

    // Get user info from Baileys service
    const userInfo = await baileysService.getUserInfo(sessionId);

    if (!userInfo) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.USER_INFO_NOT_FOUND,
            "User information not available"
          )
        );
    }

    logger.info(`User info retrieved successfully for session: ${sessionId}`, {
      phoneNumber: userInfo.phoneNumber,
      displayName: userInfo.displayName,
    });

    const responseData = {
      sessionId,
      userInfo: {
        phoneNumber: userInfo.phoneNumber,
        displayName: userInfo.displayName || null,
        profilePicture: userInfo.profilePicture || null,
        statusMessage: userInfo.statusMessage || null,
        businessProfile: userInfo.businessProfile || null,
      },
      sessionStatus: sessionStatus.status,
      connectedAt: sessionStatus.connectedAt || null,
      lastSeen: sessionStatus.lastSeen || null,
    };

    return res
      .status(HTTP_STATUS.OK)
      .json(ApiResponse.createSuccessResponse(responseData));
  } catch (error) {
    logger.error(`Error getting user info for session ${sessionId}:`, error);
    throw error; // Re-throw to be handled by main catch block
  }
};

export default {
  manageUser,
};

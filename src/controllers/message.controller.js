import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
  MESSAGE_TYPES,
  MESSAGE_ACTIONS,
} from "../utils/constants.js";

const getMessageStats = async (req, res) => {
  try {
    const { database: databaseService } = req.services;
    const { sessionId } = req.params;
    const { period = "24h" } = req.query;

    if (!databaseService.isInitialized()) {
      return res
        .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SERVICE_UNAVAILABLE,
            "Message statistics service not available"
          )
        );
    }

    let startDate;
    const endDate = new Date();
    switch (period) {
      case "1h":
        startDate = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "24h":
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const stats = await databaseService.getMessageStats(
      sessionId,
      startDate,
      endDate
    );

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        stats,
      })
    );
  } catch (error) {
    logger.error("Error getting message stats:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          "Failed to get message statistics"
        )
      );
  }
};

const sendSeen = async (req, res) => {
  try {
    const { baileys: baileysService } = req.services;
    const { sessionId } = req.params;
    const { to, messageId } = req.body;

    // Check session status
    const sessionStatus = baileysService.getSessionStatus(sessionId);
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

    // Format phone number (validation already done by Joi)
    const formattedTo = Utils.formatWhatsAppId(to);

    const result = await baileysService.sendSeen(
      sessionId,
      formattedTo,
      messageId
    );

    logger.info("Read receipt sent successfully", {
      sessionId,
      to: formattedTo,
      messageId,
    });

    res.status(HTTP_STATUS.OK).json(ApiResponse.createSuccessResponse(result));
  } catch (error) {
    logger.error("Error sending read receipt:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to send read receipt")
      );
  }
};

const startTyping = async (req, res) => {
  try {
    const { baileys: baileysService } = req.services;
    const { sessionId } = req.params;
    const { to } = req.body;

    // Check session status
    const sessionStatus = baileysService.getSessionStatus(sessionId);
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

    // Format phone number (validation already done by Joi)
    const formattedTo = Utils.formatWhatsAppId(to);

    const result = await baileysService.startTyping(sessionId, formattedTo);

    logger.info("Typing indicator started successfully", {
      sessionId,
      to: formattedTo,
    });

    res.status(HTTP_STATUS.OK).json(ApiResponse.createSuccessResponse(result));
  } catch (error) {
    logger.error("Error starting typing indicator:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          "Failed to start typing indicator"
        )
      );
  }
};

const stopTyping = async (req, res) => {
  try {
    const { baileys: baileysService } = req.services;
    const { sessionId } = req.params;
    const { to } = req.body;

    // Check session status
    const sessionStatus = baileysService.getSessionStatus(sessionId);
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

    // Format phone number (validation already done by Joi)
    const formattedTo = Utils.formatWhatsAppId(to);

    const result = await baileysService.stopTyping(sessionId, formattedTo);

    logger.info("Typing indicator stopped successfully", {
      sessionId,
      to: formattedTo,
    });

    res.status(HTTP_STATUS.OK).json(ApiResponse.createSuccessResponse(result));
  } catch (error) {
    logger.error("Error stopping typing indicator:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          "Failed to stop typing indicator"
        )
      );
  }
};

const manageMessage = async (req, res) => {
  try {
    const { baileys: baileysService } = req.services;
    const { sessionId } = req.params;
    const { action, messageId, phone, content, emoji, forEveryone } = req.body;

    // Check session status
    const sessionStatus = baileysService.getSessionStatus(sessionId);
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

    // Format phone number for WhatsApp (validation already done by Joi)
    const formattedPhone = Utils.formatWhatsAppId(phone);

    let result;

    // Handle different message management actions using switch case (best practice)
    switch (action) {
      case MESSAGE_ACTIONS.DELETE:
        // Check if baileys service has this method
        if (typeof baileysService.deleteMessage === "function") {
          result = await baileysService.deleteMessage(
            sessionId,
            messageId,
            formattedPhone,
            forEveryone
          );
          logger.info("Message deleted successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
            forEveryone,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Delete message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.UNSEND:
        // Check if baileys service has this method
        if (typeof baileysService.unsendMessage === "function") {
          result = await baileysService.unsendMessage(
            sessionId,
            messageId,
            formattedPhone
          );
          logger.info("Message unsent successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Unsend message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.STAR:
        // Check if baileys service has this method
        if (typeof baileysService.starMessage === "function") {
          result = await baileysService.starMessage(
            sessionId,
            messageId,
            formattedPhone,
            true
          );
          logger.info("Message starred successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Star message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.UNSTAR:
        // Check if baileys service has this method
        if (typeof baileysService.starMessage === "function") {
          result = await baileysService.starMessage(
            sessionId,
            messageId,
            formattedPhone,
            false
          );
          logger.info("Message unstarred successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Unstar message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.EDIT:
        // Check if baileys service has this method
        if (typeof baileysService.editMessage === "function") {
          result = await baileysService.editMessage(
            sessionId,
            messageId,
            formattedPhone,
            content
          );
          logger.info("Message edited successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            content,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Edit message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.REACTION:
        // Check if baileys service has this method
        if (typeof baileysService.sendReaction === "function") {
          result = await baileysService.sendReaction(
            sessionId,
            messageId,
            formattedPhone,
            emoji
          );
          logger.info("Reaction sent successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            emoji,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Reaction action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.PIN:
        // Check if baileys service has this method
        if (typeof baileysService.pinMessage === "function") {
          result = await baileysService.pinMessage(
            sessionId,
            messageId,
            formattedPhone,
            true
          );
          logger.info("Message pinned successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Pin message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.UNPIN:
        // Check if baileys service has this method
        if (typeof baileysService.pinMessage === "function") {
          result = await baileysService.pinMessage(
            sessionId,
            messageId,
            formattedPhone,
            false
          );
          logger.info("Message unpinned successfully", {
            sessionId,
            messageId,
            phone: formattedPhone,
            action,
          });
        } else {
          return res
            .status(HTTP_STATUS.NOT_IMPLEMENTED)
            .json(
              ApiResponse.createErrorResponse(
                ERROR_CODES.NOT_IMPLEMENTED,
                "Unpin message action not implemented in Baileys service"
              )
            );
        }
        break;

      case MESSAGE_ACTIONS.READ:
        // This action is supported by the existing sendSeen method
        result = await baileysService.sendSeen(
          sessionId,
          formattedPhone,
          messageId
        );
        logger.info("Message marked as read successfully", {
          sessionId,
          phone: formattedPhone,
          messageId,
          action,
        });
        break;

      default:
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.INVALID_INPUT,
              `Unsupported action: ${action}. Supported actions: ${Object.values(MESSAGE_ACTIONS).join(", ")}`
            )
          );
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        action,
        messageId,
        phone: formattedPhone,
        result,
      })
    );
  } catch (error) {
    logger.error("Error managing message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          `Failed to ${req.body.action} message`
        )
      );
  }
};

export default {
  sendSeen,
  startTyping,
  stopTyping,
  getMessageStats,
  manageMessage,
};

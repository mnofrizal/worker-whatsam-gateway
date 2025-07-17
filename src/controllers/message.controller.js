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

const deleteMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, forEveryone = false, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID is required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to delete message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // Delete message via Baileys
    const result = await baileysService.deleteMessage(
      sessionId,
      messageId,
      forEveryone,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `delete_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} deleted ${forEveryone ? "for everyone" : "for me"}`,
        status: "sent",
        timestamp: new Date().toISOString(),
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.DELETE,
        forEveryone,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error deleting message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to delete message")
      );
  }
};

const unsendMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID is required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to unsend message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // Unsend message via Baileys (delete for everyone)
    const result = await baileysService.unsendMessage(
      sessionId,
      messageId,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `unsend_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} unsent`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.UNSEND,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.UNSEND,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error unsending message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to unsend message")
      );
  }
};

const starMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID is required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to star message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // Star message via Baileys
    const result = await baileysService.starMessage(
      sessionId,
      messageId,
      true,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `star_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} starred`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.STAR,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.STAR,
        starred: true,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error starring message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createInternalErrorResponse("Failed to star message"));
  }
};

const unstarMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID is required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to unstar message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // Unstar message via Baileys
    const result = await baileysService.starMessage(
      sessionId,
      messageId,
      false,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `unstar_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} unstarred`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.UNSTAR,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.UNSTAR,
        starred: false,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error unstarring message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to unstar message")
      );
  }
};

const editMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, newText, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId || !newText) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID and new text are required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to edit message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // Edit message via Baileys
    const result = await baileysService.editMessage(
      sessionId,
      messageId,
      newText,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `edit_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} edited`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.EDIT,
          newText,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.EDIT,
        newText,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error editing message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createInternalErrorResponse("Failed to edit message"));
  }
};

const reactToMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId, emoji, phone } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId || !emoji) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID and emoji are required"
          )
        );
    }

    if (!phone) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Recipient phone number (phone) is required to react to message"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Format the recipient phone number to WhatsApp JID
    const remoteJid = Utils.formatWhatsAppId(phone);

    // React to message via Baileys
    const result = await baileysService.reactToMessage(
      sessionId,
      messageId,
      emoji,
      remoteJid
    );

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `reaction_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Reacted ${emoji} to message ${messageId}`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.REACTION,
          reaction: emoji,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.REACTION,
        emoji,
        remoteJid: result.remoteJid,
        status: result.status,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    logger.error("Error reacting to message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to react to message")
      );
  }
};

const readMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId } = req.body;
    const { baileys: baileysService, database: databaseService } = req.services;

    // Validate required fields
    if (!messageId) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Message ID is required"
          )
        );
    }

    // Check session status
    const sessionStatus = await baileysService.getSessionStatus(sessionId);
    if (sessionStatus.status !== SESSION_STATUS.CONNECTED) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SESSION_NOT_CONNECTED,
            "Session is not connected"
          )
        );
    }

    // Mark message as read via Baileys
    const result = await baileysService.readMessage(sessionId, messageId);

    // Log to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: `read_${Date.now()}`,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Message ${messageId} marked as read`,
        status: "sent",
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageId: messageId,
          action: MESSAGE_ACTIONS.READ,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(
      ApiResponse.createSuccessResponse({
        messageId,
        action: MESSAGE_ACTIONS.READ,
        timestamp: new Date().toISOString(),
        ...result,
      })
    );
  } catch (error) {
    logger.error("Error marking message as read:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse(
          "Failed to mark message as read"
        )
      );
  }
};

const manageMessage = async (req, res) => {
  try {
    const { action } = req.body;

    // Validate action parameter
    if (!action) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Action parameter is required"
          )
        );
    }

    // Handle different message management actions
    switch (action.toLowerCase()) {
      case MESSAGE_ACTIONS.DELETE:
        return await deleteMessage(req, res);
      case MESSAGE_ACTIONS.UNSEND:
        return await unsendMessage(req, res);
      case MESSAGE_ACTIONS.STAR:
        return await starMessage(req, res);
      case MESSAGE_ACTIONS.UNSTAR:
        return await unstarMessage(req, res);
      case MESSAGE_ACTIONS.EDIT:
        return await editMessage(req, res);
      case MESSAGE_ACTIONS.REACTION:
        return await reactToMessage(req, res);
      case MESSAGE_ACTIONS.READ:
        return await readMessage(req, res);
      default:
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.INVALID_REQUEST,
              `Unsupported action: ${action}. Supported actions: ${Object.values(MESSAGE_ACTIONS).join(", ")}`
            )
          );
    }
  } catch (error) {
    logger.error("Error managing message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to manage message")
      );
  }
};

// sendSeen, startTyping, and stopTyping functions have been removed
// These functionalities are now handled by the unified sendMessage function
// with type: "seen", "typing_start", and "typing_stop" respectively

export default {
  getMessageStats,
  deleteMessage,
  unsendMessage,
  starMessage,
  unstarMessage,
  editMessage,
  reactToMessage,
  readMessage,
  manageMessage,
};

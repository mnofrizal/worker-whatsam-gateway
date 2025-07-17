import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
  MESSAGE_TYPES,
} from "../utils/constants.js";

const sendMessage = async (req, res) => {
  try {
    const {
      baileys: baileysService,
      storage: storageService,
      database: databaseService,
    } = req.services;
    const { sessionId } = req.params;
    const {
      to,
      type,
      message,
      mediaUrl,
      caption,
      filename,
      location,
      contact,
      humanSimulation = true, // Default to true for human-like behavior
    } = req.body;

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

    let result;
    let messageType = type.toUpperCase();
    let messageContent;
    let messageData = {};

    // Prepare options for human simulation
    const sendOptions = { humanSimulation };

    // Handle different message types
    switch (type.toLowerCase()) {
      case "text":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            text: message,
          },
          sendOptions
        );
        messageContent = message;
        messageData = { text: message };
        break;

      case "image":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            image: { url: mediaUrl },
            caption: caption || "",
          },
          sendOptions
        );
        messageContent = caption || "Image";
        messageData = { mediaUrl, caption };
        break;

      case "document":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            document: { url: mediaUrl },
            fileName: filename || "document",
            caption: caption || "",
          },
          sendOptions
        );
        messageContent = filename || "Document";
        messageData = { mediaUrl, filename, caption };
        break;

      case "video":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            video: { url: mediaUrl },
            caption: caption || "",
          },
          sendOptions
        );
        messageContent = caption || "Video";
        messageData = { mediaUrl, caption };
        break;

      case "audio":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            audio: { url: mediaUrl },
          },
          sendOptions
        );
        messageContent = "Audio";
        messageData = { mediaUrl };
        break;

      case "location":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            location: {
              degreesLatitude: location.latitude,
              degreesLongitude: location.longitude,
              name: location.name || "",
              address: location.address || "",
            },
          },
          sendOptions
        );
        messageContent =
          location.name ||
          `Location: ${location.latitude}, ${location.longitude}`;
        messageData = { location };
        break;

      case "contact":
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            contacts: {
              displayName: contact.name,
              contacts: [
                {
                  displayName: contact.name,
                  vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL:${contact.phone}${contact.email ? `\nEMAIL:${contact.email}` : ""}${contact.organization ? `\nORG:${contact.organization}` : ""}\nEND:VCARD`,
                },
              ],
            },
          },
          sendOptions
        );
        messageContent = `Contact: ${contact.name}`;
        messageData = { contact };
        break;

      default:
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.INVALID_REQUEST,
              `Unsupported message type: ${type}`
            )
          );
    }

    // Save message to database if available
    if (databaseService.isInitialized()) {
      await databaseService.saveMessage({
        sessionId,
        messageId: result.messageId,
        from: sessionStatus.phoneNumber,
        to: formattedTo,
        content: messageContent,
        type: messageType,
        status: result.status,
        mediaUrl: ["image", "document", "video", "audio"].includes(
          type.toLowerCase()
        )
          ? mediaUrl
          : null,
        metadata: JSON.stringify(messageData),
        timestamp: new Date().toISOString(),
      });
    }

    logger.info("Message sent successfully", {
      sessionId,
      to: formattedTo,
      type: messageType,
      messageId: result.messageId,
    });

    // Prepare response data based on message type
    const responseData = {
      ...result,
      type: messageType,
      to: formattedTo,
    };

    // Add type-specific data to response
    switch (type.toLowerCase()) {
      case "text":
        responseData.message = message;
        break;
      case "image":
      case "document":
      case "video":
      case "audio":
        responseData.mediaUrl = mediaUrl;
        if (caption) responseData.caption = caption;
        if (filename && type.toLowerCase() === "document")
          responseData.filename = filename;
        break;
      case "location":
        responseData.location = location;
        break;
      case "contact":
        responseData.contact = contact;
        break;
    }

    res
      .status(HTTP_STATUS.OK)
      .json(ApiResponse.createSuccessResponse(responseData));
  } catch (error) {
    logger.error("Error sending message:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createInternalErrorResponse("Failed to send message"));
  }
};

const getMessageHistory = async (req, res) => {
  try {
    const { database: databaseService } = req.services;
    const { sessionId } = req.params;
    const {
      contact,
      limit = 50,
      offset = 0,
      startDate,
      endDate,
      type,
    } = req.query;

    if (!databaseService.isInitialized()) {
      return res
        .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
        .json(
          ApiResponse.createErrorResponse(
            ERROR_CODES.SERVICE_UNAVAILABLE,
            "Message history service not available"
          )
        );
    }

    // Build filters (validation already done by Joi)
    const filters = {
      sessionId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    // Format contact if provided (validation already done by Joi)
    if (contact) {
      filters.contact = Utils.formatWhatsAppId(contact);
    }
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (type) filters.type = type;

    const result = await databaseService.getMessages(
      sessionId,
      filters.limit,
      filters.offset
    );

    res
      .status(HTTP_STATUS.OK)
      .json(
        ApiResponse.createPaginatedResponse(
          result.messages,
          result.total,
          Math.floor(parseInt(offset) / parseInt(limit)) + 1,
          parseInt(limit)
        )
      );
  } catch (error) {
    logger.error("Error getting message history:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(
        ApiResponse.createInternalErrorResponse("Failed to get message history")
      );
  }
};

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

export default {
  sendMessage,
  sendSeen,
  startTyping,
  stopTyping,
  getMessageHistory,
  getMessageStats,
};

import logger from "../utils/logger.js";
import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SESSION_STATUS,
  MESSAGE_TYPES,
} from "../utils/constants.js";

class MessageController {
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

  async sendTextMessage(req, res) {
    try {
      const { sessionId } = req.params;
      const { to, message } = req.body;

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
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse("Validation failed", [
            {
              field: "to",
              message:
                "Invalid phone number format. Supported formats: +6287733760363, 087733760363, 87733760363, or 6287733760363@s.whatsapp.net",
            },
          ])
        );
      }

      // Check session status
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
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

      // Format WhatsApp number using Utils helper
      let formattedTo;
      try {
        formattedTo = Utils.formatWhatsAppId(to);
      } catch (error) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse("Validation failed", [
            {
              field: "to",
              message: `Phone number formatting error: ${error.message}`,
            },
          ])
        );
      }

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
        await this.databaseService.logMessage({
          sessionId,
          messageId: result.messageId,
          from: sessionStatus.phoneNumber,
          to: formattedTo,
          message,
          type: MESSAGE_TYPES.TEXT,
          direction: "outgoing",
          status: result.status,
          timestamp: new Date(),
        });
      }

      logger.info("Text message sent", {
        sessionId,
        to: formattedTo,
        messageId: result.messageId,
      });

      res
        .status(HTTP_STATUS.OK)
        .json(ApiResponse.createSuccessResponse(result));
    } catch (error) {
      logger.error("Error sending text message:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse("Failed to send text message")
        );
    }
  }

  async sendMediaMessage(req, res) {
    try {
      const { sessionId } = req.params;
      const { to, caption } = req.body;
      const file = req.file;

      // Validate required fields
      if (!to || !file) {
        const errors = [];
        if (!to) errors.push({ field: "to", message: "to is required" });
        if (!file)
          errors.push({ field: "file", message: "media file is required" });

        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(ApiResponse.createValidationErrorResponse(errors));
      }

      // Validate phone number format
      if (!Utils.isValidPhoneNumber(to)) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createValidationErrorResponse("Validation failed", [
              {
                field: "to",
                message:
                  "Invalid phone number format. Supported formats: +6287733760363, 087733760363, 87733760363, or 6287733760363@s.whatsapp.net",
              },
            ])
          );
      }

      // Check session status
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
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

      // Format WhatsApp number using Utils helper
      let formattedTo;
      try {
        formattedTo = Utils.formatWhatsAppId(to);
      } catch (error) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            ApiResponse.createValidationErrorResponse("Validation failed", [
              {
                field: "to",
                message: `Phone number formatting error: ${error.message}`,
              },
            ])
          );
      }

      // Upload media to storage
      let mediaUrl = null;
      if (this.storageService.isInitialized()) {
        try {
          const uploadResult = await this.storageService.uploadMedia(
            sessionId,
            file.buffer,
            file.originalname,
            file.mimetype
          );
          mediaUrl = uploadResult.url;
        } catch (error) {
          logger.warn("Failed to upload media to storage:", error);
        }
      }

      // Determine message type based on MIME type
      let messageType = MESSAGE_TYPES.DOCUMENT;
      if (file.mimetype.startsWith("image/")) {
        messageType = MESSAGE_TYPES.IMAGE;
      } else if (file.mimetype.startsWith("video/")) {
        messageType = MESSAGE_TYPES.VIDEO;
      } else if (file.mimetype.startsWith("audio/")) {
        messageType = MESSAGE_TYPES.AUDIO;
      }

      // Prepare media message
      const mediaMessage = {
        [messageType]: file.buffer,
        caption: caption || "",
        fileName: file.originalname,
        mimetype: file.mimetype,
      };

      // Send media message
      const result = await this.baileysService.sendMessage(
        sessionId,
        formattedTo,
        mediaMessage
      );

      // Log message in database
      if (this.databaseService.isInitialized()) {
        await this.databaseService.logMessage({
          sessionId,
          messageId: result.messageId,
          from: sessionStatus.phoneNumber,
          to: formattedTo,
          message: caption || file.originalname,
          type: messageType,
          direction: "outgoing",
          status: result.status,
          mediaUrl,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          timestamp: new Date(),
        });
      }

      logger.info("Media message sent", {
        sessionId,
        to: formattedTo,
        messageId: result.messageId,
        type: messageType,
        fileName: file.originalname,
      });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          ...result,
          mediaUrl,
          fileName: file.originalname,
          fileSize: Utils.formatBytes(file.size),
          fileSizeBytes: file.size,
          type: messageType,
          mimeType: file.mimetype,
        })
      );
    } catch (error) {
      logger.error("Error sending media message:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse(
            "Failed to send media message"
          )
        );
    }
  }

  async getMessageHistory(req, res) {
    try {
      const { sessionId } = req.params;
      const {
        contact,
        limit = 50,
        offset = 0,
        startDate,
        endDate,
        type,
      } = req.query;

      // Check if database is available
      if (!this.databaseService.isInitialized()) {
        return res
          .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.SERVICE_UNAVAILABLE,
              "Message history service not available"
            )
          );
      }

      // Build query filters
      const filters = {
        sessionId,
        limit: parseInt(limit),
        offset: parseInt(offset),
      };

      if (contact) {
        try {
          filters.contact = Utils.formatWhatsAppId(contact);
        } catch (error) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              ApiResponse.createValidationErrorResponse("Validation failed", [
                {
                  field: "contact",
                  message: `Phone number formatting error: ${error.message}`,
                },
              ])
            );
        }
      }

      if (startDate) {
        filters.startDate = new Date(startDate);
      }

      if (endDate) {
        filters.endDate = new Date(endDate);
      }

      if (type) {
        filters.type = type;
      }

      // Get messages from database
      const result = await this.databaseService.getMessageHistory(filters);

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
          ApiResponse.createInternalErrorResponse(
            "Failed to get message history"
          )
        );
    }
  }

  async getMessageStats(req, res) {
    try {
      const { sessionId } = req.params;
      const { period = "24h" } = req.query;

      // Check if database is available
      if (!this.databaseService.isInitialized()) {
        return res
          .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
          .json(
            ApiResponse.createErrorResponse(
              ERROR_CODES.SERVICE_UNAVAILABLE,
              "Message statistics service not available"
            )
          );
      }

      // Calculate date range based on period
      let startDate;
      const endDate = new Date();

      switch (period) {
        case "1h":
          startDate = new Date(Date.now() - 60 * 60 * 1000);
          break;
        case "24h":
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case "7d":
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30d":
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      // Get statistics from database
      const stats = await this.databaseService.getMessageStats(
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
  }

  async bulkSendMessages(req, res) {
    try {
      const { sessionId } = req.params;
      const { messages, delay = 1000 } = req.body;

      // Validate input
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse([
            {
              field: "messages",
              message: "messages array is required and cannot be empty",
            },
          ])
        );
      }

      if (messages.length > 100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          ApiResponse.createValidationErrorResponse([
            {
              field: "messages",
              message: "Maximum 100 messages allowed per bulk request",
            },
          ])
        );
      }

      // Check session status
      const sessionStatus = this.baileysService.getSessionStatus(sessionId);
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

      const results = [];
      const errors = [];

      // Send messages with delay
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        try {
          // Validate message format
          if (!msg.to || !msg.message) {
            errors.push({
              index: i,
              error: "to and message are required",
              message: msg,
            });
            continue;
          }

          // Format WhatsApp number using Utils helper
          let formattedTo;
          try {
            formattedTo = Utils.formatWhatsAppId(msg.to);
          } catch (error) {
            errors.push({
              index: i,
              error: `Phone number formatting error: ${error.message}`,
              message: msg,
            });
            continue;
          }

          // Send message
          const result = await this.baileysService.sendMessage(
            sessionId,
            formattedTo,
            {
              text: msg.message,
            }
          );

          results.push({
            index: i,
            to: formattedTo,
            messageId: result.messageId,
            status: result.status,
          });

          // Log message in database
          if (this.databaseService.isInitialized()) {
            await this.databaseService.logMessage({
              sessionId,
              messageId: result.messageId,
              from: sessionStatus.phoneNumber,
              to: formattedTo,
              message: msg.message,
              type: MESSAGE_TYPES.TEXT,
              direction: "outgoing",
              status: result.status,
              timestamp: new Date(),
            });
          }

          // Add delay between messages (except for the last one)
          if (i < messages.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (error) {
          logger.error(`Error sending bulk message ${i}:`, error);
          errors.push({
            index: i,
            error: error.message,
            message: msg,
          });
        }
      }

      logger.info("Bulk messages processed", {
        sessionId,
        total: messages.length,
        successful: results.length,
        failed: errors.length,
      });

      res.status(HTTP_STATUS.OK).json(
        ApiResponse.createSuccessResponse({
          total: messages.length,
          successful: results.length,
          failed: errors.length,
          results,
          errors,
        })
      );
    } catch (error) {
      logger.error("Error in bulk send messages:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          ApiResponse.createInternalErrorResponse(
            "Failed to process bulk messages"
          )
        );
    }
  }
}

export default MessageController;

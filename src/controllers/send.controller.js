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
      link,
      poll,
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

      case "link":
        result = await baileysService.sendLinkMessage(
          sessionId,
          formattedTo,
          link,
          sendOptions
        );
        messageContent = link.title || link.url;
        messageData = { link };
        break;

      case "poll":
        result = await baileysService.sendPollMessage(
          sessionId,
          formattedTo,
          poll,
          sendOptions
        );
        messageContent = `Poll: ${poll.question}`;
        messageData = { poll };
        break;

      case "seen":
        const { messageId } = req.body;
        result = await baileysService.sendSeen(
          sessionId,
          formattedTo,
          messageId
        );
        messageContent = "Read receipt sent";
        messageData = { messageId };
        break;

      case "typing_start":
        result = await baileysService.startTyping(sessionId, formattedTo);
        messageContent = "Typing indicator started";
        messageData = {};
        break;

      case "typing_stop":
        result = await baileysService.stopTyping(sessionId, formattedTo);
        messageContent = "Typing indicator stopped";
        messageData = {};
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

    // Save message to database if available (skip for typing indicators as they're temporary)
    if (
      databaseService.isInitialized() &&
      !["typing_start", "typing_stop"].includes(type.toLowerCase())
    ) {
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
      case "link":
        responseData.link = link;
        break;
      case "poll":
        responseData.poll = poll;
        break;
      case "seen":
        responseData.messageId = req.body.messageId;
        break;
      case "typing_start":
      case "typing_stop":
        // No additional data needed for typing indicators
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

export default {
  sendMessage,
};

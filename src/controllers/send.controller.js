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
      contactName,
      contactPhone,
      contactEmail,
      contactOrganization,
      url,
      text,
      question,
      options,
      maxAnswer,
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
        const contactData = {
          contactName,
          contactPhone,
          contactEmail,
          contactOrganization,
        };
        result = await baileysService.sendContact(
          sessionId,
          formattedTo,
          contactData,
          sendOptions
        );
        messageContent = `Contact: ${contactName}`;
        messageData = contactData;
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
        messageType = "SEEN";
        break;

      case "typing_start":
        result = await baileysService.startTyping(sessionId, formattedTo);
        messageContent = "Typing indicator started";
        messageData = {};
        messageType = "TYPING_START";
        break;

      case "typing_stop":
        result = await baileysService.stopTyping(sessionId, formattedTo);
        messageContent = "Typing indicator stopped";
        messageData = {};
        messageType = "TYPING_STOP";
        break;

      case "link":
        // Baileys automatically generates link previews when link-preview-js is installed
        // Simply send text with URL - Baileys will handle the preview generation
        const linkText = text ? `${text}\n\n${url}` : url;
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            text: linkText,
          },
          sendOptions
        );
        messageContent = `Link: ${url}`;
        messageData = { url, text };
        messageType = "LINK";
        break;

      case "poll":
        // Check if Baileys supports polls in the current version
        result = await baileysService.sendMessage(
          sessionId,
          formattedTo,
          {
            poll: {
              name: question,
              values: options,
              selectableCount: maxAnswer || 1,
            },
          },
          sendOptions
        );
        messageContent = `Poll: ${question}`;
        messageData = { question, options, maxAnswer };
        messageType = "POLL";
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
        responseData.contactName = contactName;
        responseData.contactPhone = contactPhone;
        if (contactEmail) responseData.contactEmail = contactEmail;
        if (contactOrganization)
          responseData.contactOrganization = contactOrganization;
        break;
      case "link":
        responseData.url = url;
        if (text) responseData.text = text;
        break;
      case "poll":
        responseData.question = question;
        responseData.options = options;
        responseData.maxAnswer = maxAnswer;
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

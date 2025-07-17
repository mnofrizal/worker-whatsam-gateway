import logger from "../../utils/logger.js";

let sessionManagement;

const setServices = (services) => {
  sessionManagement = services.sessionManagement;
};

const simulateHumanBehavior = async (socket, sessionId, to) => {
  if (!socket || !socket.user) {
    return; // Skip simulation if session not ready
  }

  try {
    // Generate random delays to simulate human behavior
    const readDelay = Math.floor(Math.random() * 200) + 300; // 0.3-0.5 seconds
    const typingDelay = Math.floor(Math.random() * 1000) + 1000; // 1-2 seconds
    const beforeSendDelay = Math.floor(Math.random() * 600) + 400; // 0.4-1.0 seconds

    logger.info(
      `[HUMAN SIMULATION] Starting human behavior simulation for ${sessionId} to ${to}`,
      {
        readDelay,
        typingDelay,
        beforeSendDelay,
        totalDelay: readDelay + typingDelay + beforeSendDelay,
      }
    );

    // Step 1: Simulate reading previous messages (send read receipt)
    try {
      await new Promise((resolve) => setTimeout(resolve, readDelay));
      await socket.sendPresenceUpdate("available", to);
      logger.debug(
        `[HUMAN SIMULATION] Sent presence update (available) for ${sessionId}`
      );
    } catch (error) {
      logger.warn(
        `[HUMAN SIMULATION] Failed to send presence update for ${sessionId}:`,
        error
      );
    }

    // Step 2: Start typing indicator
    try {
      await socket.sendPresenceUpdate("composing", to);
      logger.debug(
        `[HUMAN SIMULATION] Started typing indicator for ${sessionId}`
      );
    } catch (error) {
      logger.warn(
        `[HUMAN SIMULATION] Failed to start typing indicator for ${sessionId}:`,
        error
      );
    }

    // Step 3: Simulate typing time
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    // Step 4: Brief pause before sending (like finishing typing)
    try {
      await socket.sendPresenceUpdate("paused", to);
      logger.debug(
        `[HUMAN SIMULATION] Paused typing indicator for ${sessionId}`
      );
    } catch (error) {
      logger.warn(
        `[HUMAN SIMULATION] Failed to pause typing indicator for ${sessionId}:`,
        error
      );
    }

    // Step 5: Final delay before sending
    await new Promise((resolve) => setTimeout(resolve, beforeSendDelay));

    logger.info(
      `[HUMAN SIMULATION] Human behavior simulation completed for ${sessionId}`,
      {
        totalSimulationTime: readDelay + typingDelay + beforeSendDelay,
      }
    );
  } catch (error) {
    logger.error(
      `[HUMAN SIMULATION] Error during human behavior simulation for ${sessionId}:`,
      error
    );
    // Continue with message sending even if simulation fails
  }
};

const sendMessage = async (sessionId, to, message, options = {}) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    // Check if human simulation is enabled (default: true)
    const enableHumanSimulation = options.humanSimulation !== false;

    if (enableHumanSimulation) {
      logger.info(
        `[HUMAN SIMULATION] Simulating human behavior before sending message from ${sessionId} to ${to}`
      );
      await simulateHumanBehavior(socket, sessionId, to);
    }

    logger.info(`Sending message from ${sessionId} to ${to}`, {
      messageType:
        typeof message === "object" ? Object.keys(message)[0] : "text",
      humanSimulation: enableHumanSimulation,
    });

    const result = await socket.sendMessage(to, message);

    // Stop typing indicator after sending
    if (enableHumanSimulation) {
      try {
        await socket.sendPresenceUpdate("available", to);
        logger.debug(
          `[HUMAN SIMULATION] Stopped typing indicator after sending message from ${sessionId}`
        );
      } catch (error) {
        logger.warn(
          `[HUMAN SIMULATION] Failed to stop typing indicator after sending for ${sessionId}:`,
          error
        );
      }
    }

    logger.info(`Message sent successfully from ${sessionId}`, {
      messageId: result.key.id,
      to,
      messageType:
        typeof message === "object" ? Object.keys(message)[0] : "text",
      humanSimulation: enableHumanSimulation,
    });

    return {
      messageId: result.key.id,
      status: "sent",
      to,
      humanSimulation: enableHumanSimulation,
    };
  } catch (error) {
    logger.error(`Failed to send message from ${sessionId}:`, error);
    throw new Error(`Failed to send message: ${error.message}`);
  }
};

const sendSeen = async (sessionId, jid, messageKey) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(
      `Sending read receipt from ${sessionId} to ${jid} for message ${messageKey.id}`
    );

    await socket.readMessages([messageKey]);

    logger.info(`Read receipt sent successfully from ${sessionId}`, {
      messageId: messageKey.id,
      to: jid,
    });

    return {
      success: true,
      messageId: messageKey.id,
      to: jid,
      status: "seen",
    };
  } catch (error) {
    logger.error(`Failed to send read receipt from ${sessionId}:`, error);
    throw new Error(`Failed to send read receipt: ${error.message}`);
  }
};

const startTyping = async (sessionId, jid) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(`Starting typing indicator from ${sessionId} to ${jid}`);

    await socket.sendPresenceUpdate("composing", jid);

    logger.info(`Typing indicator started successfully from ${sessionId}`, {
      to: jid,
    });

    return {
      success: true,
      to: jid,
      status: "typing",
    };
  } catch (error) {
    logger.error(`Failed to start typing indicator from ${sessionId}:`, error);
    throw new Error(`Failed to start typing indicator: ${error.message}`);
  }
};

const stopTyping = async (sessionId, jid) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(`Stopping typing indicator from ${sessionId} to ${jid}`);

    await socket.sendPresenceUpdate("paused", jid);

    logger.info(`Typing indicator stopped successfully from ${sessionId}`, {
      to: jid,
    });

    return {
      success: true,
      to: jid,
      status: "stopped_typing",
    };
  } catch (error) {
    logger.error(`Failed to stop typing indicator from ${sessionId}:`, error);
    throw new Error(`Failed to stop typing indicator: ${error.message}`);
  }
};

const sendLinkMessage = async (
  sessionId,
  to,
  url,
  title,
  description,
  thumbnailUrl,
  options = {}
) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    const linkData = { url, title, description, thumbnail: thumbnailUrl };

    logger.info(`Sending link message from ${sessionId} to ${to}`, {
      url: linkData.url,
      title: linkData.title,
      description: linkData.description,
      thumbnail: !!linkData.thumbnail,
    });

    // Check if human simulation is enabled (default: true)
    const enableHumanSimulation = options.humanSimulation !== false;

    if (enableHumanSimulation) {
      logger.info(
        `[HUMAN SIMULATION] Simulating human behavior before sending link message from ${sessionId} to ${to}`
      );
      await simulateHumanBehavior(socket, sessionId, to);
    }

    let finalMessage;
    let previewMethod = "automatic";

    // Check if custom preview data is provided
    const hasCustomPreview =
      linkData.title || linkData.description || linkData.thumbnail;

    if (hasCustomPreview) {
      logger.info(`Creating custom link preview for ${linkData.url}`, {
        hasTitle: !!linkData.title,
        hasDescription: !!linkData.description,
        hasThumbnail: !!linkData.thumbnail,
      });

      // Process thumbnail if provided
      let thumbnailBuffer = null;
      if (linkData.thumbnail) {
        try {
          if (
            typeof linkData.thumbnail === "string" &&
            linkData.thumbnail.startsWith("data:image/")
          ) {
            const base64Data = linkData.thumbnail.split(",")[1];
            thumbnailBuffer = Buffer.from(base64Data, "base64");
            logger.info(`Processed base64 thumbnail for ${linkData.url}`);
          } else if (Buffer.isBuffer(linkData.thumbnail)) {
            thumbnailBuffer = linkData.thumbnail;
            logger.info(`Using provided buffer thumbnail for ${linkData.url}`);
          } else if (
            typeof linkData.thumbnail === "string" &&
            linkData.thumbnail.startsWith("http")
          ) {
            // For URL thumbnails, fetch and convert to buffer
            const axios = await import("axios");
            const response = await axios.default.get(linkData.thumbnail, {
              responseType: "arraybuffer",
            });
            thumbnailBuffer = Buffer.from(response.data);
            logger.info(`Downloaded thumbnail from URL for ${linkData.url}`);
          }
        } catch (thumbnailError) {
          logger.warn(
            `Failed to process thumbnail for ${linkData.url}:`,
            thumbnailError
          );
          thumbnailBuffer = null;
        }
      }

      // Use extendedTextMessage with contextInfo for custom link preview
      finalMessage = {
        text: linkData.url,
        contextInfo: {
          externalAdReply: {
            title: linkData.title || "Link Preview",
            body: linkData.description || "Click to view link",
            mediaType: 1,
            sourceUrl: linkData.url,
            thumbnailUrl:
              typeof linkData.thumbnail === "string" &&
              linkData.thumbnail.startsWith("http")
                ? linkData.thumbnail
                : undefined,
            jpegThumbnail: thumbnailBuffer,
            renderLargerThumbnail: true,
            showAdAttribution: false,
          },
        },
      };
      previewMethod = "custom_with_context";

      logger.info(
        `Using extendedTextMessage with contextInfo for ${linkData.url}`,
        {
          title: linkData.title || "Link Preview",
          description: linkData.description || "Click to view link",
          hasThumbnail: !!thumbnailBuffer,
        }
      );
    } else {
      // No custom preview data provided, use Baileys' built-in automatic link preview
      logger.info(
        `Using Baileys built-in automatic link preview for ${linkData.url}`
      );

      // Send as simple text message - Baileys will automatically generate preview
      finalMessage = {
        text: linkData.url,
      };
      previewMethod = "baileys_automatic";

      logger.info(
        `Using Baileys automatic link preview generation for ${linkData.url}`,
        {
          method: "baileys_automatic",
          note: "Baileys will automatically generate preview using link-preview-js",
        }
      );
    }

    logger.info(`Sending link message from ${sessionId} to ${to}`, {
      messageType: "link",
      url: linkData.url,
      previewMethod,
      hasCustomTitle: !!linkData.title,
      hasCustomDescription: !!linkData.description,
      hasCustomThumbnail: !!linkData.thumbnail,
      humanSimulation: enableHumanSimulation,
    });

    const result = await socket.sendMessage(to, finalMessage);

    // Stop typing indicator after sending
    if (enableHumanSimulation) {
      try {
        await socket.sendPresenceUpdate("available", to);
        logger.debug(
          `[HUMAN SIMULATION] Stopped typing indicator after sending link message from ${sessionId}`
        );
      } catch (error) {
        logger.warn(
          `[HUMAN SIMULATION] Failed to stop typing indicator after sending for ${sessionId}:`,
          error
        );
      }
    }

    logger.info(`Link message sent successfully from ${sessionId}`, {
      messageId: result.key.id,
      to,
      url: linkData.url,
      previewMethod,
      humanSimulation: enableHumanSimulation,
    });

    return {
      messageId: result.key.id,
      status: "sent",
      to,
      url: linkData.url,
      previewMethod,
      humanSimulation: enableHumanSimulation,
    };
  } catch (error) {
    logger.error(`Failed to send link message from ${sessionId}:`, error);
    throw new Error(`Failed to send link message: ${error.message}`);
  }
};

const sendPollMessage = async (
  sessionId,
  to,
  pollName,
  pollOptions,
  selectableCount = 1,
  options = {}
) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(`Sending poll message from ${sessionId} to ${to}`, {
      question: pollName,
      optionsCount: pollOptions.length,
      selectableCount,
    });

    // Create poll message
    const pollMessage = {
      poll: {
        name: pollName,
        values: pollOptions,
        selectableCount: selectableCount || 1,
      },
    };

    return await sendMessage(sessionId, to, pollMessage, options);
  } catch (error) {
    logger.error(`Failed to send poll message from ${sessionId}:`, error);
    throw new Error(`Failed to send poll message: ${error.message}`);
  }
};

export default {
  setServices,
  sendMessage,
  sendSeen,
  startTyping,
  stopTyping,
  sendLinkMessage,
  sendPollMessage,
  simulateHumanBehavior,
};

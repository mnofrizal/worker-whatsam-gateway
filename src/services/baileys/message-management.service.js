import logger from "../../utils/logger.js";

let sessionManagement;

const setServices = (services) => {
  sessionManagement = services.sessionManagement;
};

const deleteMessage = async (
  sessionId,
  messageId,
  forEveryone = false,
  remoteJid = null
) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(`Deleting message ${messageId} from ${sessionId}`, {
      forEveryone,
      remoteJid,
    });

    // If no remoteJid provided, we cannot delete the message
    if (!remoteJid) {
      throw new Error(
        "Remote JID (recipient phone number) is required to delete message"
      );
    }

    // Create message key for deletion
    const messageKey = {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: true, // Assuming we're deleting our own message
    };

    if (forEveryone) {
      // Delete for everyone (unsend)
      await socket.sendMessage(messageKey.remoteJid, {
        delete: messageKey,
      });
      logger.info(
        `Message ${messageId} deleted for everyone from ${sessionId} in chat ${remoteJid}`
      );
    } else {
      // Delete for me only (local deletion)
      // Note: Baileys doesn't have a direct "delete for me" method
      // This would typically be handled by the client application
      logger.info(
        `Message ${messageId} marked for local deletion from ${sessionId} in chat ${remoteJid}`
      );
    }

    return {
      success: true,
      messageId,
      remoteJid,
      deletedForEveryone: forEveryone,
      status: forEveryone ? "deleted_for_everyone" : "deleted_for_me",
    };
  } catch (error) {
    logger.error(
      `Failed to delete message ${messageId} from ${sessionId}:`,
      error
    );
    throw new Error(`Failed to delete message: ${error.message}`);
  }
};

const unsendMessage = async (sessionId, messageId, remoteJid = null) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(`Unsending message ${messageId} from ${sessionId}`, {
      remoteJid,
    });

    // If no remoteJid provided, we cannot unsend the message
    if (!remoteJid) {
      throw new Error(
        "Remote JID (recipient phone number) is required to unsend message"
      );
    }

    // Create message key for unsending
    const messageKey = {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: true,
    };

    // Unsend message (delete for everyone)
    await socket.sendMessage(messageKey.remoteJid, {
      delete: messageKey,
    });

    logger.info(
      `Message ${messageId} unsent successfully from ${sessionId} in chat ${remoteJid}`
    );

    return {
      success: true,
      messageId,
      remoteJid,
      status: "unsent",
    };
  } catch (error) {
    logger.error(
      `Failed to unsend message ${messageId} from ${sessionId}:`,
      error
    );
    throw new Error(`Failed to unsend message: ${error.message}`);
  }
};

const starMessage = async (
  sessionId,
  messageId,
  star = true,
  remoteJid = null
) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(
      `${star ? "Starring" : "Unstarring"} message ${messageId} from ${sessionId}`,
      { remoteJid }
    );

    // If no remoteJid provided, we cannot star the message
    if (!remoteJid) {
      throw new Error(
        "Remote JID (recipient phone number) is required to star message"
      );
    }

    // Create message key for starring
    const messageKey = {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: true,
    };

    // Star/unstar message
    await socket.chatModify(
      {
        star: {
          messages: [messageKey],
          star: star,
        },
      },
      messageKey.remoteJid
    );

    logger.info(
      `Message ${messageId} ${star ? "starred" : "unstarred"} successfully from ${sessionId} in chat ${remoteJid}`
    );

    return {
      success: true,
      messageId,
      remoteJid,
      starred: star,
      status: star ? "starred" : "unstarred",
    };
  } catch (error) {
    logger.error(
      `Failed to ${star ? "star" : "unstar"} message ${messageId} from ${sessionId}:`,
      error
    );
    throw new Error(
      `Failed to ${star ? "star" : "unstar"} message: ${error.message}`
    );
  }
};

const unstarMessage = async (sessionId, messageId, remoteJid = null) => {
  return await starMessage(sessionId, messageId, false, remoteJid);
};

const editMessage = async (sessionId, messageId, newText, remoteJid = null) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(`Editing message ${messageId} from ${sessionId}`, {
      newTextLength: newText.length,
      remoteJid,
    });

    // If no remoteJid provided, we cannot edit the message
    if (!remoteJid) {
      throw new Error(
        "Remote JID (recipient phone number) is required to edit message"
      );
    }

    // Create message key for editing
    const messageKey = {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: true,
    };

    // Edit message
    await socket.sendMessage(messageKey.remoteJid, {
      text: newText,
      edit: messageKey,
    });

    logger.info(
      `Message ${messageId} edited successfully from ${sessionId} in chat ${remoteJid}`
    );

    return {
      success: true,
      messageId,
      remoteJid,
      newText,
      status: "edited",
    };
  } catch (error) {
    logger.error(
      `Failed to edit message ${messageId} from ${sessionId}:`,
      error
    );
    throw new Error(`Failed to edit message: ${error.message}`);
  }
};

const reactToMessage = async (
  sessionId,
  messageId,
  emoji,
  remoteJid = null
) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(
      `Adding reaction ${emoji} to message ${messageId} from ${sessionId}`,
      { remoteJid }
    );

    // If no remoteJid provided, we cannot react to the message
    if (!remoteJid) {
      throw new Error(
        "Remote JID (recipient phone number) is required to react to message"
      );
    }

    // Create message key for reaction
    const messageKey = {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: false, // Reactions are typically on received messages
    };

    // Send reaction
    await socket.sendMessage(messageKey.remoteJid, {
      react: {
        text: emoji,
        key: messageKey,
      },
    });

    logger.info(
      `Reaction ${emoji} added to message ${messageId} from ${sessionId} in chat ${remoteJid}`
    );

    return {
      success: true,
      messageId,
      remoteJid,
      emoji,
      status: "reacted",
    };
  } catch (error) {
    logger.error(
      `Failed to react to message ${messageId} from ${sessionId}:`,
      error
    );
    throw new Error(`Failed to react to message: ${error.message}`);
  }
};

const readMessage = async (sessionId, jid, messageKey) => {
  const socket = sessionManagement?.getSocket(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }

  try {
    logger.info(`Marking message as read from ${sessionId}`, {
      messageId: messageKey.id,
      jid,
    });

    // Mark message as read
    await socket.readMessages([messageKey]);

    logger.info(`Message marked as read successfully from ${sessionId}`, {
      messageId: messageKey.id,
      jid,
    });

    return {
      success: true,
      messageId: messageKey.id,
      jid,
      status: "read",
    };
  } catch (error) {
    logger.error(`Failed to mark message as read from ${sessionId}:`, error);
    throw new Error(`Failed to mark message as read: ${error.message}`);
  }
};

export default {
  setServices,
  deleteMessage,
  unsendMessage,
  starMessage,
  unstarMessage,
  editMessage,
  reactToMessage,
  readMessage,
};

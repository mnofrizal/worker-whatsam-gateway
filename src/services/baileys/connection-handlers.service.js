import { DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import logger from "../../utils/logger.js";

let sessionManagement;
let workerRegistryService;

const setServices = (services) => {
  sessionManagement = services.sessionManagement;
  workerRegistryService = services.workerRegistry;
};

const handleConnectionUpdate = async (sessionId, update) => {
  const { connection, lastDisconnect, qr } = update;

  logger.info(`[EVENT: connection.update] Session ${sessionId}:`, {
    connection,
    lastDisconnect: lastDisconnect?.error?.output?.statusCode,
    qr: qr ? "QR_RECEIVED" : "NO_QR",
  });

  try {
    if (qr) {
      await handleQRCode(sessionId, qr);
    }

    if (connection === "close") {
      await handleConnectionClose(sessionId, lastDisconnect);
    } else if (connection === "open") {
      await handleConnectionOpen(sessionId);
    } else if (connection === "connecting") {
      await handleConnectionConnecting(sessionId);
    }
  } catch (error) {
    logger.error(`Error handling connection update for ${sessionId}:`, error);
    sessionManagement.updateSessionStatus(sessionId, {
      status: "failed",
      error: error.message,
    });
    await notifyBackend("failed", sessionId, { error: error.message });
  }
};

const handleRecoveredConnectionUpdate = async (sessionId, update) => {
  const { connection, lastDisconnect, qr } = update;

  logger.info(`[EVENT: connection.update] Recovered session ${sessionId}:`, {
    connection,
    lastDisconnect: lastDisconnect?.error?.output?.statusCode,
    qr: qr ? "QR_RECEIVED" : "NO_QR",
  });

  try {
    if (qr) {
      logger.warn(
        `QR code required for recovered session ${sessionId} - session may need re-authentication`
      );
      await handleQRCode(sessionId, qr);
    }

    if (connection === "close") {
      await handleRecoveredConnectionClose(sessionId, lastDisconnect);
    } else if (connection === "open") {
      await handleRecoveredConnectionOpen(sessionId);
    } else if (connection === "connecting") {
      sessionManagement.updateSessionStatus(sessionId, {
        status: "reconnecting",
      });
      await notifyBackend("reconnecting", sessionId);
    }
  } catch (error) {
    logger.error(
      `Error handling recovered connection update for ${sessionId}:`,
      error
    );
    sessionManagement.updateSessionStatus(sessionId, {
      status: "failed",
      error: error.message,
    });
    await notifyBackend("failed", sessionId, { error: error.message });
  }
};

const handleQRCode = async (sessionId, qr) => {
  try {
    logger.info(`Generating QR code for session ${sessionId}`);

    // Track QR attempts
    const currentAttempts = sessionManagement.qrAttempts.get(sessionId) || 0;
    const newAttempts = currentAttempts + 1;
    sessionManagement.qrAttempts.set(sessionId, newAttempts);

    logger.info(`QR attempt ${newAttempts} for session ${sessionId}`);

    // Clear existing QR timeout
    if (sessionManagement.qrTimeouts.has(sessionId)) {
      clearTimeout(sessionManagement.qrTimeouts.get(sessionId));
      sessionManagement.qrTimeouts.delete(sessionId);
    }

    // Generate QR code image
    const qrCodeDataURL = await QRCode.toDataURL(qr, {
      width: 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    const qrData = {
      qrCode: qrCodeDataURL,
      qrString: qr,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 minutes
      attempt: newAttempts,
    };

    // Store QR code
    sessionManagement.qrCodes.set(sessionId, qrData);

    // Update session status
    sessionManagement.updateSessionStatus(sessionId, {
      status: "qr_ready",
      qrAttempt: newAttempts,
    });

    // Notify backend
    await notifyBackend("qr_ready", sessionId, qrData);

    // Set QR timeout (2 minutes)
    const timeout = setTimeout(
      async () => {
        logger.warn(`QR code expired for session ${sessionId}`);
        sessionManagement.qrCodes.delete(sessionId);
        sessionManagement.qrTimeouts.delete(sessionId);

        sessionManagement.updateSessionStatus(sessionId, {
          status: "qr_expired",
        });

        await notifyBackend("qr_expired", sessionId);
      },
      2 * 60 * 1000
    );

    sessionManagement.qrTimeouts.set(sessionId, timeout);

    logger.info(`QR code generated and stored for session ${sessionId}`);
  } catch (error) {
    logger.error(`Failed to generate QR code for session ${sessionId}:`, error);
    throw error;
  }
};

const handleConnectionOpen = async (sessionId) => {
  try {
    logger.info(`Session ${sessionId} connected successfully`);

    const socket = sessionManagement.getSocket(sessionId);
    if (!socket || !socket.user) {
      throw new Error("Socket or user information not available");
    }

    // Clear QR data
    sessionManagement.qrCodes.delete(sessionId);
    sessionManagement.qrAttempts.delete(sessionId);

    // Clear QR timeout
    if (sessionManagement.qrTimeouts.has(sessionId)) {
      clearTimeout(sessionManagement.qrTimeouts.get(sessionId));
      sessionManagement.qrTimeouts.delete(sessionId);
    }

    // Extract user information
    const phoneNumber = socket.user.id.split(":")[0];
    const displayName = socket.user.name || socket.user.notify || null;

    // Update session status
    sessionManagement.updateSessionStatus(sessionId, {
      status: "connected",
      phoneNumber,
      displayName,
      connectedAt: new Date().toISOString(),
    });

    // Notify backend
    await notifyBackend("connected", sessionId, {
      phoneNumber,
      displayName,
    });

    // Upload session files to storage
    if (global.services?.storage) {
      try {
        await global.services.storage.uploadSessionFiles(sessionId);
        logger.info(`Session files uploaded to storage for ${sessionId}`);
      } catch (error) {
        logger.error(`Failed to upload session files for ${sessionId}:`, error);
      }
    }

    logger.info(
      `Session ${sessionId} fully connected with phone: ${phoneNumber}`
    );
  } catch (error) {
    logger.error(`Failed to handle connection open for ${sessionId}:`, error);
    throw error;
  }
};

const handleRecoveredConnectionOpen = async (sessionId) => {
  try {
    logger.info(`Recovered session ${sessionId} connected successfully`);

    const socket = sessionManagement.getSocket(sessionId);
    if (!socket || !socket.user) {
      throw new Error("Socket or user information not available");
    }

    // Clear QR data (in case it was generated during recovery)
    sessionManagement.qrCodes.delete(sessionId);
    sessionManagement.qrAttempts.delete(sessionId);

    // Clear QR timeout
    if (sessionManagement.qrTimeouts.has(sessionId)) {
      clearTimeout(sessionManagement.qrTimeouts.get(sessionId));
      sessionManagement.qrTimeouts.delete(sessionId);
    }

    // Extract user information
    const phoneNumber = socket.user.id.split(":")[0];
    const displayName = socket.user.name || socket.user.notify || null;

    // Update session status
    sessionManagement.updateSessionStatus(sessionId, {
      status: "connected",
      phoneNumber,
      displayName,
      recoveredAt: new Date().toISOString(),
    });

    // Notify backend
    await notifyBackend("connected", sessionId, {
      phoneNumber,
      displayName,
      recovered: true,
    });

    logger.info(
      `Recovered session ${sessionId} fully connected with phone: ${phoneNumber}`
    );
  } catch (error) {
    logger.error(
      `Failed to handle recovered connection open for ${sessionId}:`,
      error
    );
    throw error;
  }
};

const handleConnectionConnecting = async (sessionId) => {
  logger.info(`Session ${sessionId} is connecting...`);

  sessionManagement.updateSessionStatus(sessionId, {
    status: "connecting",
  });

  await notifyBackend("connecting", sessionId);
};

const handleConnectionClose = async (sessionId, lastDisconnect) => {
  const statusCode = lastDisconnect?.error?.output?.statusCode;
  const errorMessage = lastDisconnect?.error?.message;

  logger.warn(`Session ${sessionId} connection closed:`, {
    statusCode,
    errorMessage,
  });

  // Check if this was a manual disconnection
  if (sessionManagement.manualDisconnections.has(sessionId)) {
    logger.info(`Manual disconnection detected for ${sessionId}`);
    sessionManagement.manualDisconnections.delete(sessionId);
    return;
  }

  // Handle different disconnect reasons
  switch (statusCode) {
    case DisconnectReason.badSession:
      logger.error(`Bad session for ${sessionId} - cleaning up`);
      await handleBadSession(sessionId);
      break;

    case DisconnectReason.connectionClosed:
      logger.warn(`Connection closed for ${sessionId} - attempting reconnect`);
      await handleConnectionClosed(sessionId);
      break;

    case DisconnectReason.connectionLost:
      logger.warn(`Connection lost for ${sessionId} - attempting reconnect`);
      await handleConnectionLost(sessionId);
      break;

    case DisconnectReason.connectionReplaced:
      logger.warn(`Connection replaced for ${sessionId}`);
      await handleConnectionReplaced(sessionId);
      break;

    case DisconnectReason.loggedOut:
      logger.info(`Session ${sessionId} logged out`);
      await handleLoggedOut(sessionId);
      break;

    case DisconnectReason.restartRequired:
      logger.info(`Restart required for ${sessionId}`);
      await handleRestartRequired(sessionId);
      break;

    case DisconnectReason.timedOut:
      logger.warn(`Session ${sessionId} timed out - attempting reconnect`);
      await handleTimedOut(sessionId);
      break;

    default:
      logger.warn(`Unknown disconnect reason for ${sessionId}: ${statusCode}`);
      await handleUnknownDisconnect(sessionId, statusCode, errorMessage);
      break;
  }
};

const handleRecoveredConnectionClose = async (sessionId, lastDisconnect) => {
  const statusCode = lastDisconnect?.error?.output?.statusCode;
  const errorMessage = lastDisconnect?.error?.message;

  logger.warn(`Recovered session ${sessionId} connection closed:`, {
    statusCode,
    errorMessage,
  });

  // For recovered sessions, we're more aggressive about reconnection
  switch (statusCode) {
    case DisconnectReason.badSession:
    case DisconnectReason.loggedOut:
      logger.error(
        `Recovered session ${sessionId} has bad session/logged out - requires new authentication`
      );
      await handleBadSession(sessionId);
      break;

    default:
      // For all other cases, attempt reconnection
      logger.info(`Attempting to reconnect recovered session ${sessionId}`);
      await attemptReconnection(sessionId, 3000); // 3 second delay
      break;
  }
};

// Specific disconnect handlers
const handleBadSession = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "disconnected",
    error: "Bad session - authentication required",
  });

  await notifyBackend("disconnected", sessionId, {
    reason: "bad_session",
    requiresAuth: true,
  });

  // Clean up session data
  await sessionManagement.cleanupSession(sessionId);
};

const handleConnectionClosed = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "reconnecting",
  });

  await notifyBackend("reconnecting", sessionId, {
    reason: "connection_closed",
  });

  await attemptReconnection(sessionId, 5000); // 5 second delay
};

const handleConnectionLost = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "reconnecting",
  });

  await notifyBackend("reconnecting", sessionId, {
    reason: "connection_lost",
  });

  await attemptReconnection(sessionId, 3000); // 3 second delay
};

const handleConnectionReplaced = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "disconnected",
    error: "Connection replaced by another device",
  });

  await notifyBackend("disconnected", sessionId, {
    reason: "connection_replaced",
  });

  // Don't attempt reconnection for replaced connections
};

const handleLoggedOut = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "logged_out",
  });

  await notifyBackend("disconnected", sessionId, {
    reason: "logged_out",
  });

  // Clean up session data
  await sessionManagement.cleanupSession(sessionId);
};

const handleRestartRequired = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "restarting",
  });

  await notifyBackend("reconnecting", sessionId, {
    reason: "restart_required",
  });

  // Restart the session
  try {
    const sessionInfo = sessionManagement.sessionStatus.get(sessionId);
    if (sessionInfo) {
      await sessionManagement.restartSession(sessionId);
    }
  } catch (error) {
    logger.error(`Failed to restart session ${sessionId}:`, error);
  }
};

const handleTimedOut = async (sessionId) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "reconnecting",
  });

  await notifyBackend("reconnecting", sessionId, {
    reason: "timed_out",
  });

  await attemptReconnection(sessionId, 10000); // 10 second delay
};

const handleUnknownDisconnect = async (sessionId, statusCode, errorMessage) => {
  sessionManagement.updateSessionStatus(sessionId, {
    status: "reconnecting",
    error: `Unknown disconnect: ${errorMessage}`,
  });

  await notifyBackend("reconnecting", sessionId, {
    reason: "unknown",
    statusCode,
    errorMessage,
  });

  await attemptReconnection(sessionId, 5000); // 5 second delay
};

const attemptReconnection = async (sessionId, delay = 5000) => {
  logger.info(`Scheduling reconnection for ${sessionId} in ${delay}ms`);

  setTimeout(async () => {
    try {
      const sessionInfo = sessionManagement.sessionStatus.get(sessionId);
      if (!sessionInfo) {
        logger.warn(
          `Session ${sessionId} no longer exists, skipping reconnection`
        );
        return;
      }

      logger.info(`Attempting to reconnect session ${sessionId}`);
      await sessionManagement.restartSession(sessionId);
    } catch (error) {
      logger.error(`Failed to reconnect session ${sessionId}:`, error);

      sessionManagement.updateSessionStatus(sessionId, {
        status: "failed",
        error: `Reconnection failed: ${error.message}`,
      });

      await notifyBackend("failed", sessionId, {
        error: error.message,
      });
    }
  }, delay);
};

const notifyBackend = async (event, sessionId, data = {}) => {
  if (workerRegistryService) {
    try {
      await workerRegistryService.notifyBackend(event, sessionId, data);
    } catch (error) {
      logger.error(
        `Failed to notify backend about ${event} for ${sessionId}:`,
        error
      );
    }
  }
};

export default {
  setServices,
  handleConnectionUpdate,
  handleRecoveredConnectionUpdate,
  handleQRCode,
  handleConnectionOpen,
  handleRecoveredConnectionOpen,
  handleConnectionConnecting,
  handleConnectionClose,
  handleRecoveredConnectionClose,
  attemptReconnection,
};

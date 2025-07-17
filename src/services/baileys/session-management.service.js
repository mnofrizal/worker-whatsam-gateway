import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import logger from "../../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sessions = new Map(); // sessionId -> socket instance
const qrCodes = new Map(); // sessionId -> qr code data
const sessionStatus = new Map(); // sessionId -> status info
const manualDisconnections = new Set(); // Track manual disconnections
const qrAttempts = new Map(); // sessionId -> attempt count
const qrTimeouts = new Map(); // sessionId -> timeout reference
const storageDir = join(__dirname, "../../../storage/sessions");

let workerRegistryService;
let connectionHandlers;

const setServices = (services) => {
  workerRegistryService = services.workerRegistry;
  connectionHandlers = services.connectionHandlers;
};

const initialize = async () => {
  logger.info("Initializing Baileys session management...");
  try {
    await fs.mkdir(storageDir, { recursive: true });
    logger.info("Storage directory created/verified");
  } catch (error) {
    logger.error("Failed to create storage directory:", error);
    throw error;
  }
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys version: ${version}, isLatest: ${isLatest}`);
  } catch (error) {
    logger.warn("Failed to fetch latest Baileys version:", error);
  }
};

const createSession = async (sessionId, userId, options = {}) => {
  try {
    logger.info(`Creating session: ${sessionId} for user: ${userId}`);
    if (sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }
    const authDir = join(storageDir, sessionId);
    await fs.mkdir(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const socketConfig = {
      auth: state,
      printQRInTerminal: false,
      logger: createBaileysLogger(),
      generateHighQualityLinkPreview: true,
      defaultQueryTimeoutMs: 60000,
      ...options,
    };
    const socket = makeWASocket(socketConfig);
    updateSessionStatus(sessionId, {
      sessionId,
      userId,
      status: "initializing",
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    // Use connection handlers if available
    socket.ev.on("connection.update", (update) => {
      if (connectionHandlers) {
        const handler = options.isRecovery
          ? connectionHandlers.handleRecoveredConnectionUpdate
          : connectionHandlers.handleConnectionUpdate;
        handler(sessionId, update).catch((error) => {
          logger.error(
            `Error in connection update handler for ${sessionId}:`,
            error
          );
        });
      } else {
        // Fallback to basic handling
        handleConnectionUpdateFallback(sessionId, update);
      }
    });

    socket.ev.on("creds.update", (creds) => {
      logger.debug(
        `[EVENT: creds.update] Credentials updated for ${sessionId}`
      );
      saveCreds(creds);
    });
    socket.ev.on("messages.upsert", (messageUpdate) => {
      handleIncomingMessages(sessionId, messageUpdate);
    });
    socket.ev.on("messages.update", (messageUpdate) => {
      handleMessageUpdates(sessionId, messageUpdate);
    });
    socket.ev.on("presence.update", (presenceUpdate) => {
      handlePresenceUpdate(sessionId, presenceUpdate);
    });
    sessions.set(sessionId, socket);
    logger.info(`Session ${sessionId} created successfully`);
    return {
      success: true,
      sessionId,
      status: "initializing",
    };
  } catch (error) {
    logger.error(`Failed to create session ${sessionId}:`, error);
    sessions.delete(sessionId);
    qrCodes.delete(sessionId);
    sessionStatus.delete(sessionId);
    throw new Error(`Failed to create session: ${error.message}`);
  }
};

const getSessionStatus = (sessionId) => {
  const sessionInfo = sessionStatus.get(sessionId);
  const qrInfo = qrCodes.get(sessionId);
  if (!sessionInfo) {
    return { status: "not_found" };
  }
  const status = {
    ...sessionInfo,
    lastSeen: new Date().toISOString(),
  };
  if (qrInfo && sessionInfo.status === "qr_ready") {
    status.qrCode = qrInfo.qrCode;
    status.qrExpiresAt = qrInfo.expiresAt;
  }
  return status;
};

const getSessionsByStatus = () => {
  const statusCounts = {
    initializing: 0,
    qr_ready: 0,
    connected: 0,
    disconnected: 0,
    reconnecting: 0,
    failed: 0,
    logged_out: 0,
  };
  for (const [, sessionInfo] of sessionStatus) {
    const status = sessionInfo.status || "unknown";
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++;
    }
  }
  return statusCounts;
};

const getAllSessions = () => {
  return sessionStatus;
};

const getSessionCount = () => {
  return sessionStatus.size;
};

const getConnectedSessionCount = () => {
  let count = 0;
  for (const [, sessionInfo] of sessionStatus) {
    if (sessionInfo.status === "connected") {
      count++;
    }
  }
  return count;
};

const getSessionStatistics = () => {
  const stats = {
    total: 0,
    connected: 0,
    disconnected: 0,
    qr_required: 0,
    reconnecting: 0,
    initializing: 0,
    error: 0,
  };
  for (const [, sessionInfo] of sessionStatus) {
    stats.total++;
    const status = sessionInfo.status || "unknown";
    switch (status) {
      case "connected":
        stats.connected++;
        break;
      case "disconnected":
      case "logged_out":
        stats.disconnected++;
        break;
      case "qr_ready":
        stats.qr_required++;
        break;
      case "reconnecting":
        stats.reconnecting++;
        break;
      case "initializing":
        stats.initializing++;
        break;
      case "failed":
        stats.error++;
        break;
    }
  }
  return stats;
};

const deleteSession = async (sessionId) => {
  try {
    logger.info(`Deleting session ${sessionId}`);
    const socket = sessions.get(sessionId);
    if (socket) {
      try {
        await socket.logout();
        logger.info(`Session ${sessionId} logged out`);
      } catch (error) {
        logger.warn(`Failed to logout session ${sessionId}:`, error);
      }
    }
    await cleanupSession(sessionId);
    await notifyBackend("disconnected", sessionId);
    logger.info(`Session ${sessionId} deleted successfully`);
    return { success: true };
  } catch (error) {
    logger.error(`Failed to delete session ${sessionId}:`, error);
    throw new Error(`Failed to delete session: ${error.message}`);
  }
};

const restartSession = async (sessionId) => {
  try {
    logger.info(`Restarting session ${sessionId}`);
    const sessionInfo = sessionStatus.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const socket = sessions.get(sessionId);
    if (socket) {
      try {
        socket.end();
        logger.info(`Session ${sessionId} socket closed for restart`);
      } catch (error) {
        logger.warn(`Failed to close socket for ${sessionId}:`, error);
      }
    }
    const displayName = socket?.user?.name || socket?.user?.notify || null;
    sessions.delete(sessionId);
    qrCodes.delete(sessionId);
    qrAttempts.delete(sessionId);
    logger.info(`QR attempts counter reset for session restart ${sessionId}`);
    if (qrTimeouts.has(sessionId)) {
      clearTimeout(qrTimeouts.get(sessionId));
      qrTimeouts.delete(sessionId);
      logger.info(`QR timeout cleared for session restart ${sessionId}`);
    }
    updateSessionStatus(sessionId, {
      status: "restarting",
    });
    await notifyBackend("reconnecting", sessionId, {
      displayName,
    });
    await createSession(sessionId, sessionInfo.userId);
    logger.info(`Session ${sessionId} restarted successfully`);
    return {
      success: true,
      sessionId,
      status: "initializing",
    };
  } catch (error) {
    logger.error(`Failed to restart session ${sessionId}:`, error);
    throw new Error(`Failed to restart session: ${error.message}`);
  }
};

const disconnectSession = async (sessionId) => {
  try {
    logger.info(`Disconnecting session ${sessionId}`);
    const socket = sessions.get(sessionId);
    if (!socket) {
      throw new Error(`Session ${sessionId} not found`);
    }
    manualDisconnections.add(sessionId);
    try {
      socket.end();
      logger.info(`Session ${sessionId} socket disconnected`);
    } catch (error) {
      logger.warn(`Failed to disconnect socket for ${sessionId}:`, error);
    }
    sessions.delete(sessionId);
    qrCodes.delete(sessionId);
    qrAttempts.delete(sessionId);
    logger.info(`QR attempts counter reset for session ${sessionId}`);
    if (qrTimeouts.has(sessionId)) {
      clearTimeout(qrTimeouts.get(sessionId));
      qrTimeouts.delete(sessionId);
      logger.info(`QR timeout cleared for session ${sessionId}`);
    }
    updateSessionStatus(sessionId, {
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
    });
    await notifyBackend("disconnected", sessionId);
    logger.info(`Session ${sessionId} disconnected successfully`);
    return { success: true, message: "Session disconnected" };
  } catch (error) {
    logger.error(`Failed to disconnect session ${sessionId}:`, error);
    throw new Error(`Failed to disconnect session: ${error.message}`);
  }
};

const logoutSession = async (sessionId) => {
  try {
    logger.info(`Logging out session ${sessionId}`);
    const socket = sessions.get(sessionId);
    if (!socket) {
      throw new Error(`Session ${sessionId} not found`);
    }
    manualDisconnections.add(sessionId);
    try {
      await socket.logout();
      logger.info(`Session ${sessionId} logged out from WhatsApp`);
    } catch (error) {
      logger.warn(`Failed to logout from WhatsApp for ${sessionId}:`, error);
    }
    await cleanupSession(sessionId);
    updateSessionStatus(sessionId, {
      status: "logged_out",
      loggedOutAt: new Date().toISOString(),
    });
    await notifyBackend("disconnected", sessionId);
    logger.info(`Session ${sessionId} logged out successfully`);
    return { success: true, message: "Session logged out successfully" };
  } catch (error) {
    logger.error(`Failed to logout session ${sessionId}:`, error);
    throw new Error(`Failed to logout session: ${error.message}`);
  }
};

const getSocket = (sessionId) => {
  return sessions.get(sessionId);
};

const updateSessionStatus = (sessionId, updates) => {
  const currentStatus = sessionStatus.get(sessionId) || {};
  const updatedStatus = {
    ...currentStatus,
    ...updates,
    lastSeen: new Date().toISOString(),
  };
  sessionStatus.set(sessionId, updatedStatus);
};

const cleanupSession = async (sessionId) => {
  sessions.delete(sessionId);
  qrCodes.delete(sessionId);
  sessionStatus.delete(sessionId);
  manualDisconnections.delete(sessionId);
  qrAttempts.delete(sessionId);
  if (qrTimeouts.has(sessionId)) {
    clearTimeout(qrTimeouts.get(sessionId));
    qrTimeouts.delete(sessionId);
  }
  if (global.services?.storage) {
    try {
      await global.services.storage.deleteSessionFiles(sessionId);
      logger.info(`MinIO storage files cleaned up for ${sessionId}`);
    } catch (error) {
      logger.error(
        `Failed to cleanup MinIO storage files for ${sessionId}:`,
        error
      );
    }
  }
  try {
    const localSessionPath = join(storageDir, sessionId);
    try {
      await fs.access(localSessionPath);
      const files = await fs.readdir(localSessionPath);
      for (const file of files) {
        const filePath = join(localSessionPath, file);
        await fs.unlink(filePath);
        logger.debug(`Deleted local session file: ${filePath}`);
      }
      await fs.rmdir(localSessionPath);
      logger.info(`Local session directory deleted: ${localSessionPath}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(
          `Local session directory not found or already deleted: ${localSessionPath}`
        );
      }
    }
  } catch (error) {
    logger.error(
      `Failed to cleanup local session files for ${sessionId}:`,
      error
    );
  }
  logger.info(`Session cleanup completed for ${sessionId}`);
};

const closeAllSessions = async () => {
  logger.info("Closing all sessions...");
  const sessionIds = Array.from(sessions.keys());
  for (const sessionId of sessionIds) {
    try {
      await deleteSession(sessionId);
    } catch (error) {
      logger.error(`Failed to close session ${sessionId}:`, error);
    }
  }
  logger.info("All sessions closed");
};

// Helper functions
const createBaileysLogger = () => {
  return {
    level: "silent",
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => createBaileysLogger(),
  };
};

const handleIncomingMessages = (sessionId, messageUpdate) => {
  const { messages } = messageUpdate;
  const socket = sessions.get(sessionId);
  const ownJid = socket?.user?.id;

  for (const message of messages) {
    const isFromSelf = message.key.fromMe || message.key.remoteJid === ownJid;

    if (isFromSelf) {
      // Message from self (own messages)
      logger.info(`[EVENT: message.any] Incoming message for ${sessionId}:`, {
        messageId: message.key.id,
        from: message.key.remoteJid,
        messageType: Object.keys(message.message || {})[0],
        fromSelf: true,
      });
    } else {
      // Message from others (incoming from contacts)
      logger.info(`[EVENT: message] Incoming message for ${sessionId}:`, {
        messageId: message.key.id,
        from: message.key.remoteJid,
        messageType: Object.keys(message.message || {})[0],
        fromSelf: false,
      });
    }
  }
};

const handleMessageUpdates = (sessionId, messageUpdate) => {
  for (const update of messageUpdate) {
    logger.debug(`[EVENT: messages.update] Message update for ${sessionId}:`, {
      messageId: update.key.id,
      status: update.update.status,
    });
  }
};

const handlePresenceUpdate = (sessionId, presenceUpdate) => {
  logger.debug(
    `[EVENT: presence.update] Presence update for ${sessionId}:`,
    presenceUpdate
  );
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

// Fallback connection handler (basic implementation)
const handleConnectionUpdateFallback = async (sessionId, update) => {
  const { connection, lastDisconnect, qr } = update;

  logger.info(`[FALLBACK] Connection update for ${sessionId}:`, {
    connection,
    lastDisconnect: lastDisconnect?.error?.output?.statusCode,
    qr: qr ? "QR_RECEIVED" : "NO_QR",
  });

  try {
    if (qr) {
      // Basic QR handling
      updateSessionStatus(sessionId, {
        status: "qr_ready",
      });
      await notifyBackend("qr_ready", sessionId, { qrString: qr });
    }

    if (connection === "open") {
      const socket = sessions.get(sessionId);
      const phoneNumber = socket?.user?.id?.split(":")[0];

      updateSessionStatus(sessionId, {
        status: "connected",
        phoneNumber,
        connectedAt: new Date().toISOString(),
      });

      await notifyBackend("connected", sessionId, { phoneNumber });
    } else if (connection === "close") {
      updateSessionStatus(sessionId, {
        status: "disconnected",
      });

      await notifyBackend("disconnected", sessionId);
    }
  } catch (error) {
    logger.error(
      `Error in fallback connection handler for ${sessionId}:`,
      error
    );
  }
};

export default {
  setServices,
  initialize,
  createSession,
  getSessionStatus,
  getSessionsByStatus,
  getAllSessions,
  getSessionCount,
  getConnectedSessionCount,
  getSessionStatistics,
  deleteSession,
  restartSession,
  disconnectSession,
  logoutSession,
  getSocket,
  updateSessionStatus,
  cleanupSession,
  closeAllSessions,
  // Export internal maps for other services
  sessions,
  qrCodes,
  sessionStatus,
  manualDisconnections,
  qrAttempts,
  qrTimeouts,
  storageDir,
  // Export helper functions
  notifyBackend,
  handleIncomingMessages,
  handleMessageUpdates,
  handlePresenceUpdate,
};

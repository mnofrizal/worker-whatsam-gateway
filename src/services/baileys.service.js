import logger from "../utils/logger.js";

// Import modular services
import sessionManagement from "./baileys/session-management.service.js";
import connectionHandlers from "./baileys/connection-handlers.service.js";
import messageSending from "./baileys/message-sending.service.js";
import messageManagement from "./baileys/message-management.service.js";
import recovery from "./baileys/recovery.service.js";

// Service container
let services = {};

const setServices = (injectedServices) => {
  services = injectedServices;

  // Pass services to all modules
  sessionManagement.setServices(injectedServices);
  connectionHandlers.setServices({
    ...injectedServices,
    sessionManagement,
  });
  messageSending.setServices({
    ...injectedServices,
    sessionManagement,
  });
  messageManagement.setServices({
    ...injectedServices,
    sessionManagement,
  });
  recovery.setServices({
    ...injectedServices,
    sessionManagement,
  });

  logger.info("Baileys service dependencies injected successfully");
};

const initialize = async () => {
  try {
    logger.info("Initializing Baileys service...");

    // Initialize session management
    await sessionManagement.initialize();

    // Load persisted sessions
    const recoveryResult = await recovery.loadPersistedSessions();
    logger.info("Session recovery result:", recoveryResult);

    logger.info("Baileys service initialized successfully");
    return { success: true };
  } catch (error) {
    logger.error("Failed to initialize Baileys service:", error);
    throw error;
  }
};

// Session Management Functions
const createSession = async (sessionId, userId, options = {}) => {
  return await sessionManagement.createSession(sessionId, userId, options);
};

const getSessionStatus = (sessionId) => {
  return sessionManagement.getSessionStatus(sessionId);
};

const getSessionsByStatus = () => {
  return sessionManagement.getSessionsByStatus();
};

const getAllSessions = () => {
  return sessionManagement.getAllSessions();
};

const getSessionCount = () => {
  return sessionManagement.getSessionCount();
};

const getConnectedSessionCount = () => {
  return sessionManagement.getConnectedSessionCount();
};

const getSessionStatistics = () => {
  return sessionManagement.getSessionStatistics();
};

const deleteSession = async (sessionId) => {
  return await sessionManagement.deleteSession(sessionId);
};

const restartSession = async (sessionId) => {
  return await sessionManagement.restartSession(sessionId);
};

const disconnectSession = async (sessionId) => {
  return await sessionManagement.disconnectSession(sessionId);
};

const logoutSession = async (sessionId) => {
  return await sessionManagement.logoutSession(sessionId);
};

const getSocket = (sessionId) => {
  return sessionManagement.getSocket(sessionId);
};

const closeAllSessions = async () => {
  return await sessionManagement.closeAllSessions();
};

// Message Sending Functions
const sendMessage = async (sessionId, to, message, options = {}) => {
  return await messageSending.sendMessage(sessionId, to, message, options);
};

const sendSeen = async (sessionId, jid, messageKey) => {
  return await messageSending.sendSeen(sessionId, jid, messageKey);
};

const startTyping = async (sessionId, jid) => {
  return await messageSending.startTyping(sessionId, jid);
};

const stopTyping = async (sessionId, jid) => {
  return await messageSending.stopTyping(sessionId, jid);
};

const sendLinkMessage = async (
  sessionId,
  to,
  url,
  title,
  description,
  thumbnailUrl
) => {
  return await messageSending.sendLinkMessage(
    sessionId,
    to,
    url,
    title,
    description,
    thumbnailUrl
  );
};

const sendPollMessage = async (
  sessionId,
  to,
  pollName,
  pollOptions,
  selectableCount
) => {
  return await messageSending.sendPollMessage(
    sessionId,
    to,
    pollName,
    pollOptions,
    selectableCount
  );
};

// Message Management Functions
const deleteMessage = async (
  sessionId,
  messageId,
  forEveryone = false,
  remoteJid = null
) => {
  return await messageManagement.deleteMessage(
    sessionId,
    messageId,
    forEveryone,
    remoteJid
  );
};

const unsendMessage = async (sessionId, messageId, remoteJid = null) => {
  return await messageManagement.unsendMessage(sessionId, messageId, remoteJid);
};

const starMessage = async (
  sessionId,
  messageId,
  star = true,
  remoteJid = null
) => {
  return await messageManagement.starMessage(
    sessionId,
    messageId,
    star,
    remoteJid
  );
};

const unstarMessage = async (sessionId, messageId, remoteJid = null) => {
  return await messageManagement.unstarMessage(sessionId, messageId, remoteJid);
};

const editMessage = async (sessionId, messageId, newText, remoteJid = null) => {
  return await messageManagement.editMessage(
    sessionId,
    messageId,
    newText,
    remoteJid
  );
};

const reactToMessage = async (
  sessionId,
  messageId,
  emoji,
  remoteJid = null
) => {
  return await messageManagement.reactToMessage(
    sessionId,
    messageId,
    emoji,
    remoteJid
  );
};

const readMessage = async (sessionId, jid, messageKey) => {
  return await messageManagement.readMessage(sessionId, jid, messageKey);
};

// Recovery Functions
const loadPersistedSessions = async () => {
  return await recovery.loadPersistedSessions();
};

const recoverSession = async (sessionId, userId) => {
  return await recovery.recoverSession(sessionId, userId);
};

const restoreSessionFromStorage = async (sessionId) => {
  return await recovery.restoreSessionFromStorage(sessionId);
};

const getAssignedSessionsFromBackend = async () => {
  return await recovery.getAssignedSessionsFromBackend();
};

const backupSessionToStorage = async (sessionId) => {
  return await recovery.backupSessionToStorage(sessionId);
};

const cleanupSessionStorage = async (sessionId) => {
  return await recovery.cleanupSessionStorage(sessionId);
};

const validateSessionFiles = async (sessionId) => {
  return await recovery.validateSessionFiles(sessionId);
};

const getRecoveryStatistics = () => {
  return recovery.getRecoveryStatistics();
};

const performHealthCheck = async () => {
  return await recovery.performHealthCheck();
};

// Health and Monitoring Functions
const getHealthStatus = () => {
  try {
    const sessionStats = getSessionStatistics();
    const recoveryStats = getRecoveryStatistics();

    return {
      healthy: true,
      timestamp: new Date().toISOString(),
      sessions: sessionStats,
      recovery: recoveryStats,
      modules: {
        sessionManagement: "active",
        connectionHandlers: "active",
        messageSending: "active",
        messageManagement: "active",
        recovery: "active",
      },
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
};

const getDetailedMetrics = () => {
  try {
    return {
      sessions: {
        total: getSessionCount(),
        connected: getConnectedSessionCount(),
        byStatus: getSessionsByStatus(),
        statistics: getSessionStatistics(),
      },
      recovery: getRecoveryStatistics(),
      modules: {
        sessionManagement: {
          activeSessions: sessionManagement.sessions.size,
          qrCodes: sessionManagement.qrCodes.size,
          sessionStatus: sessionManagement.sessionStatus.size,
        },
        messageSending: "active",
        messageManagement: "active",
        connectionHandlers: "active",
        recovery: "active",
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
};

// Graceful shutdown
const shutdown = async () => {
  try {
    logger.info("Shutting down Baileys service...");

    // Close all sessions
    await closeAllSessions();

    logger.info("Baileys service shutdown completed");
    return { success: true };
  } catch (error) {
    logger.error("Error during Baileys service shutdown:", error);
    throw error;
  }
};

// Export all functions
export default {
  // Core functions
  setServices,
  initialize,
  shutdown,

  // Session management
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
  closeAllSessions,

  // Message sending
  sendMessage,
  sendSeen,
  startTyping,
  stopTyping,
  sendLinkMessage,
  sendPollMessage,

  // Message management
  deleteMessage,
  unsendMessage,
  starMessage,
  unstarMessage,
  editMessage,
  reactToMessage,
  readMessage,

  // Recovery
  loadPersistedSessions,
  recoverSession,
  restoreSessionFromStorage,
  getAssignedSessionsFromBackend,
  backupSessionToStorage,
  cleanupSessionStorage,
  validateSessionFiles,
  getRecoveryStatistics,
  performHealthCheck,

  // Health and monitoring
  getHealthStatus,
  getDetailedMetrics,

  // Access to modular services (for advanced usage)
  modules: {
    sessionManagement,
    connectionHandlers,
    messageSending,
    messageManagement,
    recovery,
  },
};

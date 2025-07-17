import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sessions = new Map(); // sessionId -> socket instance
const qrCodes = new Map(); // sessionId -> qr code data
const sessionStatus = new Map(); // sessionId -> status info
const manualDisconnections = new Set(); // Track manual disconnections
const qrAttempts = new Map(); // sessionId -> attempt count
const qrTimeouts = new Map(); // sessionId -> timeout reference
const storageDir = join(__dirname, "../../storage/sessions");

let workerRegistryService;

const setServices = (services) => {
  workerRegistryService = services.workerRegistry;
};

const initialize = async () => {
  logger.info("Initializing Baileys service...");
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

const handleConnectionUpdate = async (sessionId, update) => {
  const { connection, lastDisconnect, qr } = update;
  logger.info(
    `[EVENT: connection.update] Connection update for ${sessionId}:`,
    {
      connection,
      lastDisconnect: lastDisconnect?.error?.message,
    }
  );

  try {
    if (qr) {
      const currentAttempts = qrAttempts.get(sessionId) || 0;
      if (currentAttempts >= 3) {
        logger.warn(
          `Ignoring QR code for session ${sessionId} - max attempts already reached`
        );
        return;
      }
      const newAttempts = currentAttempts + 1;
      qrAttempts.set(sessionId, newAttempts);
      logger.info(
        `QR code generated for session ${sessionId} (attempt ${newAttempts}/3)`,
        {
          qrLength: qr.length,
          qrPreview: qr.substring(0, 50) + "...",
        }
      );
      if (newAttempts >= 3) {
        logger.warn(
          `Session ${sessionId} reached maximum QR attempts (3), auto-disconnecting immediately`
        );
        qrCodes.set(sessionId, {
          qrCode: qr,
          timestamp: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          attempts: newAttempts,
          maxAttemptsReached: true,
        });
        updateSessionStatus(sessionId, {
          status: "qr_ready",
          qrCode: qr,
          qrAttempts: newAttempts,
          maxAttemptsReached: true,
          autoDisconnectIn: 30,
        });
        const maxAttemptsPayload = {
          qrCode: qr,
          attempts: newAttempts,
          maxAttempts: 3,
          autoDisconnectIn: 30,
        };
        logger.info(`Sending QR webhook to backend (max attempts reached):`, {
          sessionId,
          event: "session_auto_disconnected",
          endpoint: `${workerRegistryService?.backendUrl || "NOT_SET"}/api/v1/webhooks/session-status`,
          payload: JSON.stringify(maxAttemptsPayload, null, 2),
          qrLength: qr.length,
          qrPreview: qr.substring(0, 50) + "...",
          attempts: newAttempts,
          maxAttempts: 3,
        });
        await notifyBackend(
          "session_auto_disconnected",
          sessionId,
          maxAttemptsPayload
        );
        logger.info(`QR webhook sent successfully (max attempts reached):`, {
          sessionId,
          event: "session_auto_disconnected",
          attempts: newAttempts,
        });
        const timeoutId = setTimeout(async () => {
          try {
            await autoDisconnectSession(sessionId, "max_qr_attempts_reached");
          } catch (error) {
            logger.error(
              `Failed to auto-disconnect session ${sessionId}:`,
              error
            );
          }
        }, 30000);
        qrTimeouts.set(sessionId, timeoutId);
        return;
      } else {
        qrCodes.set(sessionId, {
          qrCode: qr,
          timestamp: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          attempts: newAttempts,
        });
        updateSessionStatus(sessionId, {
          status: "qr_ready",
          qrCode: qr,
          qrAttempts: newAttempts,
        });
        const qrReadyPayload = {
          qrCode: qr,
          attempts: newAttempts,
        };
        logger.info(`Sending QR webhook to backend (QR ready):`, {
          sessionId,
          event: "qr_ready",
          endpoint: `${workerRegistryService?.backendUrl || "NOT_SET"}/api/v1/webhooks/session-status`,
          payload: JSON.stringify(qrReadyPayload, null, 2),
          qrLength: qr.length,
          qrPreview: qr.substring(0, 50) + "...",
          attempts: newAttempts,
          maxAttempts: 3,
        });
        await notifyBackend("qr_ready", sessionId, qrReadyPayload);
        logger.info(`QR webhook sent successfully (QR ready):`, {
          sessionId,
          event: "qr_ready",
          attempts: newAttempts,
        });
      }
    }

    if (connection === "close") {
      const isManualDisconnection = manualDisconnections.has(sessionId);
      const isLoggedOutFromPhone =
        lastDisconnect?.error?.output?.statusCode ===
          DisconnectReason.loggedOut ||
        (lastDisconnect?.error?.message &&
          (lastDisconnect.error.message.includes("Stream Errored (conflict)") ||
            lastDisconnect.error.message.includes("conflict") ||
            lastDisconnect.error.message.includes("logged out")));
      const shouldReconnect = !isManualDisconnection && !isLoggedOutFromPhone;
      logger.info(
        `Session ${sessionId} closed. Manual: ${isManualDisconnection}, LoggedOut: ${isLoggedOutFromPhone}, Should reconnect: ${shouldReconnect}`,
        {
          disconnectReason: lastDisconnect?.error?.output?.statusCode,
          disconnectMessage: lastDisconnect?.error?.message,
          logoutDetectionDetails: {
            statusCodeMatch:
              lastDisconnect?.error?.output?.statusCode ===
              DisconnectReason.loggedOut,
            messageContainsConflict: lastDisconnect?.error?.message?.includes(
              "Stream Errored (conflict)"
            ),
            messageContainsConflictKeyword:
              lastDisconnect?.error?.message?.includes("conflict"),
            messageContainsLoggedOut:
              lastDisconnect?.error?.message?.includes("logged out"),
          },
        }
      );
      manualDisconnections.delete(sessionId);
      if (isLoggedOutFromPhone) {
        logger.warn(
          `Session ${sessionId} was logged out from phone (unlinked WhatsApp app)`
        );
        const sessionInfo = sessionStatus.get(sessionId);
        const phoneNumber = sessionInfo?.phoneNumber;
        const displayName = sessionInfo?.displayName;
        updateSessionStatus(sessionId, {
          status: "logged_out",
          lastDisconnect: lastDisconnect?.error?.message,
          loggedOutFromPhone: true,
          loggedOutAt: new Date().toISOString(),
        });
        logger.info(
          `Sending logout webhook to backend for session ${sessionId}:`,
          {
            sessionId,
            event: "session_logged_out",
            endpoint: `${workerRegistryService?.backendUrl || "NOT_SET"}/api/v1/webhooks/session-status`,
            reason: "logged_out_from_phone",
            phoneNumber: phoneNumber || "N/A",
            displayName: displayName || "N/A",
          }
        );
        await notifyBackend("session_logged_out", sessionId, {
          reason: "logged_out_from_phone",
          phoneNumber,
          displayName,
          timestamp: new Date().toISOString(),
        });
        logger.info(
          `Logout webhook sent successfully for session ${sessionId}`
        );
        cleanupSession(sessionId).catch((error) => {
          logger.error(
            `Failed to cleanup logged out session ${sessionId}:`,
            error
          );
        });
      } else if (shouldReconnect) {
        updateSessionStatus(sessionId, {
          status: "reconnecting",
          lastDisconnect: lastDisconnect?.error?.message,
        });
        setTimeout(() => {
          reconnectSession(sessionId).catch((error) => {
            logger.error(`Reconnection failed for ${sessionId}:`, error);
          });
        }, 5000);
      } else {
        updateSessionStatus(sessionId, {
          status: "disconnected",
          lastDisconnect: lastDisconnect?.error?.message,
          manualDisconnection: isManualDisconnection,
        });
        if (isManualDisconnection) {
          await notifyBackend("disconnected", sessionId, {
            reason: "manual_disconnection",
            timestamp: new Date().toISOString(),
          });
        }
      }
    } else if (connection === "open") {
      const socket = sessions.get(sessionId);
      const phoneNumber = socket?.user?.id;
      const displayName = socket?.user?.name || socket?.user?.notify || null;
      updateSessionStatus(sessionId, {
        status: "connected",
        phoneNumber,
        displayName,
        connectedAt: new Date().toISOString(),
      });
      qrCodes.delete(sessionId);
      qrAttempts.delete(sessionId);
      if (qrTimeouts.has(sessionId)) {
        clearTimeout(qrTimeouts.get(sessionId));
        qrTimeouts.delete(sessionId);
      }
      manualDisconnections.delete(sessionId);
      await notifyBackend("connected", sessionId, {
        phoneNumber,
        displayName,
      });
      if (global.services?.storage) {
        try {
          await global.services.storage.uploadSessionFiles(sessionId);
          logger.info(`Session files uploaded for ${sessionId}`);
        } catch (error) {
          logger.error(
            `Failed to upload session files for ${sessionId}:`,
            error
          );
        }
      }
      logger.info(`Session ${sessionId} connected successfully`);
    }
  } catch (error) {
    logger.error(`Error handling connection update for ${sessionId}:`, error);
  }
};

const handleRecoveredConnectionUpdate = async (sessionId, update) => {
  const { connection, lastDisconnect, qr } = update;
  const sessionInfo = sessionStatus.get(sessionId);

  if (!sessionInfo?.isRecovered) {
    // Not a recovered session, use normal handler
    return handleConnectionUpdate(sessionId, update);
  }

  logger.info(
    `[EVENT: connection.update] Recovered session connection update for ${sessionId}:`,
    {
      connection,
      previousStatus: sessionInfo.previousStatus,
      lastDisconnect: lastDisconnect?.error?.message,
    }
  );

  try {
    if (qr) {
      // Handle QR code for recovered session
      await handleConnectionUpdate(sessionId, update);
    } else if (connection === "open") {
      // Successfully reconnected
      const recoveredSocket = sessions.get(sessionId);
      const phoneNumber = recoveredSocket?.user?.id;
      const displayName =
        recoveredSocket?.user?.name || recoveredSocket?.user?.notify || null;

      updateSessionStatus(sessionId, {
        status: "connected",
        phoneNumber,
        displayName,
        connectedAt: new Date().toISOString(),
        recoverySuccessful: true,
      });

      // Clear recovery flags
      delete sessionInfo.isRecovered;
      delete sessionInfo.previousStatus;

      // Notify backend about successful recovery
      await notifyBackend("connected", sessionId, {
        phoneNumber,
        displayName,
        isRecovered: true,
      });

      // Upload session files to storage
      if (global.services?.storage) {
        try {
          await global.services.storage.uploadSessionFiles(sessionId);
          logger.info(
            `Session files uploaded for recovered session ${sessionId}`
          );
        } catch (error) {
          logger.error(
            `Failed to upload session files for recovered session ${sessionId}:`,
            error
          );
        }
      }

      logger.info(`Recovered session ${sessionId} connected successfully`);
    } else if (connection === "close") {
      // Handle disconnection for recovered session
      const isManualDisconnection = manualDisconnections.has(sessionId);
      const isLoggedOutFromPhone =
        lastDisconnect?.error?.output?.statusCode ===
          DisconnectReason.loggedOut ||
        (lastDisconnect?.error?.message &&
          (lastDisconnect.error.message.includes("Stream Errored (conflict)") ||
            lastDisconnect.error.message.includes("conflict") ||
            lastDisconnect.error.message.includes("logged out")));

      const shouldReconnect = !isManualDisconnection && !isLoggedOutFromPhone;

      logger.info(
        `Recovered session ${sessionId} closed. Manual: ${isManualDisconnection}, LoggedOut: ${isLoggedOutFromPhone}, Should reconnect: ${shouldReconnect}`,
        {
          disconnectReason: lastDisconnect?.error?.output?.statusCode,
          disconnectMessage: lastDisconnect?.error?.message,
          logoutDetectionDetails: {
            statusCodeMatch:
              lastDisconnect?.error?.output?.statusCode ===
              DisconnectReason.loggedOut,
            messageContainsConflict: lastDisconnect?.error?.message?.includes(
              "Stream Errored (conflict)"
            ),
            messageContainsConflictKeyword:
              lastDisconnect?.error?.message?.includes("conflict"),
            messageContainsLoggedOut:
              lastDisconnect?.error?.message?.includes("logged out"),
          },
        }
      );

      if (isLoggedOutFromPhone) {
        // Handle logout from phone for recovered session
        logger.warn(
          `Recovered session ${sessionId} was logged out from phone (unlinked WhatsApp app)`
        );

        // Get current session info before cleanup
        const sessionInfo = sessionStatus.get(sessionId);
        const phoneNumber = sessionInfo?.phoneNumber;
        const displayName = sessionInfo?.displayName;

        // Update session status to logged out
        updateSessionStatus(sessionId, {
          status: "logged_out",
          lastDisconnect: lastDisconnect?.error?.message,
          loggedOutFromPhone: true,
          loggedOutAt: new Date().toISOString(),
          recoveryFailed: true,
        });

        // Send webhook notification to backend about logout
        logger.info(
          `Sending logout webhook to backend for recovered session ${sessionId}:`,
          {
            sessionId,
            event: "session_logged_out",
            endpoint: `${workerRegistryService?.backendUrl || "NOT_SET"}/api/v1/webhooks/session-status`,
            reason: "logged_out_from_phone",
            phoneNumber: phoneNumber || "N/A",
            displayName: displayName || "N/A",
            isRecovered: true,
          }
        );

        await notifyBackend("session_logged_out", sessionId, {
          reason: "logged_out_from_phone",
          phoneNumber,
          displayName,
          isRecovered: true,
          timestamp: new Date().toISOString(),
        });

        logger.info(
          `Logout webhook sent successfully for recovered session ${sessionId}`
        );

        // Clean up logged out recovered session
        cleanupSession(sessionId).catch((error) => {
          logger.error(
            `Failed to cleanup logged out recovered session ${sessionId}:`,
            error
          );
        });
      } else if (shouldReconnect) {
        logger.info(
          `Recovered session ${sessionId} disconnected, will attempt reconnection`
        );
        updateSessionStatus(sessionId, {
          status: "reconnecting",
          lastDisconnect: lastDisconnect?.error?.message,
        });

        // Attempt reconnection after delay
        setTimeout(() => {
          reconnectSession(sessionId).catch((error) => {
            logger.error(
              `Reconnection failed for recovered session ${sessionId}:`,
              error
            );
          });
        }, 5000);
      } else {
        logger.info(`Recovered session ${sessionId} permanently disconnected`);
        updateSessionStatus(sessionId, {
          status: "disconnected",
          lastDisconnect: lastDisconnect?.error?.message,
          recoveryFailed: true,
          manualDisconnection: isManualDisconnection,
        });

        // Send disconnection webhook for manual disconnects
        if (isManualDisconnection) {
          await notifyBackend("disconnected", sessionId, {
            reason: "manual_disconnection",
            isRecovered: true,
            timestamp: new Date().toISOString(),
          });
        }

        // Clean up failed recovery session
        cleanupSession(sessionId).catch((error) => {
          logger.error(
            `Failed to cleanup failed recovery session ${sessionId}:`,
            error
          );
        });
      }
    }
  } catch (error) {
    logger.error(
      `Error handling recovered session connection update for ${sessionId}:`,
      error
    );
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

    socket.ev.on("connection.update", (update) => {
      const handler = options.isRecovery
        ? handleRecoveredConnectionUpdate
        : handleConnectionUpdate;
      handler(sessionId, update).catch((error) => {
        logger.error(
          `Error in connection update handler for ${sessionId}:`,
          error
        );
      });
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

const reconnectSession = async (sessionId) => {
  try {
    logger.info(`Attempting to reconnect session ${sessionId}`);
    if (manualDisconnections.has(sessionId)) {
      logger.info(
        `Skipping reconnection for manually disconnected session ${sessionId}`
      );
      return;
    }
    const sessionInfo = sessionStatus.get(sessionId);
    if (!sessionInfo) {
      logger.error(`Session info not found for ${sessionId}`);
      return;
    }
    sessions.delete(sessionId);
    await createSession(sessionId, sessionInfo.userId);
  } catch (error) {
    logger.error(`Failed to reconnect session ${sessionId}:`, error);
    updateSessionStatus(sessionId, {
      status: "failed",
      error: error.message,
    });
  }
};

const simulateHumanBehavior = async (sessionId, to) => {
  const socket = sessions.get(sessionId);
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
  const socket = sessions.get(sessionId);
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
      await simulateHumanBehavior(sessionId, to);
    }

    logger.info(`Sending message from ${sessionId} to ${to}`, {
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

const sendSeen = async (sessionId, to, messageId) => {
  const socket = sessions.get(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(
      `Sending read receipt from ${sessionId} to ${to} for message ${messageId}`
    );

    // Create message key for read receipt
    const messageKey = {
      remoteJid: to,
      id: messageId,
      participant: to.includes("@g.us") ? undefined : to, // For group messages
    };

    await socket.readMessages([messageKey]);

    logger.info(`Read receipt sent successfully from ${sessionId}`, {
      messageId,
      to,
    });

    return {
      success: true,
      messageId,
      to,
      status: "seen",
    };
  } catch (error) {
    logger.error(`Failed to send read receipt from ${sessionId}:`, error);
    throw new Error(`Failed to send read receipt: ${error.message}`);
  }
};

const startTyping = async (sessionId, to) => {
  const socket = sessions.get(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(`Starting typing indicator from ${sessionId} to ${to}`);

    await socket.sendPresenceUpdate("composing", to);

    logger.info(`Typing indicator started successfully from ${sessionId}`, {
      to,
    });

    return {
      success: true,
      to,
      status: "typing",
    };
  } catch (error) {
    logger.error(`Failed to start typing indicator from ${sessionId}:`, error);
    throw new Error(`Failed to start typing indicator: ${error.message}`);
  }
};

const stopTyping = async (sessionId, to) => {
  const socket = sessions.get(sessionId);
  if (!socket) {
    throw new Error(`Session ${sessionId} not found or not connected`);
  }
  if (!socket.user) {
    throw new Error(`Session ${sessionId} is not authenticated`);
  }
  try {
    logger.info(`Stopping typing indicator from ${sessionId} to ${to}`);

    await socket.sendPresenceUpdate("paused", to);

    logger.info(`Typing indicator stopped successfully from ${sessionId}`, {
      to,
    });

    return {
      success: true,
      to,
      status: "stopped_typing",
    };
  } catch (error) {
    logger.error(`Failed to stop typing indicator from ${sessionId}:`, error);
    throw new Error(`Failed to stop typing indicator: ${error.message}`);
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

const autoDisconnectSession = async (
  sessionId,
  reason = "max_qr_attempts_reached"
) => {
  try {
    logger.warn(`Auto-disconnecting session ${sessionId}, reason: ${reason}`);
    manualDisconnections.add(sessionId);
    const socket = sessions.get(sessionId);
    if (socket) {
      try {
        await socket.logout();
        logger.info(`Session ${sessionId} logged out during auto-disconnect`);
      } catch (error) {
        logger.warn(
          `Error during auto-disconnect logout for ${sessionId}:`,
          error
        );
      }
    }
    await cleanupSession(sessionId);
    if (global.services?.database) {
      try {
        await global.services.database.updateSessionStatus(
          sessionId,
          "disconnected"
        );
      } catch (error) {
        logger.error(
          `Error updating database for auto-disconnected session ${sessionId}:`,
          error
        );
      }
    }
    updateSessionStatus(sessionId, {
      status: "disconnected",
      autoDisconnected: true,
      autoDisconnectReason: reason,
      disconnectedAt: new Date().toISOString(),
    });
    await notifyBackend("session_auto_disconnected", sessionId, {
      reason,
      timestamp: new Date().toISOString(),
    });
    logger.info(`Session ${sessionId} auto-disconnected successfully`);
  } catch (error) {
    logger.error(
      `Error during auto-disconnect for session ${sessionId}:`,
      error
    );
  }
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

const updateSessionStatus = (sessionId, updates) => {
  const currentStatus = sessionStatus.get(sessionId) || {};
  const updatedStatus = {
    ...currentStatus,
    ...updates,
    lastSeen: new Date().toISOString(),
  };
  sessionStatus.set(sessionId, updatedStatus);
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

const loadPersistedSessions = async () => {
  try {
    logger.info("Starting session recovery process...");
    const assignedSessions = await getAssignedSessionsFromBackend();
    if (!assignedSessions || assignedSessions.length === 0) {
      logger.info("No assigned sessions found for recovery");
      return { success: true, recoveredSessions: 0 };
    }
    logger.info(
      `Found ${assignedSessions.length} assigned sessions for recovery`
    );
    let recoveredCount = 0;
    let failedCount = 0;
    const recoveryResults = [];
    for (const sessionInfo of assignedSessions) {
      try {
        const result = await restoreSessionFromStorage(sessionInfo);
        if (result.success) {
          recoveredCount++;
          recoveryResults.push({
            sessionId: sessionInfo.sessionId,
            status: "recovered",
            result,
          });
        } else {
          failedCount++;
          recoveryResults.push({
            sessionId: sessionInfo.sessionId,
            status: "failed",
            reason: result.reason,
          });
        }
      } catch (error) {
        failedCount++;
        logger.error(
          `Failed to recover session ${sessionInfo.sessionId}:`,
          error
        );
        recoveryResults.push({
          sessionId: sessionInfo.sessionId,
          status: "error",
          error: error.message,
        });
      }
    }
    await reportRecoveryStatus({
      totalSessions: assignedSessions.length,
      recoveredSessions: recoveredCount,
      failedSessions: failedCount,
      results: recoveryResults,
    });
    logger.info(
      `Session recovery completed: ${recoveredCount} recovered, ${failedCount} failed`
    );
    return {
      success: true,
      totalSessions: assignedSessions.length,
      recoveredSessions: recoveredCount,
      failedSessions: failedCount,
      results: recoveryResults,
    };
  } catch (error) {
    logger.error("Session recovery process failed:", error);
    throw new Error(`Session recovery failed: ${error.message}`);
  }
};

const getAssignedSessionsFromBackend = async () => {
  try {
    if (!workerRegistryService?.isInitialized()) {
      logger.warn(
        "Worker registry not initialized, cannot get assigned sessions"
      );
      return [];
    }
    if (!workerRegistryService.isRecoveryRequired()) {
      logger.info("No recovery required, skipping session retrieval");
      return [];
    }
    const assignedSessions = await workerRegistryService.getAssignedSessions();
    return assignedSessions || [];
  } catch (error) {
    logger.error("Failed to get assigned sessions from backend:", error);
    return [];
  }
};

const restoreSessionFromStorage = async (sessionInfo) => {
  const { sessionId, userId, status } = sessionInfo;
  try {
    logger.info(
      `Attempting to restore session ${sessionId} for user ${userId}`
    );
    if (sessions.has(sessionId)) {
      logger.warn(
        `Session ${sessionId} already exists in memory, skipping recovery`
      );
      return { success: false, reason: "Session already exists" };
    }
    if (!["CONNECTED", "QR_REQUIRED", "RECONNECTING"].includes(status)) {
      logger.info(
        `Skipping recovery for session ${sessionId} with status ${status}`
      );
      return { success: false, reason: `Status ${status} not recoverable` };
    }
    if (global.services?.storage?.isInitialized()) {
      try {
        const downloadResult =
          await global.services.storage.downloadSessionFiles(sessionId);
        if (!downloadResult.success) {
          logger.warn(
            `No session files found in storage for ${sessionId}, will create new session`
          );
        } else {
          logger.info(
            `Downloaded ${downloadResult.filesDownloaded} session files for ${sessionId}`
          );
        }
      } catch (error) {
        logger.warn(
          `Failed to download session files for ${sessionId}:`,
          error
        );
      }
    }
    const createResult = await createSession(sessionId, userId, {
      isRecovery: true,
      previousStatus: status,
    });
    if (createResult.success) {
      updateSessionStatus(sessionId, {
        status: status === "CONNECTED" ? "reconnecting" : "initializing",
        isRecovered: true,
        recoveredAt: new Date().toISOString(),
        previousStatus: status,
      });
      logger.info(`Session ${sessionId} restored successfully`);
      return {
        success: true,
        sessionId,
        previousStatus: status,
        currentStatus: getSessionStatus(sessionId).status,
      };
    } else {
      return { success: false, reason: "Failed to create session" };
    }
  } catch (error) {
    logger.error(`Failed to restore session ${sessionId}:`, error);
    return { success: false, reason: error.message };
  }
};

const reportRecoveryStatus = async (recoveryData) => {
  try {
    if (workerRegistryService?.isInitialized()) {
      await workerRegistryService.reportRecoveryStatus(recoveryData);
      logger.info("Recovery status reported to backend successfully");
    }
  } catch (error) {
    logger.error("Failed to report recovery status to backend:", error);
  }
};

const preserveSessionsForShutdown = async () => {
  try {
    logger.info("Preserving session state for graceful shutdown...");
    const activeSessions = Array.from(sessionStatus.entries())
      .filter(([, sessionInfo]) =>
        ["connected", "qr_ready"].includes(sessionInfo.status)
      )
      .map(([sessionId, sessionInfo]) => ({
        sessionId,
        userId: sessionInfo.userId,
        status: sessionInfo.status,
        phoneNumber: sessionInfo.phoneNumber,
        preservedAt: new Date().toISOString(),
      }));

    if (activeSessions.length > 0) {
      for (const sessionInfo of activeSessions) {
        try {
          if (global.services?.storage?.isInitialized()) {
            await global.services.storage.uploadSessionFiles(
              sessionInfo.sessionId
            );
            logger.info(`Session files preserved for ${sessionInfo.sessionId}`);
          }
        } catch (error) {
          logger.error(
            `Failed to preserve session files for ${sessionInfo.sessionId}:`,
            error
          );
        }
      }
      if (workerRegistryService?.isInitialized()) {
        try {
          await workerRegistryService.notifySessionsPreserved(activeSessions);
          logger.info(
            `Notified backend about ${activeSessions.length} preserved sessions`
          );
        } catch (error) {
          logger.error(
            "Failed to notify backend about preserved sessions:",
            error
          );
        }
      }
    }
    logger.info(
      `Session preservation completed for ${activeSessions.length} sessions`
    );
    return { success: true, preservedSessions: activeSessions.length };
  } catch (error) {
    logger.error("Failed to preserve sessions for shutdown:", error);
    return { success: false, error: error.message };
  }
};

const shutdown = async () => {
  try {
    logger.info("Shutting down Baileys service...");
    await preserveSessionsForShutdown();
    await closeAllSessions();
    logger.info("Baileys service shutdown complete");
  } catch (error) {
    logger.error("Error during Baileys service shutdown:", error);
  }
};

export default {
  setServices,
  initialize,
  createSession,
  sendMessage,
  sendSeen,
  startTyping,
  stopTyping,
  getSessionStatus,
  getAllSessions,
  getSessionCount,
  getConnectedSessionCount,
  getSessionStatistics,
  deleteSession,
  restartSession,
  disconnectSession,
  logoutSession,
  loadPersistedSessions,
  shutdown,
};

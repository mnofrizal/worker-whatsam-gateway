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

class BaileysService {
  constructor() {
    this.sessions = new Map(); // sessionId -> socket instance
    this.qrCodes = new Map(); // sessionId -> qr code data
    this.sessionStatus = new Map(); // sessionId -> status info
    this.manualDisconnections = new Set(); // Track manual disconnections
    this.qrAttempts = new Map(); // sessionId -> attempt count
    this.qrTimeouts = new Map(); // sessionId -> timeout reference
    this.storageDir = join(__dirname, "../../storage/sessions");
  }

  async initialize() {
    logger.info("Initializing Baileys service...");

    // Ensure storage directory exists
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      logger.info("Storage directory created/verified");
    } catch (error) {
      logger.error("Failed to create storage directory:", error);
      throw error;
    }

    // Get latest Baileys version
    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info(`Using Baileys version: ${version}, isLatest: ${isLatest}`);
    } catch (error) {
      logger.warn("Failed to fetch latest Baileys version:", error);
    }
  }

  async createSession(sessionId, userId, options = {}) {
    try {
      logger.info(`Creating session: ${sessionId} for user: ${userId}`);

      if (this.sessions.has(sessionId)) {
        throw new Error(`Session ${sessionId} already exists`);
      }

      // Setup auth state directory
      const authDir = join(this.storageDir, sessionId);
      await fs.mkdir(authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      // Create socket configuration
      const socketConfig = {
        auth: state,
        printQRInTerminal: false,
        logger: this.createBaileysLogger(),
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: 60000,
        ...options,
      };

      const socket = makeWASocket(socketConfig);

      // Set initial session status
      this.sessionStatus.set(sessionId, {
        sessionId,
        userId,
        status: "initializing",
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });

      // Handle connection updates
      socket.ev.on("connection.update", (update) => {
        this.handleConnectionUpdate(sessionId, update).catch((error) => {
          logger.error(
            `Error in connection update handler for ${sessionId}:`,
            error
          );
        });
      });

      // Handle credentials update
      socket.ev.on("creds.update", saveCreds);

      // Handle incoming messages
      socket.ev.on("messages.upsert", (messageUpdate) => {
        this.handleIncomingMessages(sessionId, messageUpdate);
      });

      // Handle message updates (delivery receipts, etc.)
      socket.ev.on("messages.update", (messageUpdate) => {
        this.handleMessageUpdates(sessionId, messageUpdate);
      });

      // Handle presence updates
      socket.ev.on("presence.update", (presenceUpdate) => {
        this.handlePresenceUpdate(sessionId, presenceUpdate);
      });

      // Store socket reference
      this.sessions.set(sessionId, socket);

      logger.info(`Session ${sessionId} created successfully`);
      return {
        success: true,
        sessionId,
        status: "initializing",
      };
    } catch (error) {
      logger.error(`Failed to create session ${sessionId}:`, error);

      // Clean up on failure
      this.sessions.delete(sessionId);
      this.qrCodes.delete(sessionId);
      this.sessionStatus.delete(sessionId);

      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  async handleConnectionUpdate(sessionId, update) {
    const { connection, lastDisconnect, qr } = update;

    logger.info(`Connection update for ${sessionId}:`, {
      connection,
      lastDisconnect: lastDisconnect?.error?.message,
    });

    try {
      if (qr) {
        // Check if max attempts already reached - don't process more QR codes
        const currentAttempts = this.qrAttempts.get(sessionId) || 0;
        if (currentAttempts >= 3) {
          logger.warn(
            `Ignoring QR code for session ${sessionId} - max attempts already reached`
          );
          return;
        }

        // Track QR attempts
        const newAttempts = currentAttempts + 1;
        this.qrAttempts.set(sessionId, newAttempts);

        logger.info(
          `QR code generated for session ${sessionId} (attempt ${newAttempts}/3)`,
          {
            qrLength: qr.length,
            qrPreview: qr.substring(0, 50) + "...",
          }
        );

        // Check if max attempts reached
        if (newAttempts >= 3) {
          logger.warn(
            `Session ${sessionId} reached maximum QR attempts (3), auto-disconnecting immediately`
          );

          // Store the final QR code
          this.qrCodes.set(sessionId, {
            qrCode: qr, // Raw QR string
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30000).toISOString(), // 30 seconds
            attempts: newAttempts,
            maxAttemptsReached: true,
          });

          // Update session status with final QR and warning
          this.updateSessionStatus(sessionId, {
            status: "qr_ready",
            qrCode: qr,
            qrAttempts: newAttempts,
            maxAttemptsReached: true,
            autoDisconnectIn: 30, // seconds
          });

          // Notify backend about max attempts reached
          await this.notifyBackend("session_auto_disconnected", sessionId, {
            qrCode: qr,
            attempts: newAttempts,
            maxAttempts: 3,
            autoDisconnectIn: 30,
          });

          // Auto-disconnect after 30 seconds to allow user to see the final QR
          const timeoutId = setTimeout(async () => {
            try {
              await this.autoDisconnectSession(
                sessionId,
                "max_qr_attempts_reached"
              );
            } catch (error) {
              logger.error(
                `Failed to auto-disconnect session ${sessionId}:`,
                error
              );
            }
          }, 30000); // 30 seconds delay

          this.qrTimeouts.set(sessionId, timeoutId);

          // Don't process any more QR codes for this session
          return;
        } else {
          // Store raw QR string
          this.qrCodes.set(sessionId, {
            qrCode: qr, // Raw QR string
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(), // 1 minute
            attempts: newAttempts,
          });

          // Update session status
          this.updateSessionStatus(sessionId, {
            status: "qr_ready",
            qrCode: qr, // Raw QR string
            qrAttempts: newAttempts,
          });

          // Notify backend about QR code ready
          await this.notifyBackend("qr_ready", sessionId, {
            qrCode: qr, // Raw QR string
            attempts: newAttempts,
          });
        }
      }

      if (connection === "close") {
        // Check if this was a manual disconnection
        const isManualDisconnection = this.manualDisconnections.has(sessionId);

        const shouldReconnect =
          !isManualDisconnection &&
          lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut;

        logger.info(
          `Session ${sessionId} closed. Manual: ${isManualDisconnection}, Should reconnect: ${shouldReconnect}`
        );

        // Remove from manual disconnections set
        this.manualDisconnections.delete(sessionId);

        if (shouldReconnect) {
          this.updateSessionStatus(sessionId, {
            status: "reconnecting",
            lastDisconnect: lastDisconnect?.error?.message,
          });

          // Attempt reconnection after delay
          setTimeout(() => {
            this.reconnectSession(sessionId).catch((error) => {
              logger.error(`Reconnection failed for ${sessionId}:`, error);
            });
          }, 5000);
        } else {
          this.updateSessionStatus(sessionId, {
            status: isManualDisconnection ? "disconnected" : "logged_out",
            lastDisconnect: lastDisconnect?.error?.message,
          });

          // Only clean up session if it was logged out (not manual disconnect)
          if (!isManualDisconnection) {
            this.cleanupSession(sessionId).catch((error) => {
              logger.error(`Failed to cleanup session ${sessionId}:`, error);
            });
          }
        }
      } else if (connection === "open") {
        const socket = this.sessions.get(sessionId);
        const phoneNumber = socket?.user?.id;

        this.updateSessionStatus(sessionId, {
          status: "connected",
          phoneNumber,
          connectedAt: new Date().toISOString(),
        });

        // Clear QR code as it's no longer needed
        this.qrCodes.delete(sessionId);

        // Reset QR attempts counter on successful connection
        this.qrAttempts.delete(sessionId);

        // Clear any pending QR timeout
        if (this.qrTimeouts.has(sessionId)) {
          clearTimeout(this.qrTimeouts.get(sessionId));
          this.qrTimeouts.delete(sessionId);
        }

        // Clear manual disconnection flag as session is now properly connected
        this.manualDisconnections.delete(sessionId);

        // Notify backend about successful connection
        await this.notifyBackend("connected", sessionId, {
          phoneNumber,
        });

        // Upload session files to storage
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
  }

  async reconnectSession(sessionId) {
    try {
      logger.info(`Attempting to reconnect session ${sessionId}`);

      // Check if this session was manually disconnected
      if (this.manualDisconnections.has(sessionId)) {
        logger.info(
          `Skipping reconnection for manually disconnected session ${sessionId}`
        );
        return;
      }

      const sessionInfo = this.sessionStatus.get(sessionId);
      if (!sessionInfo) {
        logger.error(`Session info not found for ${sessionId}`);
        return;
      }

      // Remove old socket
      this.sessions.delete(sessionId);

      // Create new session
      await this.createSession(sessionId, sessionInfo.userId);
    } catch (error) {
      logger.error(`Failed to reconnect session ${sessionId}:`, error);

      this.updateSessionStatus(sessionId, {
        status: "failed",
        error: error.message,
      });
    }
  }

  async sendMessage(sessionId, to, message) {
    const socket = this.sessions.get(sessionId);

    if (!socket) {
      throw new Error(`Session ${sessionId} not found or not connected`);
    }

    if (!socket.user) {
      throw new Error(`Session ${sessionId} is not authenticated`);
    }

    try {
      logger.info(`Sending message from ${sessionId} to ${to}`);

      const result = await socket.sendMessage(to, message);

      logger.info(`Message sent successfully from ${sessionId}`, {
        messageId: result.key.id,
        to,
      });

      return {
        messageId: result.key.id,
        status: "sent",
        timestamp: new Date().toISOString(),
        to,
      };
    } catch (error) {
      logger.error(`Failed to send message from ${sessionId}:`, error);
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  getSessionStatus(sessionId) {
    const sessionInfo = this.sessionStatus.get(sessionId);
    const qrInfo = this.qrCodes.get(sessionId);

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
  }

  getSessionsByStatus() {
    const statusCounts = {
      initializing: 0,
      qr_ready: 0,
      connected: 0,
      disconnected: 0,
      reconnecting: 0,
      failed: 0,
      logged_out: 0,
    };

    for (const [, sessionInfo] of this.sessionStatus) {
      const status = sessionInfo.status || "unknown";
      if (statusCounts.hasOwnProperty(status)) {
        statusCounts[status]++;
      }
    }

    return statusCounts;
  }

  getAllSessions() {
    return this.sessionStatus;
  }

  getSessionCount() {
    return this.sessionStatus.size;
  }

  getConnectedSessionCount() {
    let count = 0;
    for (const [, sessionInfo] of this.sessionStatus) {
      if (sessionInfo.status === "connected") {
        count++;
      }
    }
    return count;
  }

  getSessionStatistics() {
    const stats = {
      total: 0,
      connected: 0,
      disconnected: 0,
      qr_required: 0,
      reconnecting: 0,
      initializing: 0,
      error: 0,
    };

    for (const [, sessionInfo] of this.sessionStatus) {
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
  }

  async deleteSession(sessionId) {
    try {
      logger.info(`Deleting session ${sessionId}`);

      const socket = this.sessions.get(sessionId);

      if (socket) {
        try {
          await socket.logout();
          logger.info(`Session ${sessionId} logged out`);
        } catch (error) {
          logger.warn(`Failed to logout session ${sessionId}:`, error);
        }
      }

      // Clean up session
      await this.cleanupSession(sessionId);

      // Notify backend
      await this.notifyBackend("disconnected", sessionId);

      logger.info(`Session ${sessionId} deleted successfully`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}:`, error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  async restartSession(sessionId) {
    try {
      logger.info(`Restarting session ${sessionId}`);

      const sessionInfo = this.sessionStatus.get(sessionId);
      if (!sessionInfo) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Close current socket without logging out
      const socket = this.sessions.get(sessionId);
      if (socket) {
        try {
          socket.end();
          logger.info(`Session ${sessionId} socket closed for restart`);
        } catch (error) {
          logger.warn(`Failed to close socket for ${sessionId}:`, error);
        }
      }

      // Remove from sessions map but keep session status and auth files
      this.sessions.delete(sessionId);
      this.qrCodes.delete(sessionId);

      // Reset QR attempts counter on restart
      this.qrAttempts.delete(sessionId);
      logger.info(`QR attempts counter reset for session restart ${sessionId}`);

      // Clear any pending QR timeout
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
        this.qrTimeouts.delete(sessionId);
        logger.info(`QR timeout cleared for session restart ${sessionId}`);
      }

      // Update status to restarting
      this.updateSessionStatus(sessionId, {
        status: "restarting",
      });

      // Notify backend
      await this.notifyBackend("reconnecting", sessionId);

      // Create new session with same user ID
      await this.createSession(sessionId, sessionInfo.userId);

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
  }

  async disconnectSession(sessionId) {
    try {
      logger.info(`Disconnecting session ${sessionId}`);

      const socket = this.sessions.get(sessionId);
      if (!socket) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Mark as manual disconnection to prevent auto-reconnect
      this.manualDisconnections.add(sessionId);

      // Close socket without logging out (keeps auth data)
      try {
        socket.end();
        logger.info(`Session ${sessionId} socket disconnected`);
      } catch (error) {
        logger.warn(`Failed to disconnect socket for ${sessionId}:`, error);
      }

      // Remove from sessions map but keep session status and auth files
      this.sessions.delete(sessionId);
      this.qrCodes.delete(sessionId);

      // Reset QR attempts counter on manual disconnect
      this.qrAttempts.delete(sessionId);
      logger.info(`QR attempts counter reset for session ${sessionId}`);

      // Clear any pending QR timeout
      if (this.qrTimeouts.has(sessionId)) {
        clearTimeout(this.qrTimeouts.get(sessionId));
        this.qrTimeouts.delete(sessionId);
        logger.info(`QR timeout cleared for session ${sessionId}`);
      }

      // Update status to disconnected
      this.updateSessionStatus(sessionId, {
        status: "disconnected",
        disconnectedAt: new Date().toISOString(),
      });

      // Notify backend
      await this.notifyBackend("disconnected", sessionId);

      logger.info(`Session ${sessionId} disconnected successfully`);
      return { success: true, message: "Session disconnected" };
    } catch (error) {
      logger.error(`Failed to disconnect session ${sessionId}:`, error);
      throw new Error(`Failed to disconnect session: ${error.message}`);
    }
  }

  async logoutSession(sessionId) {
    try {
      logger.info(`Logging out session ${sessionId}`);

      const socket = this.sessions.get(sessionId);
      if (!socket) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Mark as manual disconnection to prevent auto-reconnect
      this.manualDisconnections.add(sessionId);

      // Logout from WhatsApp (this deletes auth data)
      try {
        await socket.logout();
        logger.info(`Session ${sessionId} logged out from WhatsApp`);
      } catch (error) {
        logger.warn(`Failed to logout from WhatsApp for ${sessionId}:`, error);
      }

      // Clean up session completely
      await this.cleanupSession(sessionId);

      // Update status to logged out
      this.updateSessionStatus(sessionId, {
        status: "logged_out",
        loggedOutAt: new Date().toISOString(),
      });

      // Notify backend
      await this.notifyBackend("disconnected", sessionId);

      logger.info(`Session ${sessionId} logged out successfully`);
      return { success: true, message: "Session logged out successfully" };
    } catch (error) {
      logger.error(`Failed to logout session ${sessionId}:`, error);
      throw new Error(`Failed to logout session: ${error.message}`);
    }
  }

  /**
   * Auto-disconnect session after maximum QR attempts
   * @param {string} sessionId - Session ID
   * @param {string} reason - Reason for auto-disconnect
   */
  async autoDisconnectSession(sessionId, reason = "max_qr_attempts_reached") {
    try {
      logger.warn(`Auto-disconnecting session ${sessionId}, reason: ${reason}`);

      // Mark as manually disconnected to prevent reconnection
      this.manualDisconnections.add(sessionId);

      // Get the socket if it exists
      const socket = this.sessions.get(sessionId);
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

      // Clean up session resources
      await this.cleanupSession(sessionId);

      // Update session status in database
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

      // Update session status
      this.updateSessionStatus(sessionId, {
        status: "disconnected",
        autoDisconnected: true,
        autoDisconnectReason: reason,
        disconnectedAt: new Date().toISOString(),
      });

      // Notify backend if available
      await this.notifyBackend("session_auto_disconnected", sessionId, {
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
  }

  async cleanupSession(sessionId) {
    // Remove from memory
    this.sessions.delete(sessionId);
    this.qrCodes.delete(sessionId);
    this.sessionStatus.delete(sessionId);
    this.manualDisconnections.delete(sessionId);

    // Clear QR attempts counter
    this.qrAttempts.delete(sessionId);

    // Clear any pending QR timeout
    if (this.qrTimeouts.has(sessionId)) {
      clearTimeout(this.qrTimeouts.get(sessionId));
      this.qrTimeouts.delete(sessionId);
    }

    // Clean up storage files
    if (global.services?.storage) {
      try {
        await global.services.storage.deleteSessionFiles(sessionId);
        logger.info(`Storage files cleaned up for ${sessionId}`);
      } catch (error) {
        logger.error(
          `Failed to cleanup storage files for ${sessionId}:`,
          error
        );
      }
    }

    logger.info(`Session cleanup completed for ${sessionId}`);
  }

  async closeAllSessions() {
    logger.info("Closing all sessions...");

    const sessionIds = Array.from(this.sessions.keys());

    for (const sessionId of sessionIds) {
      try {
        await this.deleteSession(sessionId);
      } catch (error) {
        logger.error(`Failed to close session ${sessionId}:`, error);
      }
    }

    logger.info("All sessions closed");
  }

  updateSessionStatus(sessionId, updates) {
    const currentStatus = this.sessionStatus.get(sessionId) || {};
    const updatedStatus = {
      ...currentStatus,
      ...updates,
      lastSeen: new Date().toISOString(),
    };

    this.sessionStatus.set(sessionId, updatedStatus);
  }

  handleIncomingMessages(sessionId, messageUpdate) {
    const { messages } = messageUpdate;

    for (const message of messages) {
      logger.info(`Incoming message for ${sessionId}:`, {
        messageId: message.key.id,
        from: message.key.remoteJid,
        messageType: Object.keys(message.message || {})[0],
      });

      // Here you can add logic to process incoming messages
      // For example, store in database, trigger webhooks, etc.
    }
  }

  handleMessageUpdates(sessionId, messageUpdate) {
    for (const update of messageUpdate) {
      logger.debug(`Message update for ${sessionId}:`, {
        messageId: update.key.id,
        status: update.update.status,
      });
    }
  }

  handlePresenceUpdate(sessionId, presenceUpdate) {
    logger.debug(`Presence update for ${sessionId}:`, presenceUpdate);
  }

  async notifyBackend(event, sessionId, data = {}) {
    if (global.services?.workerRegistry) {
      try {
        await global.services.workerRegistry.notifyBackend(
          event,
          sessionId,
          data
        );
      } catch (error) {
        logger.error(
          `Failed to notify backend about ${event} for ${sessionId}:`,
          error
        );
      }
    }
  }

  createBaileysLogger() {
    // Create a proper logger interface for Baileys
    return {
      level: "silent",
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => this.createBaileysLogger(),
    };
  }

  // Shutdown method for graceful cleanup
  async shutdown() {
    try {
      logger.info("Shutting down Baileys service...");

      // Close all active sessions
      await this.closeAllSessions();

      logger.info("Baileys service shutdown complete");
    } catch (error) {
      logger.error("Error during Baileys service shutdown:", error);
    }
  }
}

export default BaileysService;

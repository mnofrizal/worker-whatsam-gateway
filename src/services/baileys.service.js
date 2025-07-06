import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
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
      socket.ev.on("connection.update", async (update) => {
        await this.handleConnectionUpdate(sessionId, update);
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
        // Generate QR code
        const qrCodeData = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, {
          qrCode: qrCodeData,
          timestamp: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(), // 1 minute
        });

        // Update session status
        this.updateSessionStatus(sessionId, {
          status: "qr_ready",
          qrCode: qrCodeData,
        });

        // Notify backend about QR code ready
        await this.notifyBackend("qr_ready", sessionId, {
          qrCode: qrCodeData,
        });

        logger.info(`QR code generated for session ${sessionId}`);
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        logger.info(
          `Session ${sessionId} closed. Should reconnect: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          this.updateSessionStatus(sessionId, {
            status: "reconnecting",
            lastDisconnect: lastDisconnect?.error?.message,
          });

          // Attempt reconnection after delay
          setTimeout(() => {
            this.reconnectSession(sessionId);
          }, 5000);
        } else {
          this.updateSessionStatus(sessionId, {
            status: "logged_out",
            lastDisconnect: lastDisconnect?.error?.message,
          });

          // Clean up session
          await this.cleanupSession(sessionId);
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
      await this.notifyBackend("deleted", sessionId);

      logger.info(`Session ${sessionId} deleted successfully`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}:`, error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  async cleanupSession(sessionId) {
    // Remove from memory
    this.sessions.delete(sessionId);
    this.qrCodes.delete(sessionId);
    this.sessionStatus.delete(sessionId);

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
    return {
      level: "silent", // Disable Baileys internal logging
      child: () => this.createBaileysLogger(),
    };
  }
}

export default BaileysService;

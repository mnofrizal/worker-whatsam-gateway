const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const logger = require("../utils/logger");

class BaileysService {
  constructor() {
    this.sessions = new Map();
    this.qrCodes = new Map();
  }

  async createSession(sessionId) {
    const { state, saveCreds } = await useMultiFileAuthState(
      `./storage/sessions/${sessionId}`
    );

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: new (class {
        trace(message) {
          logger.debug(message);
        }
        debug(message) {
          logger.debug(message);
        }
        info(message) {
          logger.info(message);
        }
        warn(message) {
          logger.warn(message);
        }
        error(message) {
          logger.error(message);
        }
        child(options) {
          return this; // Return the same logger instance for child loggers
        }
      })(),
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrCodeData = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrCodeData);
        logger.info(`QR code generated for session: ${sessionId}`);
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        logger.info(
          `Connection closed for session: ${sessionId}, reconnecting: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          this.createSession(sessionId);
        } else {
          this.deleteSession(sessionId);
        }
      } else if (connection === "open") {
        logger.info(`Session connected: ${sessionId}`);
        this.sessions.set(sessionId, socket);
        this.qrCodes.delete(sessionId);
      }
    });

    this.sessions.set(sessionId, socket);
    return { success: true, sessionId };
  }

  async deleteSession(sessionId) {
    const socket = this.sessions.get(sessionId);
    if (socket) {
      await socket.logout();
      this.sessions.delete(sessionId);
    }
    this.qrCodes.delete(sessionId);
    // Here you would also clean up the session files from storage
    logger.info(`Session deleted: ${sessionId}`);
    return { success: true };
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getQrCode(sessionId) {
    return this.qrCodes.get(sessionId);
  }
}

module.exports = new BaileysService();

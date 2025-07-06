import express from "express";
import {
  sessionRateLimit,
  qrCodeRateLimit,
} from "../middleware/rate-limit.middleware.js";
import {
  validateSessionId,
  validateSessionCreation,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// Start WhatsApp session (create if new, connect if existing)
router.post(
  "/start",
  sessionRateLimit,
  validateSessionCreation,
  async (req, res, next) => {
    try {
      await global.controllers.session.startSession(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Get QR code for session authentication
router.get(
  "/:sessionId/qr",
  qrCodeRateLimit,
  validateSessionId,
  async (req, res, next) => {
    try {
      await global.controllers.session.getQRCode(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Get session status
router.get("/:sessionId/status", validateSessionId, async (req, res, next) => {
  try {
    await global.controllers.session.getSessionStatus(req, res);
  } catch (error) {
    next(error);
  }
});

// Delete session
router.delete(
  "/:sessionId",
  sessionRateLimit,
  validateSessionId,
  async (req, res, next) => {
    try {
      await global.controllers.session.deleteSession(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Send message through session
router.post("/:sessionId/send", async (req, res, next) => {
  try {
    await global.controllers.session.sendMessage(req, res);
  } catch (error) {
    next(error);
  }
});

// Restart session (stop and start again, keep auth data)
router.post(
  "/:sessionId/restart",
  sessionRateLimit,
  validateSessionId,
  async (req, res, next) => {
    try {
      await global.controllers.session.restartSession(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Disconnect session (stop session, keep auth data for instant reconnect)
router.post(
  "/:sessionId/disconnect",
  sessionRateLimit,
  validateSessionId,
  async (req, res, next) => {
    try {
      await global.controllers.session.disconnectSession(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Logout session (stop session and delete auth data, requires QR scan)
router.post(
  "/:sessionId/logout",
  sessionRateLimit,
  validateSessionId,
  async (req, res, next) => {
    try {
      await global.controllers.session.logoutSession(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// List all sessions
router.get("/", async (req, res, next) => {
  try {
    await global.controllers.session.listSessions(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;

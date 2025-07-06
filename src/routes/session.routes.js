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

// Create new WhatsApp session
router.post(
  "/create",
  sessionRateLimit,
  validateSessionCreation,
  async (req, res, next) => {
    try {
      await global.controllers.session.createSession(req, res);
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

// List all sessions
router.get("/", async (req, res, next) => {
  try {
    await global.controllers.session.listSessions(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;

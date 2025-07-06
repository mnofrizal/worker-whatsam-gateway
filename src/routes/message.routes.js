import express from "express";
import {
  messageRateLimit,
  bulkMessageRateLimit,
  fileUploadRateLimit,
} from "../middleware/rate-limit.middleware.js";
import {
  validateSessionId,
  validatePhoneNumber,
  validateMessageContent,
  validateBulkMessage,
  validateFileUpload,
  validatePagination,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// Send text message
router.post(
  "/:sessionId/send/text",
  messageRateLimit,
  validateSessionId,
  validatePhoneNumber,
  validateMessageContent,
  async (req, res, next) => {
    try {
      await global.controllers.message.sendTextMessage(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Send media message
router.post(
  "/:sessionId/send/media",
  fileUploadRateLimit,
  validateSessionId,
  validatePhoneNumber,
  global.upload.single("media"),
  validateFileUpload,
  async (req, res, next) => {
    try {
      await global.controllers.message.sendMediaMessage(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Get message history
router.get(
  "/:sessionId/history",
  validateSessionId,
  validatePagination,
  async (req, res, next) => {
    try {
      await global.controllers.message.getMessageHistory(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Get message statistics
router.get("/:sessionId/stats", validateSessionId, async (req, res, next) => {
  try {
    await global.controllers.message.getMessageStats(req, res);
  } catch (error) {
    next(error);
  }
});

// Bulk send messages
router.post(
  "/:sessionId/send/bulk",
  bulkMessageRateLimit,
  validateSessionId,
  validateBulkMessage,
  async (req, res, next) => {
    try {
      await global.controllers.message.bulkSendMessages(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

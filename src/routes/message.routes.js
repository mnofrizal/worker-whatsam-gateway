import express from "express";
import messageController from "../controllers/message.controller.js";
import { messageRateLimit } from "../middleware/rate-limit.middleware.js";
import {
  validateSendMessage,
  validateSendSeen,
  validateStartTyping,
  validateStopTyping,
  validateMessageHistory,
  validateMessageStats,
} from "../validations/message.validation.js";

const router = express.Router();

// Unified send endpoint for all message types
router.post(
  "/:sessionId/send",
  messageRateLimit,
  validateSendMessage,
  messageController.sendMessage
);

// Send read receipt (mark message as seen)
router.post(
  "/:sessionId/sendSeen",
  messageRateLimit,
  validateSendSeen,
  messageController.sendSeen
);

// Start typing indicator
router.post(
  "/:sessionId/startTyping",
  messageRateLimit,
  validateStartTyping,
  messageController.startTyping
);

// Stop typing indicator
router.post(
  "/:sessionId/stopTyping",
  messageRateLimit,
  validateStopTyping,
  messageController.stopTyping
);

router.get(
  "/:sessionId/history",
  validateMessageHistory,
  messageController.getMessageHistory
);

router.get(
  "/:sessionId/stats",
  validateMessageStats,
  messageController.getMessageStats
);

export default router;

import express from "express";
import sessionRoutes from "./session.routes.js";
import messageRoutes from "./message.routes.js";
import sendController from "../controllers/send.controller.js";
import { messageRateLimit } from "../middleware/rate-limit.middleware.js";
import { validateSendMessage } from "../validations/message.validation.js";

const router = express.Router();

// Mount routes directly - no more factory functions
router.use("/sessions", sessionRoutes);
router.use("/session", sessionRoutes); // Alias for backward compatibility
router.use("/messages", messageRoutes);

// Unified send endpoint for all message types including seen, typing indicators
// POST /api/{sessionId}/send - Send message (supports all types: text, image, document, video, audio, location, contact, seen, typing_start, typing_stop)
router.post(
  "/:sessionId/send",
  messageRateLimit,
  validateSendMessage,
  sendController.sendMessage
);

export default router;

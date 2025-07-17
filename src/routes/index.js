import express from "express";
import sessionRoutes from "./session.routes.js";
import messageRoutes from "./message.routes.js";
import sendController from "../controllers/send.controller.js";
import { messageRateLimit } from "../middleware/rate-limit.middleware.js";
import { validateSendMessage } from "../validations/message.validation.js";

const router = express.Router();

// Direct send endpoint at root level: /api/{sessionId}/send
router.post(
  "/:sessionId/send",
  messageRateLimit,
  validateSendMessage,
  sendController.sendMessage
);

// Mount routes directly - no more factory functions
router.use("/sessions", sessionRoutes);
router.use("/session", sessionRoutes); // Alias for backward compatibility
router.use("/messages", messageRoutes);
router.use("/message", messageRoutes); // Alias for message management endpoint

export default router;

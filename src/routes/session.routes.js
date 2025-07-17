import express from "express";
import sessionController from "../controllers/session.controller.js";
import messageController from "../controllers/message.controller.js";
import {
  sessionRateLimit,
  messageRateLimit,
} from "../middleware/rate-limit.middleware.js";
import {
  validateSessionId,
  validateSessionCreation,
} from "../middleware/validation.middleware.js";

const router = express.Router();

router.post(
  "/start",
  sessionRateLimit,
  validateSessionCreation,
  sessionController.startSession
);

router.get(
  "/:sessionId/status",
  validateSessionId,
  sessionController.getSessionStatus
);

router.delete(
  "/:sessionId",
  sessionRateLimit,
  validateSessionId,
  sessionController.deleteSession
);

router.post(
  "/:sessionId/restart",
  sessionRateLimit,
  validateSessionId,
  sessionController.restartSession
);

router.post(
  "/:sessionId/disconnect",
  sessionRateLimit,
  validateSessionId,
  sessionController.disconnectSession
);

router.post(
  "/:sessionId/logout",
  sessionRateLimit,
  validateSessionId,
  sessionController.logoutSession
);

router.get("/", sessionController.listSessions);

// Unified send endpoint that handles all message types based on 'type' field
// This handles POST /api/sessions/{sessionId}/send for all message types
router.post(
  "/:sessionId/send",
  messageRateLimit,
  validateSessionId,
  messageController.sendMessage
);

export default router;

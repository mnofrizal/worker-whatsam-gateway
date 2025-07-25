import express from "express";
import sessionController from "../controllers/session.controller.js";
import { sessionRateLimit } from "../middleware/rate-limit.middleware.js";
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

// Note: Send endpoint moved to index routes as /api/{sessionId}/send

export default router;

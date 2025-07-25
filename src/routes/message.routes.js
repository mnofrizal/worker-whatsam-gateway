import express from "express";
import messageController from "../controllers/message.controller.js";
import {
  validateMessageStats,
  validateMessageManagement,
} from "../validations/message.validation.js";

const router = express.Router();

// Keep only the stats endpoint - send endpoint moved to index routes
router.get(
  "/:sessionId/stats",
  validateMessageStats,
  messageController.getMessageStats
);

// Message management endpoint - using controller's switch case (best practice)
router.post(
  "/:sessionId/manage",
  validateMessageManagement,
  messageController.manageMessage
);

export default router;

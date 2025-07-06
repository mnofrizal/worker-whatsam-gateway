import express from "express";
import sessionRoutes from "./session.routes.js";
import messageRoutes from "./message.routes.js";

const router = express.Router();

// API version
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Worker API",
    version: "1.0.0",
    endpoints: {
      sessions: "/api/session",
      messages: "/api/message",
      health: "/health",
    },
  });
});

// Route handlers
router.use("/session", sessionRoutes);
router.use("/message", messageRoutes);

export default router;

import express from "express";
import sessionRoutes from "./session.routes.js";
import messageRoutes from "./message.routes.js";

const router = express.Router();

// Mount routes directly - no more factory functions
router.use("/sessions", sessionRoutes);
router.use("/session", sessionRoutes); // Alias for backward compatibility
router.use("/messages", messageRoutes);

export default router;

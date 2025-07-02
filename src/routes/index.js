const express = require("express");
const sessionRoutes = require("./session.routes");
const messageRoutes = require("./message.routes");
const healthRoutes = require("./health.routes");

const router = express.Router();

router.use("/session", sessionRoutes);
router.use("/message", messageRoutes);
router.use("/health", healthRoutes);

module.exports = router;

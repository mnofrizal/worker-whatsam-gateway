const express = require("express");
const router = express.Router();
const messageController = require("../controllers/message.controller");

router.post("/:sessionId/send", messageController.sendMessage);
router.get("/:sessionId/history", messageController.getMessageHistory);

module.exports = router;

const express = require("express");
const router = express.Router();
const sessionController = require("../controllers/session.controller");

router.post("/create", sessionController.createSession);
router.get("/:sessionId/status", sessionController.getSessionStatus);
router.get("/:sessionId/qr", sessionController.getQrCode);
router.delete("/:sessionId", sessionController.deleteSession);

module.exports = router;

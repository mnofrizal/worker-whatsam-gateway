const baileysService = require("../services/baileys.service");
const logger = require("../utils/logger");
const ApiResponse = require("../utils/helper");
const { HTTP_STATUS } = require("../utils/constants");

const createSession = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(ApiResponse.createErrorResponse("400", "sessionId is required"));
  }

  try {
    await baileysService.createSession(sessionId);
    res
      .status(HTTP_STATUS.CREATED)
      .json(
        ApiResponse.createSuccessResponse({
          message: "Session created successfully",
        })
      );
  } catch (error) {
    logger.error(`Error creating session: ${error.message}`);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createErrorResponse("500", "Failed to create session"));
  }
};

const getSessionStatus = (req, res) => {
  const { sessionId } = req.params;
  const session = baileysService.getSession(sessionId);
  const status = session
    ? session.user
      ? "connected"
      : "connecting"
    : "disconnected";
  res
    .status(HTTP_STATUS.OK)
    .json(ApiResponse.createSuccessResponse({ status }));
};

const getQrCode = (req, res) => {
  const { sessionId } = req.params;
  const qr = baileysService.getQrCode(sessionId);
  if (qr) {
    res.status(HTTP_STATUS.OK).json(ApiResponse.createSuccessResponse({ qr }));
  } else {
    res
      .status(HTTP_STATUS.NOT_FOUND)
      .json(ApiResponse.createErrorResponse("404", "QR code not found"));
  }
};

const deleteSession = async (req, res) => {
  const { sessionId } = req.params;
  try {
    await baileysService.deleteSession(sessionId);
    res
      .status(HTTP_STATUS.OK)
      .json(
        ApiResponse.createSuccessResponse({
          message: "Session deleted successfully",
        })
      );
  } catch (error) {
    logger.error(`Error deleting session: ${error.message}`);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createErrorResponse("500", "Failed to delete session"));
  }
};

module.exports = {
  createSession,
  getSessionStatus,
  getQrCode,
  deleteSession,
};

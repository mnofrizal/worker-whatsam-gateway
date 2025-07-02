const baileysService = require("../services/baileys.service");
const logger = require("../utils/logger");
const ApiResponse = require("../utils/helper");
const { HTTP_STATUS } = require("../utils/constants");

const sendMessage = async (req, res) => {
  const { sessionId } = req.params;
  const { to, text } = req.body;

  if (!to || !text) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createErrorResponse("400", "`to` and `text` are required")
      );
  }

  const session = baileysService.getSession(sessionId);
  if (!session) {
    return res
      .status(HTTP_STATUS.NOT_FOUND)
      .json(ApiResponse.createErrorResponse("404", "Session not found"));
  }

  try {
    await session.sendMessage(to, { text });
    res
      .status(HTTP_STATUS.OK)
      .json(
        ApiResponse.createSuccessResponse({
          message: "Message sent successfully",
        })
      );
  } catch (error) {
    logger.error(`Error sending message: ${error.message}`);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(ApiResponse.createErrorResponse("500", "Failed to send message"));
  }
};

const getMessageHistory = (req, res) => {
  res
    .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    .json(ApiResponse.createErrorResponse("501", "Not Implemented"));
};

module.exports = {
  sendMessage,
  getMessageHistory,
};

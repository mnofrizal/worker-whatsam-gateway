const ApiResponse = require("../utils/helper");
const { HTTP_STATUS } = require("../utils/constants");

const checkHealth = (req, res) => {
  res.status(HTTP_STATUS.OK).json(
    ApiResponse.createSuccessResponse({
      status: "healthy",
      message: "Worker is running.",
    })
  );
};

module.exports = {
  checkHealth,
};

const dotenv = require("dotenv");
dotenv.config();

const config = {
  // Server Configuration
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
};

module.exports = config;

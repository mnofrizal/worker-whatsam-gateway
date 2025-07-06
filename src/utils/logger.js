import winston from "winston";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import config from "../config/environment.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = join(__dirname, "../../", config.logging.filePath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create transports array
const transports = [];

// File transports (if enabled)
if (config.logging.enableFile) {
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: join(logsDir, "error.log"),
      level: "error",
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      format: config.logging.enableJson
        ? winston.format.json()
        : winston.format.simple(),
    })
  );

  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: join(logsDir, "combined.log"),
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      format: config.logging.enableJson
        ? winston.format.json()
        : winston.format.simple(),
    })
  );

  // Daily rotate file (if date pattern is specified)
  if (config.logging.datePattern) {
    transports.push(
      new winston.transports.File({
        filename: join(
          logsDir,
          `app-${new Date().toISOString().split("T")[0]}.log`
        ),
        maxsize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
      })
    );
  }
}

// Console transport (if enabled)
if (config.logging.enableConsole) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let metaStr = "";
          if (Object.keys(meta).length > 0) {
            metaStr = ` ${JSON.stringify(meta)}`;
          }
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    })
  );
}

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.errors({ stack: true }),
    config.logging.enableJson ? winston.format.json() : winston.format.simple()
  ),
  defaultMeta: {
    service: "whatsapp-worker",
    workerId: config.server.workerId,
    environment: config.server.nodeEnv,
  },
  transports,
});

// Create a stream object with a 'write' function that will be used by `morgan`
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

export default logger;

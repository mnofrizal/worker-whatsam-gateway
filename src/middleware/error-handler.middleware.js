import logger from "../utils/logger.js";
import { ApiResponse } from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error("Error occurred:", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
  });

  let response;
  let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    statusCode = HTTP_STATUS.NOT_FOUND;
    response = ApiResponse.createNotFoundResponse("Resource not found");
  }
  // Mongoose duplicate key
  else if (err.code === 11000) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    response = ApiResponse.createValidationErrorResponse(
      "Duplicate field value entered",
      [
        {
          field: "unknown",
          message: "Duplicate field value entered",
        },
      ]
    );
  }
  // Mongoose validation error
  else if (err.name === "ValidationError") {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    const errors = Object.keys(err.errors).map((field) => ({
      field,
      message: err.errors[field].message,
    }));
    response = ApiResponse.createValidationErrorResponse(
      "Validation failed",
      errors
    );
  }
  // JWT errors
  else if (err.name === "JsonWebTokenError") {
    statusCode = HTTP_STATUS.UNAUTHORIZED;
    response = ApiResponse.createUnauthorizedResponse("Invalid token");
  } else if (err.name === "TokenExpiredError") {
    statusCode = HTTP_STATUS.UNAUTHORIZED;
    response = ApiResponse.createUnauthorizedResponse("Token expired");
  }
  // Baileys errors
  else if (err.name === "DisconnectionError") {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    response = ApiResponse.createErrorResponse(
      "WhatsApp connection lost",
      ERROR_CODES.SERVICE_UNAVAILABLE
    );
  }
  // File upload errors
  else if (err.code === "INVALID_FILE_TYPE") {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    response = ApiResponse.createValidationErrorResponse("Invalid file type", [
      {
        field: "file",
        message: err.message,
      },
    ]);
  } else if (err.code === "LIMIT_FILE_SIZE") {
    statusCode = HTTP_STATUS.PAYLOAD_TOO_LARGE;
    response = ApiResponse.createErrorResponse(
      "File too large",
      ERROR_CODES.PAYLOAD_TOO_LARGE
    );
  } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    response = ApiResponse.createValidationErrorResponse(
      "Unexpected file field",
      [
        {
          field: "file",
          message: "Unexpected file field in request",
        },
      ]
    );
  }
  // Rate limit errors
  else if (err.status === 429) {
    statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;
    response = ApiResponse.createRateLimitResponse(
      "Too many requests, please try again later"
    );
  }
  // Default error response
  else {
    statusCode =
      error.statusCode || err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const message = error.message || err.message || "Internal Server Error";
    response = ApiResponse.createInternalErrorResponse(message);
  }

  // Add development details if in development mode
  if (process.env.NODE_ENV === "development") {
    response.debug = {
      stack: err.stack,
      details: error,
      originalError: {
        name: err.name,
        message: err.message,
        code: err.code,
        status: err.status,
      },
    };
  }

  res.status(statusCode).json(response);
};

export default errorHandler;

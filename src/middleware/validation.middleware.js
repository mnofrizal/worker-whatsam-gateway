import { ApiResponse, Utils } from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  VALIDATION,
  REGEX,
  MESSAGE_TYPES,
  FILE_UPLOAD,
} from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Session ID Validation Middleware
 * Validates session ID format and presence
 */
export const validateSessionId = (req, res, next) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      ApiResponse.createValidationErrorResponse("Session ID is required", [
        {
          field: "sessionId",
          message: "Session ID parameter is required",
        },
      ])
    );
  }

  if (
    typeof sessionId !== "string" ||
    sessionId.length < VALIDATION.SESSION_ID.MIN_LENGTH
  ) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      ApiResponse.createValidationErrorResponse("Invalid session ID format", [
        {
          field: "sessionId",
          message: `Session ID must be a string with at least ${VALIDATION.SESSION_ID.MIN_LENGTH} characters`,
        },
      ])
    );
  }

  // Sanitize session ID (alphanumeric, hyphens, underscores only)
  if (!REGEX.SESSION_ID.test(sessionId)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      ApiResponse.createValidationErrorResponse("Invalid session ID format", [
        {
          field: "sessionId",
          message:
            "Session ID can only contain letters, numbers, hyphens, and underscores",
        },
      ])
    );
  }

  next();
};

/**
 * Phone Number Validation Middleware
 * Validates phone number format for WhatsApp
 */
export const validatePhoneNumber = (req, res, next) => {
  const { to, phone, phoneNumber } = req.body;
  const phoneToValidate = to || phone || phoneNumber;

  if (!phoneToValidate) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      ApiResponse.createValidationErrorResponse("Phone number is required", [
        {
          field: "to",
          message: "Phone number is required",
        },
      ])
    );
  }

  if (!Utils.isValidPhoneNumber(phoneToValidate)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      ApiResponse.createValidationErrorResponse("Invalid phone number format", [
        {
          field: "to",
          message:
            "Phone number must be in format: 628xxxxxxxxx or +628xxxxxxxxx",
        },
      ])
    );
  }

  // Normalize phone number
  req.body.to = Utils.formatWhatsAppId(phoneToValidate);

  next();
};

/**
 * Message Content Validation Middleware
 * Validates message content and type
 */
export const validateMessageContent = (req, res, next) => {
  const { message, text, content, type = "text" } = req.body;
  const messageContent = message || text || content;

  const errors = [];

  // Validate message type
  const allowedTypes = Object.values(MESSAGE_TYPES);
  if (!allowedTypes.includes(type)) {
    errors.push({
      field: "type",
      message: `Message type must be one of: ${allowedTypes.join(", ")}`,
    });
  }

  // Validate message content for text messages
  if (type === MESSAGE_TYPES.TEXT) {
    if (!messageContent) {
      errors.push({
        field: "message",
        message: "Message content is required for text messages",
      });
    } else if (typeof messageContent !== "string") {
      errors.push({
        field: "message",
        message: "Message content must be a string",
      });
    } else if (messageContent.length > VALIDATION.MESSAGE.MAX_LENGTH) {
      errors.push({
        field: "message",
        message: `Message content cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
      });
    }
  }

  // Validate media messages
  if (
    [
      MESSAGE_TYPES.IMAGE,
      MESSAGE_TYPES.DOCUMENT,
      MESSAGE_TYPES.AUDIO,
      MESSAGE_TYPES.VIDEO,
    ].includes(type)
  ) {
    if (!req.file && !req.body.mediaUrl) {
      errors.push({
        field: "media",
        message: "Media file or media URL is required for media messages",
      });
    }
  }

  if (errors.length > 0) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createValidationErrorResponse(
          "Message validation failed",
          errors
        )
      );
  }

  // Normalize message content
  req.body.message = messageContent;

  next();
};

/**
 * Session Creation Validation Middleware
 * Validates session creation parameters
 */
export const validateSessionCreation = (req, res, next) => {
  const { sessionId, userId, sessionName } = req.body;
  const errors = [];

  // Validate session ID
  if (!sessionId) {
    errors.push({
      field: "sessionId",
      message: "Session ID is required",
    });
  } else if (
    typeof sessionId !== "string" ||
    sessionId.length < VALIDATION.SESSION_ID.MIN_LENGTH
  ) {
    errors.push({
      field: "sessionId",
      message: `Session ID must be a string with at least ${VALIDATION.SESSION_ID.MIN_LENGTH} characters`,
    });
  } else if (!REGEX.SESSION_ID.test(sessionId)) {
    errors.push({
      field: "sessionId",
      message:
        "Session ID can only contain letters, numbers, hyphens, and underscores",
    });
  }

  // Validate user ID
  if (!userId) {
    errors.push({
      field: "userId",
      message: "User ID is required",
    });
  } else if (typeof userId !== "string") {
    errors.push({
      field: "userId",
      message: "User ID must be a string",
    });
  }

  // Validate session name (optional)
  if (sessionName && typeof sessionName !== "string") {
    errors.push({
      field: "sessionName",
      message: "Session name must be a string",
    });
  }

  if (errors.length > 0) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createValidationErrorResponse(
          "Session creation validation failed",
          errors
        )
      );
  }

  next();
};

/**
 * Bulk Message Validation Middleware
 * Validates bulk message parameters
 */
export const validateBulkMessage = (req, res, next) => {
  const { recipients, message, type = "text" } = req.body;
  const errors = [];

  // Validate recipients
  if (!recipients) {
    errors.push({
      field: "recipients",
      message: "Recipients array is required",
    });
  } else if (!Array.isArray(recipients)) {
    errors.push({
      field: "recipients",
      message: "Recipients must be an array",
    });
  } else if (recipients.length === 0) {
    errors.push({
      field: "recipients",
      message: "At least one recipient is required",
    });
  } else if (recipients.length > VALIDATION.BULK_MESSAGE.MAX_RECIPIENTS) {
    errors.push({
      field: "recipients",
      message: `Maximum ${VALIDATION.BULK_MESSAGE.MAX_RECIPIENTS} recipients allowed per bulk message`,
    });
  } else {
    // Validate each recipient
    recipients.forEach((recipient, index) => {
      if (typeof recipient !== "string") {
        errors.push({
          field: `recipients[${index}]`,
          message: "Each recipient must be a string",
        });
      } else if (!Utils.isValidPhoneNumber(recipient)) {
        errors.push({
          field: `recipients[${index}]`,
          message: "Invalid phone number format",
        });
      }
    });
  }

  // Validate message content
  if (!message) {
    errors.push({
      field: "message",
      message: "Message content is required",
    });
  } else if (typeof message !== "string") {
    errors.push({
      field: "message",
      message: "Message content must be a string",
    });
  } else if (message.length > VALIDATION.MESSAGE.MAX_LENGTH) {
    errors.push({
      field: "message",
      message: `Message content cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
    });
  }

  if (errors.length > 0) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createValidationErrorResponse(
          "Bulk message validation failed",
          errors
        )
      );
  }

  // Normalize phone numbers
  req.body.recipients = recipients.map((recipient) =>
    Utils.formatWhatsAppId(recipient)
  );

  next();
};

/**
 * File Upload Validation Middleware
 * Validates uploaded files
 */
export const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const errors = [];
  const file = req.file;

  // Validate file size (already handled by multer, but double-check)
  const maxSize = FILE_UPLOAD.MAX_SIZE;
  if (file.size > maxSize) {
    errors.push({
      field: "file",
      message: `File size cannot exceed ${Utils.formatBytes(maxSize)}`,
    });
  }

  // Validate file type
  const allowedTypes = FILE_UPLOAD.ALLOWED_TYPES;

  if (!allowedTypes.includes(file.mimetype)) {
    errors.push({
      field: "file",
      message: `File type ${file.mimetype} not allowed. Allowed types: ${allowedTypes.join(", ")}`,
    });
  }

  // Validate filename
  if (file.originalname && !REGEX.FILENAME.test(file.originalname)) {
    errors.push({
      field: "file",
      message: "Filename contains invalid characters",
    });
  }

  if (errors.length > 0) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createValidationErrorResponse(
          "File validation failed",
          errors
        )
      );
  }

  next();
};

/**
 * Pagination Validation Middleware
 * Validates pagination parameters
 */
export const validatePagination = (req, res, next) => {
  const { page = 1, limit = 50, offset } = req.query;
  const errors = [];

  // Validate page
  const pageNum = parseInt(page);
  if (isNaN(pageNum) || pageNum < 1) {
    errors.push({
      field: "page",
      message: "Page must be a positive integer",
    });
  } else if (pageNum > VALIDATION.PAGINATION.MAX_PAGE) {
    errors.push({
      field: "page",
      message: `Page cannot exceed ${VALIDATION.PAGINATION.MAX_PAGE}`,
    });
  }

  // Validate limit
  const limitNum = parseInt(limit);
  if (isNaN(limitNum) || limitNum < 1) {
    errors.push({
      field: "limit",
      message: "Limit must be a positive integer",
    });
  } else if (limitNum > VALIDATION.PAGINATION.MAX_LIMIT) {
    errors.push({
      field: "limit",
      message: `Limit cannot exceed ${VALIDATION.PAGINATION.MAX_LIMIT}`,
    });
  }

  // Validate offset (if provided)
  if (offset !== undefined) {
    const offsetNum = parseInt(offset);
    if (isNaN(offsetNum) || offsetNum < 0) {
      errors.push({
        field: "offset",
        message: "Offset must be a non-negative integer",
      });
    }
  }

  if (errors.length > 0) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(
        ApiResponse.createValidationErrorResponse(
          "Pagination validation failed",
          errors
        )
      );
  }

  // Set validated values
  req.pagination = {
    page: pageNum,
    limit: limitNum,
    offset: offset !== undefined ? parseInt(offset) : (pageNum - 1) * limitNum,
  };

  next();
};

/**
 * Request Body Size Validation Middleware
 * Validates request body size
 */
export const validateRequestSize = (req, res, next) => {
  const contentLength = req.get("content-length");
  const maxSize = FILE_UPLOAD.MAX_REQUEST_SIZE;

  if (contentLength && parseInt(contentLength) > maxSize) {
    logger.warn("Request body too large", {
      contentLength,
      maxSize,
      ip: req.ip,
      path: req.path,
    });

    return res
      .status(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      .json(
        ApiResponse.createErrorResponse(
          "Request body too large",
          ERROR_CODES.PAYLOAD_TOO_LARGE
        )
      );
  }

  next();
};

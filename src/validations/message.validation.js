import Joi from "joi";
import { MESSAGE_TYPES, VALIDATION, PAGINATION } from "../utils/constants.js";

// Phone number validation schema
const phoneNumberSchema = Joi.string()
  .pattern(/^(\+?62|62|0)?[8][0-9]{8,11}$|^[0-9]{10,15}@s\.whatsapp\.net$/)
  .required()
  .messages({
    "string.pattern.base":
      "Invalid phone number format. Supported formats: +6287733760363, 087733760363, 87733760363, or 6287733760363@s.whatsapp.net",
    "any.required": "Phone number is required",
  });

// Session ID validation schema
const sessionIdSchema = Joi.string()
  .min(VALIDATION.SESSION_ID.MIN_LENGTH)
  .pattern(/^[a-zA-Z0-9_-]+$/)
  .required()
  .messages({
    "string.min": `Session ID must be at least ${VALIDATION.SESSION_ID.MIN_LENGTH} characters`,
    "string.pattern.base":
      "Session ID can only contain letters, numbers, hyphens, and underscores",
    "any.required": "Session ID is required",
  });

// Message type validation schema
const messageTypeSchema = Joi.string()
  .valid(...Object.values(MESSAGE_TYPES))
  .required()
  .messages({
    "any.only": `Message type must be one of: ${Object.values(MESSAGE_TYPES).join(", ")}`,
    "any.required": "Message type is required",
  });

// Text message content validation schema
const textMessageSchema = Joi.string()
  .max(VALIDATION.MESSAGE.MAX_LENGTH)
  .required()
  .messages({
    "string.max": `Message content cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
    "any.required": "Message content is required for text messages",
  });

// Media URL validation schema
const mediaUrlSchema = Joi.string().uri().required().messages({
  "string.uri": "Media URL must be a valid URL",
  "any.required": "Media URL is required for media messages",
});

// Caption validation schema (optional)
const captionSchema = Joi.string()
  .max(VALIDATION.MESSAGE.MAX_LENGTH)
  .optional()
  .messages({
    "string.max": `Caption cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
  });

// Location validation schema
const locationSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required().messages({
    "number.base": "Latitude must be a number",
    "number.min": "Latitude must be between -90 and 90",
    "number.max": "Latitude must be between -90 and 90",
    "any.required": "Latitude is required",
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    "number.base": "Longitude must be a number",
    "number.min": "Longitude must be between -180 and 180",
    "number.max": "Longitude must be between -180 and 180",
    "any.required": "Longitude is required",
  }),
  name: Joi.string().max(100).optional().messages({
    "string.max": "Location name cannot exceed 100 characters",
  }),
  address: Joi.string().max(200).optional().messages({
    "string.max": "Location address cannot exceed 200 characters",
  }),
});

// Contact validation schema
const contactSchema = Joi.object({
  name: Joi.string().max(100).required().messages({
    "string.max": "Contact name cannot exceed 100 characters",
    "any.required": "Contact name is required",
  }),
  phone: phoneNumberSchema,
  email: Joi.string().email().optional().messages({
    "string.email": "Contact email must be a valid email address",
  }),
  organization: Joi.string().max(100).optional().messages({
    "string.max": "Contact organization cannot exceed 100 characters",
  }),
});

// Filename validation schema
const filenameSchema = Joi.string().max(255).required().messages({
  "string.max": "Filename cannot exceed 255 characters",
  "any.required": "Filename is required for document messages",
});

// Send message validation schema
export const sendMessageSchema = Joi.object({
  to: phoneNumberSchema,
  type: messageTypeSchema,

  // Text message fields
  message: Joi.when("type", {
    is: MESSAGE_TYPES.TEXT,
    then: textMessageSchema,
    otherwise: Joi.optional(),
  }),

  // Media message fields (image, document, video, audio)
  mediaUrl: Joi.when("type", {
    is: Joi.valid(
      MESSAGE_TYPES.IMAGE,
      MESSAGE_TYPES.DOCUMENT,
      MESSAGE_TYPES.VIDEO,
      MESSAGE_TYPES.AUDIO
    ),
    then: mediaUrlSchema,
    otherwise: Joi.optional(),
  }),

  // Document-specific fields
  filename: Joi.when("type", {
    is: MESSAGE_TYPES.DOCUMENT,
    then: filenameSchema,
    otherwise: Joi.optional(),
  }),

  // Caption for media messages
  caption: Joi.when("type", {
    is: Joi.valid(
      MESSAGE_TYPES.IMAGE,
      MESSAGE_TYPES.DOCUMENT,
      MESSAGE_TYPES.VIDEO
    ),
    then: captionSchema,
    otherwise: Joi.optional(),
  }),

  // Location message fields
  location: Joi.when("type", {
    is: MESSAGE_TYPES.LOCATION,
    then: locationSchema.required(),
    otherwise: Joi.optional(),
  }),

  // Contact message fields
  contact: Joi.when("type", {
    is: MESSAGE_TYPES.CONTACT,
    then: contactSchema.required(),
    otherwise: Joi.optional(),
  }),

  // Human simulation control
  humanSimulation: Joi.boolean().optional().default(true).messages({
    "boolean.base": "humanSimulation must be a boolean value",
  }),
}).messages({
  "object.unknown": "Unknown field: {#label}",
});

// Session ID parameter validation schema
export const sessionIdParamSchema = Joi.object({
  sessionId: sessionIdSchema,
});

// Message history query validation schema
export const messageHistoryQuerySchema = Joi.object({
  contact: phoneNumberSchema.optional(),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(50)
    .messages({
      "number.base": "Limit must be a number",
      "number.integer": "Limit must be an integer",
      "number.min": "Limit must be at least 1",
      "number.max": `Limit cannot exceed ${PAGINATION.MAX_LIMIT}`,
    }),
  offset: Joi.number().integer().min(0).default(0).messages({
    "number.base": "Offset must be a number",
    "number.integer": "Offset must be an integer",
    "number.min": "Offset must be at least 0",
  }),
  startDate: Joi.date().iso().optional().messages({
    "date.format": "Start date must be in ISO format",
  }),
  endDate: Joi.date().iso().optional().messages({
    "date.format": "End date must be in ISO format",
  }),
  type: Joi.string()
    .valid(...Object.values(MESSAGE_TYPES))
    .optional()
    .messages({
      "any.only": `Message type must be one of: ${Object.values(MESSAGE_TYPES).join(", ")}`,
    }),
});

// Message stats query validation schema
export const messageStatsQuerySchema = Joi.object({
  period: Joi.string().valid("1h", "24h", "7d", "30d").default("24h").messages({
    "any.only": "Period must be one of: 1h, 24h, 7d, 30d",
  }),
});

// Send seen validation schema
export const sendSeenSchema = Joi.object({
  to: phoneNumberSchema,
  messageId: Joi.string().required().messages({
    "any.required": "Message ID is required",
    "string.base": "Message ID must be a string",
  }),
});

// Start/Stop typing validation schema
export const typingSchema = Joi.object({
  to: phoneNumberSchema,
});

// Validation middleware functions
export const validateSendMessage = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const bodyValidation = sendMessageSchema.validate(req.body);
  if (bodyValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: bodyValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.body = bodyValidation.value;
  next();
};

export const validateMessageHistory = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const queryValidation = messageHistoryQuerySchema.validate(req.query);
  if (queryValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: queryValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.query = queryValidation.value;
  next();
};

export const validateSendSeen = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const bodyValidation = sendSeenSchema.validate(req.body);
  if (bodyValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: bodyValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.body = bodyValidation.value;
  next();
};

export const validateStartTyping = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const bodyValidation = typingSchema.validate(req.body);
  if (bodyValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: bodyValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.body = bodyValidation.value;
  next();
};

export const validateStopTyping = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const bodyValidation = typingSchema.validate(req.body);
  if (bodyValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: bodyValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.body = bodyValidation.value;
  next();
};

export const validateMessageStats = (req, res, next) => {
  const paramsValidation = sessionIdParamSchema.validate(req.params);
  if (paramsValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: paramsValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  const queryValidation = messageStatsQuerySchema.validate(req.query);
  if (queryValidation.error) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: queryValidation.error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  req.params = paramsValidation.value;
  req.query = queryValidation.value;
  next();
};

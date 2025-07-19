import Joi from "joi";
import {
  MESSAGE_TYPES,
  MESSAGE_ACTIONS,
  VALIDATION,
  PAGINATION,
} from "../utils/constants.js";

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

// Contact validation schemas for individual fields
const contactNameSchema = Joi.string().max(100).required().messages({
  "string.max": "Contact name cannot exceed 100 characters",
  "any.required": "contactName is required",
});

const contactPhoneSchema = Joi.string().required().messages({
  "any.required": "contactPhone is required",
});

const contactEmailSchema = Joi.string().email().optional().messages({
  "string.email": "Contact email must be a valid email address",
});

const contactOrganizationSchema = Joi.string().max(100).optional().messages({
  "string.max": "Contact organization cannot exceed 100 characters",
});

// Link validation schema - simplified structure
const linkUrlSchema = Joi.string().uri().required().messages({
  "string.uri": "Link URL must be a valid URL",
  "any.required": "Link URL is required",
});

const linkCaptionSchema = Joi.string()
  .max(VALIDATION.MESSAGE.MAX_LENGTH)
  .optional()
  .messages({
    "string.max": `Link caption cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
  });

// Poll validation schema - simplified structure
const pollQuestionSchema = Joi.string().max(255).required().messages({
  "string.max": "Poll question cannot exceed 255 characters",
  "any.required": "Poll question is required",
});

const pollOptionsSchema = Joi.array()
  .items(Joi.string().max(100))
  .min(2)
  .max(12)
  .required()
  .messages({
    "array.min": "Poll must have at least 2 options",
    "array.max": "Poll cannot have more than 12 options",
    "string.max": "Poll option cannot exceed 100 characters",
    "any.required": "Poll options are required",
  });

const pollMaxAnswerSchema = Joi.number()
  .integer()
  .min(1)
  .max(12)
  .optional()
  .default(1)
  .messages({
    "number.base": "Max answer must be a number",
    "number.integer": "Max answer must be an integer",
    "number.min": "Max answer must be at least 1",
    "number.max": "Max answer cannot exceed 12",
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

  // Caption for media messages only (not for links)
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
  // Contact message fields (flattened)
  contactName: Joi.when("type", {
    is: MESSAGE_TYPES.CONTACT,
    then: contactNameSchema,
    otherwise: Joi.optional(),
  }),

  contactPhone: Joi.when("type", {
    is: MESSAGE_TYPES.CONTACT,
    then: contactPhoneSchema,
    otherwise: Joi.optional(),
  }),

  contactEmail: Joi.when("type", {
    is: MESSAGE_TYPES.CONTACT,
    then: contactEmailSchema,
    otherwise: Joi.optional(),
  }),

  contactOrganization: Joi.when("type", {
    is: MESSAGE_TYPES.CONTACT,
    then: contactOrganizationSchema,
    otherwise: Joi.optional(),
  }),

  // Link message fields - only support url and text format
  url: Joi.when("type", {
    is: MESSAGE_TYPES.LINK,
    then: linkUrlSchema,
    otherwise: Joi.optional(),
  }),

  text: Joi.when("type", {
    is: MESSAGE_TYPES.LINK,
    then: linkCaptionSchema,
    otherwise: Joi.optional(),
  }),

  // Poll message fields - simplified structure
  question: Joi.when("type", {
    is: MESSAGE_TYPES.POLL,
    then: pollQuestionSchema,
    otherwise: Joi.optional(),
  }),

  options: Joi.when("type", {
    is: MESSAGE_TYPES.POLL,
    then: pollOptionsSchema,
    otherwise: Joi.optional(),
  }),

  maxAnswer: Joi.when("type", {
    is: MESSAGE_TYPES.POLL,
    then: pollMaxAnswerSchema,
    otherwise: Joi.optional(),
  }),

  // Message ID for seen receipts
  messageId: Joi.when("type", {
    is: MESSAGE_TYPES.SEEN,
    then: Joi.string().required().messages({
      "any.required": "Message ID is required for seen receipts",
      "string.base": "Message ID must be a string",
    }),
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

// Message management validation schema
export const messageManagementSchema = Joi.object({
  action: Joi.string()
    .valid(...Object.values(MESSAGE_ACTIONS))
    .required()
    .messages({
      "any.only": `Action must be one of: ${Object.values(MESSAGE_ACTIONS).join(", ")}`,
      "any.required": "Action is required",
    }),

  // Phone number - required for all actions (recipient of the message)
  phone: phoneNumberSchema.messages({
    "string.pattern.base":
      "Invalid phone number format. Example: 6285187002626",
    "any.required": "Phone number is required (recipient of the message)",
  }),

  // Message ID - required for most actions
  messageId: Joi.when("action", {
    is: Joi.valid(
      MESSAGE_ACTIONS.DELETE,
      MESSAGE_ACTIONS.UNSEND,
      MESSAGE_ACTIONS.STAR,
      MESSAGE_ACTIONS.UNSTAR,
      MESSAGE_ACTIONS.EDIT,
      MESSAGE_ACTIONS.REACTION,
      MESSAGE_ACTIONS.PIN,
      MESSAGE_ACTIONS.UNPIN
    ),
    then: Joi.string().required().messages({
      "any.required": "Message ID is required for this action",
      "string.base": "Message ID must be a string",
    }),
    otherwise: Joi.optional(),
  }),

  // Content for edit action
  content: Joi.when("action", {
    is: MESSAGE_ACTIONS.EDIT,
    then: Joi.string()
      .max(VALIDATION.MESSAGE.MAX_LENGTH)
      .required()
      .messages({
        "string.max": `Content cannot exceed ${VALIDATION.MESSAGE.MAX_LENGTH} characters`,
        "any.required": "Content is required for edit action",
      }),
    otherwise: Joi.optional(),
  }),

  // Reaction emoji for reaction action
  emoji: Joi.when("action", {
    is: MESSAGE_ACTIONS.REACTION,
    then: Joi.string()
      .pattern(
        /^[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]$/u
      )
      .required()
      .messages({
        "string.pattern.base": "Invalid emoji format",
        "any.required": "Emoji is required for reaction action",
      }),
    otherwise: Joi.optional(),
  }),

  // For everyone flag for delete action
  forEveryone: Joi.when("action", {
    is: MESSAGE_ACTIONS.DELETE,
    then: Joi.boolean().optional().default(false).messages({
      "boolean.base": "forEveryone must be a boolean value",
    }),
    otherwise: Joi.optional(),
  }),
}).messages({
  "object.unknown": "Unknown field: {#label}",
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

export const validateMessageManagement = (req, res, next) => {
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

  const bodyValidation = messageManagementSchema.validate(req.body);
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

// User management validation schema
export const userManagementSchema = Joi.object({
  type: Joi.string().valid("info").required().messages({
    "any.only": "Type must be one of: info",
    "any.required": "Type is required",
  }),
}).messages({
  "object.unknown": "Unknown field: {#label}",
});

// User management validation middleware
export const validateUserManagement = (req, res, next) => {
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

  const bodyValidation = userManagementSchema.validate(req.body);
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

import { HTTP_STATUS, ERROR_CODES, REGEX, VALIDATION } from "./constants.js";

class ApiResponse {
  /**
   * Create standardized API response
   * @param {boolean} success - Success status
   * @param {object} data - Response data
   * @param {object} meta - Response metadata
   * @returns {object} - Standardized response
   */
  static createResponse(success, data = null, meta = {}) {
    const response = {
      success,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    if (success) {
      response.data = data;
    } else {
      response.error = data;
    }

    return response;
  }

  /**
   * Create error response
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {object} details - Error details
   * @returns {object} - Error response
   */
  static createErrorResponse(code, message, details = {}) {
    return this.createResponse(false, {
      code,
      message,
      details,
    });
  }

  /**
   * Create success response
   * @param {object} data - Response data
   * @param {object} meta - Response metadata
   * @returns {object} - Success response
   */
  static createSuccessResponse(data = null, meta = {}) {
    return this.createResponse(true, data, meta);
  }

  /**
   * Create paginated response
   * @param {Array} items - Array of items
   * @param {number} total - Total count
   * @param {number} page - Current page
   * @param {number} limit - Items per page
   * @param {object} additionalData - Additional data to include
   * @returns {object} - Paginated response
   */
  static createPaginatedResponse(
    items,
    total,
    page,
    limit,
    additionalData = {}
  ) {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return this.createSuccessResponse(
      {
        items,
        ...additionalData,
      },
      {
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasNext,
          hasPrev,
        },
      }
    );
  }

  /**
   * Create validation error response
   * @param {Array} errors - Validation errors
   * @returns {object} - Validation error response
   */
  static createValidationErrorResponse(message, errors) {
    return this.createErrorResponse(ERROR_CODES.VALIDATION_FAILED, message, {
      errors,
    });
  }

  /**
   * Create not found error response
   * @param {string} resource - Resource name
   * @returns {object} - Not found error response
   */
  static createNotFoundResponse(resource = "Resource") {
    return this.createErrorResponse("NOT_FOUND", `${resource} not found`);
  }

  /**
   * Create unauthorized error response
   * @returns {object} - Unauthorized error response
   */
  static createUnauthorizedResponse() {
    return this.createErrorResponse("UNAUTHORIZED", "Authentication required");
  }

  /**
   * Create forbidden error response
   * @returns {object} - Forbidden error response
   */
  static createForbiddenResponse() {
    return this.createErrorResponse("FORBIDDEN", "Access denied");
  }

  /**
   * Create rate limit error response
   * @returns {object} - Rate limit error response
   */
  static createRateLimitResponse() {
    return this.createErrorResponse(
      "RATE_LIMIT_EXCEEDED",
      "Too many requests, please try again later"
    );
  }

  /**
   * Create internal server error response
   * @param {string} message - Error message
   * @returns {object} - Internal server error response
   */
  static createInternalErrorResponse(message = "Internal server error") {
    return this.createErrorResponse("INTERNAL_ERROR", message);
  }
}

/**
 * Utility functions for common operations
 */
class Utils {
  /**
   * Generate unique session ID
   * @param {string} userId - User ID
   * @returns {string} - Unique session ID
   */
  static generateSessionId(userId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${userId}-${timestamp}-${random}`;
  }

  /**
   * Generate worker ID
   * @returns {string} - Unique worker ID
   */
  static generateWorkerId() {
    const hostname = process.env.HOSTNAME || "worker";
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    return `${hostname}-${timestamp}-${random}`;
  }

  /**
   * Format phone number for WhatsApp
   * @param {string} phoneNumber - Phone number in any format
   * @returns {string} - Formatted WhatsApp ID (number@s.whatsapp.net)
   */
  static formatWhatsAppId(phoneNumber) {
    // If already in WhatsApp format, return as is
    if (phoneNumber.includes("@s.whatsapp.net")) {
      return phoneNumber;
    }

    // Remove all non-numeric characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, "");

    // Handle different input formats
    if (cleaned.startsWith("+")) {
      // International format: +6287733760363 -> 6287733760363
      cleaned = cleaned.substring(1);
    } else if (cleaned.startsWith("0")) {
      // Local format: 087733760363 -> 6287733760363 (assuming Indonesian)
      cleaned = "62" + cleaned.substring(1);
    } else if (cleaned.length >= 10 && !cleaned.startsWith("62")) {
      // Assume it's a local number without leading 0: 87733760363 -> 6287733760363
      cleaned = "62" + cleaned;
    }

    // Ensure we have at least a valid length (minimum 10 digits after country code)
    if (cleaned.length < 10) {
      throw new Error("Invalid phone number: too short");
    }

    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Validate phone number format (accepts any reasonable phone number format)
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} - Is valid phone number
   */
  static isValidPhoneNumber(phoneNumber) {
    // If already in WhatsApp format, validate the number part
    if (phoneNumber.includes("@s.whatsapp.net")) {
      const numberPart = phoneNumber.split("@")[0];
      return /^\d{10,15}$/.test(numberPart);
    }

    // Remove all non-numeric characters except +
    const cleaned = phoneNumber.replace(/[^\d+]/g, "");

    // Check various formats:
    // International: +1234567890 to +123456789012345
    // Local with country code: 1234567890 to 123456789012345
    // Local format: 0123456789 to 012345678901234
    const phoneRegex = /^(\+?\d{10,15}|0\d{9,14})$/;

    return phoneRegex.test(cleaned) && cleaned.length >= 10;
  }

  /**
   * Get file extension from filename
   * @param {string} filename - Filename
   * @returns {string} - File extension
   */
  static getFileExtension(filename) {
    return filename.split(".").pop().toLowerCase();
  }

  /**
   * Get MIME type from file extension
   * @param {string} extension - File extension
   * @returns {string} - MIME type
   */
  static getMimeType(extension) {
    const mimeTypes = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      wav: "audio/wav",
      txt: "text/plain",
    };

    return mimeTypes[extension] || "application/octet-stream";
  }

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Bytes
   * @param {number} decimals - Decimal places
   * @returns {string} - Formatted size
   */
  static formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after sleep
   */
  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retry function with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise} - Promise that resolves with function result
   */
  static async retry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (i === maxRetries) {
          throw lastError;
        }

        const delay = baseDelay * Math.pow(2, i);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Sanitize filename for storage
   * @param {string} filename - Original filename
   * @returns {string} - Sanitized filename
   */
  static sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  /**
   * Generate random string
   * @param {number} length - String length
   * @returns {string} - Random string
   */
  static generateRandomString(length = 8) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }
}

export { ApiResponse, Utils };

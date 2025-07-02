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
}

module.exports = ApiResponse;

import { Router } from "express";
import userController from "../controllers/user.controller.js";
import { validateUserManagement } from "../validations/message.validation.js";

const router = Router();

/**
 * @route POST /api/user/:sessionId/manage
 * @desc Unified user management endpoint for WhatsApp sessions
 * @access Private
 * @param {string} sessionId - The session ID
 * @param {string} type - The type of operation to perform
 * @returns {Object} Response based on the type of operation
 *
 * @example
 * POST /api/user/user123-session1/manage
 * Content-Type: application/json
 *
 * Request Body (Get User Info):
 * {
 *   "type": "info"
 * }
 *
 * Response (User Info):
 * {
 *   "success": true,
 *   "data": {
 *     "sessionId": "user123-session1",
 *     "userInfo": {
 *       "phoneNumber": "6281234567890@s.whatsapp.net",
 *       "displayName": "John Doe",
 *       "profilePicture": "https://pps.whatsapp.net/v/t61.24694-24/...",
 *       "statusMessage": "Hey there! I am using WhatsApp.",
 *       "businessProfile": {
 *         "businessId": "123456789",
 *         "businessName": "John's Store",
 *         "businessCategory": "Retail",
 *         "businessDescription": "We sell amazing products",
 *         "businessEmail": "contact@johnsstore.com",
 *         "businessWebsite": "https://johnsstore.com",
 *         "businessAddress": "123 Main St, City"
 *       }
 *     },
 *     "sessionStatus": "connected",
 *     "connectedAt": "2024-01-15T10:30:00Z",
 *     "lastSeen": "2024-01-15T10:35:00Z"
 *   }
 * }
 *
 * Error Response:
 * {
 *   "success": false,
 *   "error": "Session not found or not connected"
 * }
 *
 * Supported Types:
 * - "info": Get comprehensive user information
 * - Future types can be added for other user management operations
 */
router.post(
  "/:sessionId/manage",
  validateUserManagement,
  userController.manageUser
);

export default router;

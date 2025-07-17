# WhatsApp Gateway Worker - API Endpoints

## Session Management Endpoints

1. **POST /api/sessions/start** → Create and start a new WhatsApp session
2. **GET /api/sessions/{sessionId}/status** → Get current status of a specific session
3. **DELETE /api/sessions/{sessionId}** → Delete and cleanup a specific session
4. **POST /api/sessions/{sessionId}/restart** → Restart an existing session
5. **POST /api/sessions/{sessionId}/disconnect** → Disconnect session but keep it available for reconnection
6. **POST /api/sessions/{sessionId}/logout** → Logout from WhatsApp and invalidate session credentials
7. **GET /api/sessions** → Get list of all sessions managed by this worker

## Message Operations Endpoints

8. **POST /api/{sessionId}/send** → Send message from specific session (supports all message types: text, image, document, video, audio, location, contact, link, poll, seen, typing_start, typing_stop) with optional human-like behavior simulation

9. **POST /api/message/{sessionId}/manage** → Manage messages with action-based operations
   - **Action: delete** → Delete message (for me or for everyone)
   - **Action: unsend** → Unsend message (delete for everyone)
   - **Action: star** → Star a message
   - **Action: unstar** → Unstar a message
   - **Action: edit** → Edit message text
   - **Action: reaction** → Add reaction to message
   - **Action: read** → Mark message as read

10. **GET /api/messages/{sessionId}/stats** → Get message statistics for a specific session

## Message Type Examples (for /api/{sessionId}/send)

- **Text Message**: `{"to": "6281234567890", "type": "text", "message": "Hello World"}`
- **Image Message**: `{"to": "6281234567890", "type": "image", "caption": "Photo", "media": [file]}`
- **Document Message**: `{"to": "6281234567890", "type": "document", "filename": "file.pdf", "media": [file]}`
- **Video Message**: `{"to": "6281234567890", "type": "video", "caption": "Video", "media": [file]}`
- **Audio Message**: `{"to": "6281234567890", "type": "audio", "media": [file]}`
- **Location Message**: `{"to": "6281234567890", "type": "location", "latitude": -6.2, "longitude": 106.8}`
- **Contact Message**: `{"to": "6281234567890", "type": "contact", "contact": {...}}`
- **Link Message**: `{"to": "6281234567890", "type": "link", "url": "https://example.com", "title": "Title"}`
- **Poll Message**: `{"to": "6281234567890", "type": "poll", "name": "Question", "options": ["A", "B"]}`
- **Read Receipt**: `{"to": "6281234567890", "type": "seen", "messageKey": {...}}`
- **Typing Start**: `{"to": "6281234567890", "type": "typing_start"}`
- **Typing Stop**: `{"to": "6281234567890", "type": "typing_stop"}`

## Message Management Examples (for /api/message/{sessionId}/manage)

- **Delete Message**: `{"action": "delete", "messageId": "msg123", "phone": "6285187002626", "forEveryone": true}`
- **Unsend Message**: `{"action": "unsend", "messageId": "msg123", "phone": "6285187002626"}`
- **Star Message**: `{"action": "star", "messageId": "msg123", "phone": "6285187002626"}`
- **Unstar Message**: `{"action": "unstar", "messageId": "msg123", "phone": "6285187002626"}`
- **Edit Message**: `{"action": "edit", "messageId": "msg123", "phone": "6285187002626", "newText": "Updated text"}`
- **React to Message**: `{"action": "reaction", "messageId": "msg123", "phone": "6285187002626", "emoji": "👍"}`
- **Mark as Read**: `{"action": "read", "jid": "6281234567890@s.whatsapp.net", "messageKey": {...}}`

## Health & Monitoring Endpoints

11. **GET /health** → Basic health status of the worker
12. **GET /metrics** → Detailed performance metrics and statistics
13. **GET /ready** → Kubernetes readiness probe endpoint
14. **GET /live** → Kubernetes liveness probe endpoint
15. **GET /health/services** → Status of all connected services (database, redis, storage, etc.)

## API Architecture Notes

### Controller Structure

- **send.controller.js** → Handles all message sending operations (`POST /api/{sessionId}/send`)
- **message.controller.js** → Handles message management operations (`POST /api/message/{sessionId}/manage`) and statistics (`GET /api/messages/{sessionId}/stats`)
- **session.controller.js** → Handles all session management operations
- **health.controller.js** → Handles all health and monitoring endpoints

### Baileys Service Architecture

The Baileys service has been modularized into focused components:

- **session-management.service.js** → Session CRUD operations, status management
- **connection-handlers.service.js** → WhatsApp connection event handling, QR management
- **message-sending.service.js** → All message sending operations with human simulation
- **message-management.service.js** → Message management operations (delete, edit, react, star)
- **recovery.service.js** → Session recovery, storage management, health monitoring

### Message Action Constants

All message management actions use standardized constants:

- `MESSAGE_ACTIONS.DELETE` → "delete"
- `MESSAGE_ACTIONS.UNSEND` → "unsend"
- `MESSAGE_ACTIONS.STAR` → "star"
- `MESSAGE_ACTIONS.UNSTAR` → "unstar"
- `MESSAGE_ACTIONS.EDIT` → "edit"
- `MESSAGE_ACTIONS.REACTION` → "reaction"
- `MESSAGE_ACTIONS.READ` → "read"

### Human Behavior Simulation

The send endpoint includes optional human-like behavior simulation:

- Random typing delays (1-3 seconds)
- Typing indicators before sending
- Read receipts for received messages
- Natural response timing patterns

### Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {...}
}
```

### Success Responses

All endpoints return standardized success responses:

```json
{
  "success": true,
  "data": {...},
  "message": "Operation completed successfully"
}
```

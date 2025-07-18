1. POST /api/sessions/start --> Create and start a new WhatsApp session
2. GET /api/sessions/{sessionId}/status --> Get current status of a specific session
3. DELETE /api/sessions/{sessionId} --> Delete and cleanup a specific session
4. POST /api/sessions/{sessionId}/restart --> Restart an existing session
5. POST /api/sessions/{sessionId}/disconnect --> Disconnect session but keep it available for reconnection
6. POST /api/sessions/{sessionId}/logout --> Logout from WhatsApp and invalidate session credentials
7. GET /api/sessions --> Get list of all sessions managed by this worker
8. POST /api/{sessionId}/send --> Unified send endpoint supporting all message types and actions:
   - Message types: text, image, document, video, audio, location, contact, link, poll
   - Action types: seen (read receipts), typing_start, typing_stop
   - Optional human-like behavior simulation for all message types
9. POST /api/messages/{sessionId}/manage --> Message management endpoint supporting:
   - Actions: delete, unsend, star, unstar, edit, reaction, read, pin, unpin
   - Requires phone number field for recipient identification
   - Supports WhatsApp native message manipulation features
10. GET /api/messages/{sessionId}/stats --> Get message statistics for a specific session
11. GET /health --> Basic health status of the worker
12. GET /metrics --> Detailed performance metrics and statistics
13. GET /ready --> Kubernetes readiness probe endpoint
14. GET /live --> Kubernetes liveness probe endpoint
15. GET /health/services --> Status of all connected services (database, redis, storage, etc.)

## Message Type Examples (for /api/{sessionId}/send)

- **Text Message**: `{"to": "6281234567890", "type": "text", "message": "Hello World"}`
- **Image Message**: `{"to": "6281234567890", "type": "image", "mediaUrl": "https://example.com/image.jpg", "caption": "Photo"}`
- **Document Message**: `{"to": "6281234567890", "type": "document", "mediaUrl": "https://example.com/file.pdf", "filename": "file.pdf", "caption": "Document"}`
- **Video Message**: `{"to": "6281234567890", "type": "video", "mediaUrl": "https://example.com/video.mp4", "caption": "Video"}`
- **Audio Message**: `{"to": "6281234567890", "type": "audio", "mediaUrl": "https://example.com/audio.mp3"}`
- **Location Message**: `{"to": "6281234567890", "type": "location", "location": {"latitude": -6.2, "longitude": 106.8, "name": "Jakarta", "address": "Jakarta, Indonesia"}}`
- **Contact Message**: `{"to": "6281234567890", "type": "contact", "contact": {"name": "John Doe", "phone": "6281234567890", "email": "john@example.com", "organization": "Company"}}`
- **Link Message**: `{"to": "6281234567890", "type": "link", "url": "https://google.com", "text": "Check this out!"}`
- **Poll Message**: `{"to": "6281234567890", "type": "poll", "question": "What's your favorite color?", "options": ["Red", "Blue", "Green"], "maxAnswer": 1}`
- **Read Receipt**: `{"to": "6281234567890", "type": "seen", "messageId": "message_id_here"}`
- **Typing Start**: `{"to": "6281234567890", "type": "typing_start"}`
- **Typing Stop**: `{"to": "6281234567890", "type": "typing_stop"}`

## Message Management Examples (for /api/messages/{sessionId}/manage)

- **Delete Message**: `{"action": "delete", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Delete Message for Everyone**: `{"action": "delete", "phone": "6285187002626", "messageId": "message_id_here", "forEveryone": true}`
- **Unsend Message**: `{"action": "unsend", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Star Message**: `{"action": "star", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Unstar Message**: `{"action": "unstar", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Edit Message**: `{"action": "edit", "phone": "6285187002626", "messageId": "message_id_here", "content": "New message content"}`
- **Send Reaction**: `{"action": "reaction", "phone": "6285187002626", "messageId": "message_id_here", "emoji": "👍"}`
- **Mark as Read**: `{"action": "read", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Pin Message**: `{"action": "pin", "phone": "6285187002626", "messageId": "message_id_here"}`
- **Unpin Message**: `{"action": "unpin", "phone": "6285187002626", "messageId": "message_id_here"}`

### Delete Message Implementation Fix (IMPORTANT)

**Issue Fixed:** The delete message functionality has been completely rewritten to use proper WhatsApp protocol.

**Previous Problem:**

- Messages were not actually being deleted from WhatsApp despite successful logs
- Wrong recipient JID (was sending to user's own JID instead of recipient)
- Missing `remoteJid` in message key structure
- Incorrect WhatsApp protocol implementation

**Current Solution:**

1. **For "Delete for Everyone" (forEveryone: true):**
   - Uses `protocolMessage` with type 0 (REVOKE)
   - Proper message key structure with `remoteJid`
   - Sends to the recipient's JID, not self

2. **For "Delete for Me" (forEveryone: false):**
   - Uses simple delete payload
   - Includes proper message key with `remoteJid`
   - Sends to the recipient's JID

**Technical Implementation:**

```javascript
// Message Key Structure
const messageKey = {
  id: messageId,
  remoteJid: phone, // Recipient's WhatsApp ID
  fromMe: true, // Only own messages can be deleted
};

// Protocol Message for Delete for Everyone
const deletePayload = {
  protocolMessage: {
    key: messageKey,
    type: 0, // REVOKE type
  },
};
```

**Response Format:**

```json
{
  "success": true,
  "data": {
    "action": "delete",
    "messageId": "3EB0C767D82A1E1D2F4E",
    "phone": "6285187002626@s.whatsapp.net",
    "result": {
      "success": true,
      "messageId": "3EB0C767D82A1E1D2F4E",
      "phone": "6285187002626@s.whatsapp.net",
      "status": "deleted_for_everyone",
      "forEveryone": true
    }
  }
}
```

### Additional Options:

- **Human Simulation**: Add `"humanSimulation": false` to disable human-like behavior (typing indicators, delays)
- **Delete for Everyone**: Add `"forEveryone": true` to delete message for everyone (uses proper REVOKE protocol)
- **Phone Number Formats**: Supports multiple formats: `+6281234567890`, `6281234567890`, `081234567890`, `81234567890`

### Important Notes:

1. Only your own messages can be deleted/edited
2. Messages can only be deleted within WhatsApp's time limit (usually 1 hour 8 minutes 16 seconds)
3. The `phone` field is required for all actions to specify the recipient
4. The `forEveryone` parameter only applies to the DELETE action
5. For group chats, use the group JID format: `groupid@g.us`
6. **FIXED:** Delete messages now actually work in WhatsApp due to proper protocol implementation

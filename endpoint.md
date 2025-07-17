1. POST /api/sessions/start --> Create and start a new WhatsApp session
2. GET /api/sessions/{sessionId}/status --> Get current status of a specific session
3. DELETE /api/sessions/{sessionId} --> Delete and cleanup a specific session
4. POST /api/sessions/{sessionId}/restart --> Restart an existing session
5. POST /api/sessions/{sessionId}/disconnect --> Disconnect session but keep it available for reconnection
6. POST /api/sessions/{sessionId}/logout --> Logout from WhatsApp and invalidate session credentials
7. GET /api/sessions --> Get list of all sessions managed by this worker
8. POST /api/sessions/{sessionId}/send --> Send message from specific session (supports all message types: text, image, document, video, audio, location, contact) with optional human-like behavior simulation
9. GET /api/messages/{sessionId}/history --> Get message history for a specific session with pagination
10. GET /api/messages/{sessionId}/stats --> Get message statistics for a specific session
11. POST /api/messages/{sessionId}/sendSeen --> Mark messages as read (send read receipts)
12. POST /api/messages/{sessionId}/startTyping --> Start typing indicator for a chat
13. POST /api/messages/{sessionId}/stopTyping --> Stop typing indicator for a chat
14. GET /health --> Basic health status of the worker
15. GET /metrics --> Detailed performance metrics and statistics
16. GET /ready --> Kubernetes readiness probe endpoint
17. GET /live --> Kubernetes liveness probe endpoint
18. GET /health/services --> Status of all connected services (database, redis, storage, etc.)

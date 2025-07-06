# Backend API Specification for WhatsApp Worker Integration

## Overview

This document specifies the exact API endpoints that your backend needs to implement for the WhatsApp Worker to integrate successfully. The worker is currently trying to register at `http://localhost:8000` and expects these endpoints to be available.

## Required Backend Endpoints

### 1. Worker Registration

**Endpoint:** `POST /api/v1/workers/register`

**Headers:**

```
Content-Type: application/json
Authorization: Bearer worker-secret-token-12345
```

**Request Body:**

```json
{
  "workerId": "worker-001",
  "endpoint": "http://localhost:8001",
  "maxSessions": 50,
  "description": "Primary worker instance",
  "status": "ONLINE",
  "version": "1.0.0",
  "environment": "PRODUCTION",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Status Values:**

- `ONLINE` - Worker is active and accepting sessions
- `OFFLINE` - Worker is not available
- `MAINTENANCE` - Worker is in maintenance mode

**Environment Values:**

- `DEVELOPMENT` - Local development environment
- `STAGING` - Pre-production testing environment
- `TESTING` - Automated testing environment
- `PRODUCTION` - Live production environment

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "workerId": "worker-001",
    "status": "registered",
    "assignedSessions": [],
    "message": "Worker registered successfully"
  }
}
```

### 2. Worker Heartbeat

**Endpoint:** `PUT /api/v1/workers/{workerId}/heartbeat`

**Headers:**

```
Content-Type: application/json
Authorization: Bearer worker-secret-token-12345
```

**Request Body:**

```json
{
  "status": "ONLINE",
  "cpuUsage": 45.5,
  "memoryUsage": 67.8,
  "uptime": 3600,
  "messageCount": 1250,
  "sessions": {
    "total": 25,
    "connected": 20,
    "disconnected": 2,
    "qr_required": 2,
    "reconnecting": 1,
    "error": 0
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "workerId": "worker-001",
    "status": "acknowledged",
    "commands": []
  }
}
```

### 3. Worker Events/Notifications

**Endpoint:** `POST /api/v1/workers/{workerId}/events`

**Note:** For session status updates, the worker will use webhook endpoints:

- `POST /api/v1/webhooks/session-status` (for QR codes, connection status)
- `POST /api/v1/webhooks/message-status` (for message delivery status)

**Headers:**

```
Content-Type: application/json
Authorization: Bearer worker-secret-token-12345
```

**Request Body:**

```json
{
  "event": "session_status_changed",
  "sessionId": "user123-session1",
  "workerId": "worker-001",
  "data": {
    "status": "connected",
    "phoneNumber": "+6281234567890",
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Event received"
}
```

### 4. Worker Unregistration

**Endpoint:** `DELETE /api/v1/workers/{workerId}`

**Headers:**

```
Authorization: Bearer worker-secret-token-12345
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Worker unregistered successfully"
}
```

### 5. Session Status Webhook

**Endpoint:** `POST /api/v1/webhooks/session-status`

**Headers:**

```
Content-Type: application/json
Authorization: Bearer worker-secret-token-12345
```

**Request Body:**

```json
{
  "event": "qr_ready",
  "sessionId": "user123-session1",
  "workerId": "worker-001",
  "data": {
    "status": "qr_required",
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "qrString": "1@ABC123XYZ..."
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Session status updated"
}
```

### 6. Message Status Webhook

**Endpoint:** `POST /api/v1/webhooks/message-status`

**Headers:**

```
Content-Type: application/json
Authorization: Bearer worker-secret-token-12345
```

**Request Body:**

```json
{
  "event": "message_status",
  "sessionId": "user123-session1",
  "workerId": "worker-001",
  "data": {
    "messageId": "msg_12345",
    "status": "delivered",
    "to": "6281234567890@s.whatsapp.net",
    "deliveredAt": "2024-01-15T10:30:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Message status updated"
}
```

## Event Types

The worker will send these event types to your backend:

### Session Events

- `session_created` - New session initialized
- `session_qr_ready` - QR code generated and ready
- `session_connected` - WhatsApp authentication successful
- `session_disconnected` - Session lost connection
- `session_deleted` - Session removed

### Message Events

- `message_sent` - Message sent successfully
- `message_received` - Incoming message
- `message_failed` - Message delivery failed

### Worker Events

- `worker_started` - Worker service started
- `worker_stopping` - Worker service shutting down
- `worker_error` - Worker encountered error

## Database Schema Recommendations

### Workers Table

```sql
CREATE TABLE workers (
  id VARCHAR PRIMARY KEY,
  endpoint VARCHAR UNIQUE NOT NULL,
  description VARCHAR,
  status VARCHAR DEFAULT 'OFFLINE'
    CHECK (status IN ('ONLINE', 'OFFLINE', 'MAINTENANCE')),
  max_sessions INTEGER DEFAULT 50,
  current_sessions INTEGER DEFAULT 0,
  version VARCHAR,
  environment VARCHAR DEFAULT 'DEVELOPMENT'
    CHECK (environment IN ('DEVELOPMENT', 'STAGING', 'TESTING', 'PRODUCTION')),
  last_heartbeat TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Worker Metrics Table (Optional)

```sql
CREATE TABLE worker_metrics (
  id UUID PRIMARY KEY,
  worker_id VARCHAR REFERENCES workers(id),
  status VARCHAR DEFAULT 'ONLINE',
  cpu_usage FLOAT,
  memory_usage FLOAT,
  uptime INTEGER,
  message_count INTEGER,
  session_total INTEGER,
  session_connected INTEGER,
  session_disconnected INTEGER,
  session_qr_required INTEGER,
  session_reconnecting INTEGER,
  session_error INTEGER,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

## Authentication

The worker uses Bearer token authentication:

- Header: `Authorization: Bearer worker-secret-token-12345`
- This token should be validated on all worker endpoints
- The token is configured in the worker's `.env` file as `BACKEND_AUTH_TOKEN`

## Error Handling

Your backend should return appropriate HTTP status codes:

- `200` - Success
- `400` - Bad Request (invalid data)
- `401` - Unauthorized (invalid token)
- `404` - Not Found (endpoint doesn't exist)
- `409` - Conflict (worker already registered)
- `500` - Internal Server Error

Error response format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## Implementation Priority

1. **High Priority (Required for worker to start):**
   - `POST /api/v1/workers/register`
   - `PUT /api/v1/workers/{workerId}/heartbeat`

2. **Medium Priority (Required for session management):**
   - `POST /api/v1/workers/{workerId}/events`
   - `POST /api/v1/webhooks/session-status`
   - `POST /api/v1/webhooks/message-status`

3. **Low Priority (Graceful shutdown):**
   - `DELETE /api/v1/workers/{workerId}`

## Testing the Integration

Once you implement these endpoints, you can test the worker integration:

1. Start your backend server on `http://localhost:8000`
2. Implement the worker registration endpoint
3. Start the worker with `npm start`
4. Check the logs to see successful registration

## Standalone Mode

For testing without a backend, you can enable standalone mode in the worker's `.env`:

```env
STANDALONE_MODE=true
MOCK_BACKEND_RESPONSES=true
```

This will disable backend registration and allow the worker to run independently for testing WhatsApp functionality.

## Next Steps

1. Implement the worker registration endpoint in your backend
2. Test worker registration
3. Implement heartbeat endpoint
4. Test session creation and QR code generation
5. Implement event handling for session status updates

The worker is fully functional and ready to integrate once these backend endpoints are available!

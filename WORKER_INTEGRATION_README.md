# WhatsApp Gateway Worker Integration Guide

## 🎯 Overview

This document explains how to integrate your **Worker Project** with the **Backend API Gateway**. The Backend provides worker orchestration, health monitoring, and load balancing for multiple worker instances.

## 🏗️ Architecture Overview

```
Backend API Gateway ←→ Worker Instance 1 (Baileys)
                   ←→ Worker Instance 2 (Baileys)
                   ←→ Worker Instance N (Baileys)
```

### Communication Flow

1. **Worker Registration:** Worker registers itself with Backend on startup
2. **Health Monitoring:** Worker sends heartbeat every 30 seconds
3. **Session Assignment:** Backend assigns sessions to available workers
4. **Request Proxying:** Backend forwards user requests to appropriate workers
5. **Status Reporting:** Worker reports session status changes to Backend

## 🔧 Required Worker Endpoints

Your Worker project must implement these HTTP endpoints:

### 1. Health Check Endpoint

```http
GET /health
```

**Response Format:**

```json
{
  "success": true,
  "data": {
    "status": "online",
    "sessionCount": 25,
    "cpuUsage": 45.5,
    "memoryUsage": 67.8,
    "uptime": 3600,
    "maxSessions": 50
  }
}
```

### 2. Session Management Endpoints

#### Create Session

```http
POST /session/create
Content-Type: application/json

{
  "sessionId": "user123-personal",
  "userId": "user123",
  "sessionName": "Personal WhatsApp"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "user123-personal",
    "status": "disconnected",
    "message": "Session created successfully"
  }
}
```

**Purpose:** Creates a new session record locally in worker. Does NOT connect to WhatsApp yet.

**Implementation Notes:**

- Create session record in local storage/database
- Initialize session metadata only
- Set status to "disconnected"
- Do NOT initialize Baileys connection yet
- Do NOT generate QR code at this stage

#### Connect Session

```http
POST /session/{sessionId}/connect
Content-Type: application/json
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "user123-personal",
    "status": "qr_required",
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**Purpose:** Starts WhatsApp connection and generates QR code for authentication.

**Implementation Notes:**

- Initialize Baileys connection
- Generate QR code for authentication
- Store session state locally
- Report status to Backend via webhook

#### Get Session Status

```http
GET /session/{sessionId}/status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "user123-personal",
    "status": "connected",
    "phoneNumber": "+6281234567890",
    "lastActivity": "2024-01-15T10:30:00Z"
  }
}
```

#### Delete Session

```http
DELETE /session/{sessionId}
```

**Response:**

```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

### 3. Message Endpoints

#### Send Message

```http
POST /session/{sessionId}/send
Content-Type: application/json

{
  "to": "6281234567890@s.whatsapp.net",
  "type": "text",
  "message": "Hello World!"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "messageId": "msg_12345",
    "status": "sent",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Get Messages

```http
GET /session/{sessionId}/messages?limit=50&offset=0
```

**Response:**

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg_001",
        "from": "6281234567890@s.whatsapp.net",
        "to": "6289876543210@s.whatsapp.net",
        "type": "text",
        "content": "Hello!",
        "timestamp": "2024-01-15T10:30:00Z",
        "status": "delivered"
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 50,
      "offset": 0
    }
  }
}
```

## 🔄 Worker-Backend Communication Protocol

### 1. Worker Registration (On Startup)

```javascript
// Worker calls Backend on startup
POST http://backend-url/api/v1/workers/register
Authorization: Bearer {WORKER_AUTH_TOKEN}
Content-Type: application/json

{
  "workerId": "worker-001",
  "endpoint": "http://192.168.1.100:8001",
  "maxSessions": 50,
  "description": "Primary worker instance"
}
```

### 2. Heartbeat (Every 30 seconds)

```javascript
// Worker sends health metrics to Backend
PUT http://backend-url/api/v1/workers/worker-001/heartbeat
Authorization: Bearer {WORKER_AUTH_TOKEN}
Content-Type: application/json

{
  "status": "online",
  "sessionCount": 25,
  "cpuUsage": 45.5,
  "memoryUsage": 67.8,
  "uptime": 3600,
  "messageCount": 1250
}
```

### 3. Session Status Updates (Event-driven)

```javascript
// Worker reports session status changes to Backend
POST http://backend-url/api/webhooks/session-status
Authorization: Bearer {WORKER_AUTH_TOKEN}
Content-Type: application/json

{
  "sessionId": "user123-personal",
  "status": "connected",
  "phoneNumber": "+6281234567890",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 🔧 Worker Implementation Requirements

### 1. Environment Variables

```bash
# Worker Configuration
WORKER_ID=worker-001
WORKER_PORT=8001
WORKER_MAX_SESSIONS=50

# Backend Communication
BACKEND_URL=http://localhost:8000
WORKER_AUTH_TOKEN=your-worker-secret-token

# MinIO Storage Configuration
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=whatsapp-sessions
MINIO_USE_SSL=false
```

### 2. MinIO-Based Storage Strategy

**✅ Worker uses MinIO for persistent storage:**

- **Session State:** MinIO + Local cache (Baileys auth state)
- **Messages:** MinIO buckets organized by session and date
- **Media Files:** MinIO with organized folder structure
- **QR Codes:** Memory/cache (temporary)

**❌ Worker does NOT need:**

- Prisma schema or PostgreSQL database
- Complex ORM operations
- Local database management

### 3. MinIO Storage Architecture

```javascript
// Worker MinIO storage structure
MinIO Buckets:
├── sessions/
│   ├── user123-personal/
│   │   ├── auth_info_baileys/     # Baileys auth state files
│   │   ├── session-data.json      # Session metadata
│   │   └── messages/              # Message history files
│   │       ├── 2024-01-15.json    # Daily message logs
│   │       └── 2024-01-16.json
│   └── user456-business/
├── media/
│   ├── user123-personal/
│   │   ├── images/
│   │   ├── documents/
│   │   └── audio/
└── temp/
    ├── qr-codes/                  # Temporary QR codes
    └── uploads/                   # Temporary file uploads

// Worker storage service example
class WorkerMinIOStorage {
  constructor() {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      useSSL: process.env.MINIO_USE_SSL === 'true'
    });
    this.sessionCache = new Map();  // In-memory cache for active sessions
  }

  // Session operations with MinIO
  async saveSessionData(sessionId, data) {
    const objectName = `sessions/${sessionId}/session-data.json`;
    await this.minioClient.putObject(
      process.env.MINIO_BUCKET_NAME,
      objectName,
      JSON.stringify(data)
    );
  }

  async loadSessionData(sessionId) {
    const objectName = `sessions/${sessionId}/session-data.json`;
    const stream = await this.minioClient.getObject(
      process.env.MINIO_BUCKET_NAME,
      objectName
    );
    return JSON.parse(await streamToString(stream));
  }

  // Message operations with daily partitioning
  async saveMessage(sessionId, message) {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const objectName = `sessions/${sessionId}/messages/${date}.json`;

    // Load existing messages for the day
    let messages = [];
    try {
      const stream = await this.minioClient.getObject(
        process.env.MINIO_BUCKET_NAME,
        objectName
      );
      messages = JSON.parse(await streamToString(stream));
    } catch (error) {
      // File doesn't exist, start with empty array
    }

    // Add new message and save
    messages.push(message);
    await this.minioClient.putObject(
      process.env.MINIO_BUCKET_NAME,
      objectName,
      JSON.stringify(messages)
    );
  }
}
```

### 2. Startup Sequence

```javascript
// Example Worker Startup Code
async function startWorker() {
  try {
    // 1. Start Express server
    const app = express();
    const server = app.listen(process.env.WORKER_PORT);

    // 2. Register with Backend
    await registerWithBackend();

    // 3. Start heartbeat
    setInterval(sendHeartbeat, 30000);

    // 4. Load existing sessions
    await loadPersistedSessions();

    console.log(
      `Worker ${process.env.WORKER_ID} started on port ${process.env.WORKER_PORT}`
    );
  } catch (error) {
    console.error("Worker startup failed:", error);
    process.exit(1);
  }
}

async function registerWithBackend() {
  const response = await axios.post(
    `${process.env.BACKEND_URL}/api/v1/workers/register`,
    {
      workerId: process.env.WORKER_ID,
      endpoint: `http://localhost:${process.env.WORKER_PORT}`,
      maxSessions: parseInt(process.env.WORKER_MAX_SESSIONS),
      description: "Auto-registered worker",
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("Registered with backend:", response.data);
}

async function sendHeartbeat() {
  try {
    const metrics = {
      status: "online",
      sessionCount: getActiveSessionCount(),
      cpuUsage: getCpuUsage(),
      memoryUsage: getMemoryUsage(),
      uptime: process.uptime(),
      messageCount: getTotalMessageCount(),
    };

    await axios.put(
      `${process.env.BACKEND_URL}/api/v1/workers/${process.env.WORKER_ID}/heartbeat`,
      metrics,
      {
        headers: {
          Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Heartbeat failed:", error.message);
  }
}
```

### 3. Session Management Implementation

```javascript
// Example Session Management
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  // Phase 1: Create session record only (no WhatsApp connection)
  async createSession(sessionId, userId, sessionName) {
    try {
      // Store session metadata only
      this.sessions.set(sessionId, {
        sessionId,
        userId,
        sessionName,
        status: "disconnected",
        createdAt: new Date(),
        sock: null, // No Baileys connection yet
      });

      return {
        sessionId,
        status: "disconnected",
        message: "Session created successfully",
      };
    } catch (error) {
      console.error("Session creation failed:", error);
      throw error;
    }
  }

  // Phase 2: Connect to WhatsApp and generate QR
  async connectSession(sessionId) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error("Session not found");
      }

      // Initialize Baileys connection
      const { state, saveCreds } = await useMultiFileAuthState(
        `./sessions/${sessionId}`
      );

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
      });

      // Handle QR code generation
      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrCodeDataURL = await QRCode.toDataURL(qr);

          // Update local session
          session.status = "qr_required";
          session.qrCode = qrCodeDataURL;

          // Report QR to Backend
          await this.reportSessionStatus(sessionId, {
            status: "qr_required",
            qrCode: qrCodeDataURL,
          });
        }

        if (connection === "open") {
          const phoneNumber = sock.user?.id?.split(":")[0];

          // Update local session
          session.status = "connected";
          session.phoneNumber = phoneNumber;

          // Report successful connection
          await this.reportSessionStatus(sessionId, {
            status: "connected",
            phoneNumber: phoneNumber,
          });
        }
      });

      // Update session with Baileys socket
      session.sock = sock;
      session.status = "connecting";

      return {
        sessionId,
        status: "connecting",
        message: "Connection initiated",
      };
    } catch (error) {
      console.error("Session connection failed:", error);
      throw error;
    }
  }

  async reportSessionStatus(sessionId, statusData) {
    try {
      await axios.post(
        `${process.env.BACKEND_URL}/api/webhooks/session-status`,
        {
          sessionId,
          ...statusData,
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.error("Failed to report session status:", error);
    }
  }
}
```

## 📊 Backend APIs for Worker Management

### Admin APIs (Requires JWT Authentication)

#### Get All Workers

```http
GET /api/v1/workers
Authorization: Bearer {JWT_TOKEN}
```

#### Add Worker Manually

```http
POST /api/v1/workers
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "endpoint": "http://203.0.113.45:8001",
  "maxSessions": 20,
  "description": "External VPS worker"
}
```

#### Remove Worker

```http
DELETE /api/v1/workers/{workerId}
Authorization: Bearer {JWT_TOKEN}
```

#### Get Worker Statistics

```http
GET /api/v1/workers/statistics
Authorization: Bearer {JWT_TOKEN}
```

#### Test Worker Connectivity

```http
POST /api/v1/workers/test
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "endpoint": "http://192.168.1.100:8001"
}
```

### Health Monitoring APIs

#### Start Health Monitoring

```http
POST /api/v1/workers/health/start
Authorization: Bearer {JWT_TOKEN}
```

#### Stop Health Monitoring

```http
POST /api/v1/workers/health/stop
Authorization: Bearer {JWT_TOKEN}
```

#### Get Health Status

```http
GET /api/v1/workers/health/status
Authorization: Bearer {JWT_TOKEN}
```

## 🔒 Authentication

### Worker Token Authentication

Workers use a shared secret token for authentication:

```bash
# Environment variable
WORKER_AUTH_TOKEN=your-worker-secret-token

# HTTP Header
Authorization: Bearer your-worker-secret-token
```

### Admin JWT Authentication

Admin operations require JWT token from user login:

```bash
# HTTP Header
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 🚀 Deployment Scenarios

### 1. Local Development

```bash
# Backend
npm run dev  # Port 8000

# Worker 1
WORKER_ID=worker-001 WORKER_PORT=8001 npm start

# Worker 2
WORKER_ID=worker-002 WORKER_PORT=8002 npm start
```

### 2. Docker Deployment

```yaml
# docker-compose.yml
version: "3.8"
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://redis:6379

  worker-1:
    build: ./worker
    ports:
      - "8001:8001"
    environment:
      - WORKER_ID=worker-001
      - WORKER_PORT=8001
      - BACKEND_URL=http://backend:8000

  worker-2:
    build: ./worker
    ports:
      - "8002:8002"
    environment:
      - WORKER_ID=worker-002
      - WORKER_PORT=8002
      - BACKEND_URL=http://backend:8000
```

### 3. Kubernetes Deployment

```yaml
# worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whatsapp-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: whatsapp-worker
  template:
    metadata:
      labels:
        app: whatsapp-worker
    spec:
      containers:
        - name: worker
          image: whatsapp-worker:latest
          ports:
            - containerPort: 8001
          env:
            - name: WORKER_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: BACKEND_URL
              value: "http://whatsapp-backend:8000"
            - name: WORKER_AUTH_TOKEN
              valueFrom:
                secretKeyRef:
                  name: worker-secrets
                  key: auth-token
```

## 📋 Implementation Checklist

### Worker Project Requirements

- [ ] **Express Server Setup**
  - [ ] Health check endpoint (`GET /health`)
  - [ ] Session management endpoints
  - [ ] Message handling endpoints
  - [ ] Error handling middleware

- [ ] **Baileys Integration**
  - [ ] Session creation and management
  - [ ] QR code generation
  - [ ] Message sending/receiving
  - [ ] Connection state handling

- [ ] **Backend Communication**
  - [ ] Worker registration on startup
  - [ ] Heartbeat mechanism (30s interval)
  - [ ] Session status reporting
  - [ ] Error reporting

- [ ] **Storage Management**
  - [ ] Session state persistence
  - [ ] Message history storage
  - [ ] Media file handling
  - [ ] Cleanup on session deletion

- [ ] **Monitoring & Logging**
  - [ ] Performance metrics collection
  - [ ] Structured logging
  - [ ] Error tracking
  - [ ] Health status reporting

### Backend Integration Points

- [ ] **Worker Registry**
  - [x] Worker registration API
  - [x] Heartbeat handling
  - [x] Health monitoring
  - [x] Load balancing

- [ ] **Session Orchestration**
  - [ ] Session assignment to workers
  - [ ] Request proxying
  - [ ] Session migration (future)
  - [ ] Status synchronization

- [ ] **Admin Management**
  - [x] Worker CRUD operations
  - [x] Statistics and analytics
  - [x] Health monitoring controls
  - [x] Connectivity testing

## 🔧 Testing

### Worker Testing

```bash
# Test health endpoint
curl http://localhost:8001/health

# Test session creation
curl -X POST http://localhost:8001/session/create \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-session","userId":"user123"}'

# Test message sending
curl -X POST http://localhost:8001/session/test-session/send \
  -H "Content-Type: application/json" \
  -d '{"to":"6281234567890@s.whatsapp.net","type":"text","message":"Hello!"}'
```

### Backend Testing

```bash
# Test worker registration
curl -X POST http://localhost:8000/api/v1/workers/register \
  -H "Authorization: Bearer your-worker-token" \
  -H "Content-Type: application/json" \
  -d '{"workerId":"worker-001","endpoint":"http://localhost:8001","maxSessions":50}'

# Test admin worker list
curl http://localhost:8000/api/v1/workers \
  -H "Authorization: Bearer your-jwt-token"
```

## 🎯 Next Steps

1. **Implement Worker Project** following this specification
2. **Test Worker-Backend Communication** using the provided examples
3. **Deploy Multiple Workers** to test load balancing
4. **Implement Session Management** in Phase 4
5. **Add Message Proxying** for complete integration

---

**Project:** WhatsApp Gateway PaaS  
**Component:** Worker Integration  
**Version:** 1.0  
**Last Updated:** January 7, 2025

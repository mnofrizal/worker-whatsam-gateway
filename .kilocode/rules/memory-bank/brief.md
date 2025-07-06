# WhatsApp Gateway PaaS - Worker Brief

## 🎯 Overview

**WhatsApp Worker** adalah service yang handle actual WhatsApp connections menggunakan Baileys library. Worker ini bertanggung jawab untuk manage multiple WhatsApp sessions, persist session data, dan communicate dengan Backend API Gateway.

**Core Responsibilities:**

- **WhatsApp Connection:** Handle Baileys integration untuk connect ke WhatsApp Web
- **Session Management:** Create, maintain, dan cleanup WhatsApp sessions
- **Message Operations:** Send/receive messages, media files, dan status updates
- **Storage Integration:** Persist session data ke MinIO untuk failover capability
- **Health Monitoring:** Report status ke Backend Gateway untuk load balancing

---

## 🏗️ Technical Stack

### Core Technologies

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **WhatsApp Library:** @whiskeysockets/baileys (latest stable)
- **Storage Client:** MinIO SDK for session persistence
- **Database Client:** pg (PostgreSQL) untuk metadata
- **Caching:** ioredis untuk Redis integration
- **Process Management:** PM2 (production) / nodemon (development)

### Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "@whiskeysockets/baileys": "^6.7.18",
    "qrcode": "^1.5.3",
    "minio": "^7.1.3",
    "pg": "^8.11.0",
    "ioredis": "^5.3.2",
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "winston": "^3.11.0",
    "multer": "^1.4.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## 📁 Project Structure

````
worker/
├── src/
│   ├── controllers/
│   │   ├── session.controller.js     # Session CRUD operations
│   │   ├── message.controller.js     # Message sending/receiving
│   │   ├── health.controller.js      # Health check endpoint
│   │   └── webhook.controller.js     # Webhook notifications
│   ├── services/
│   │   ├── baileys.service.js        # Baileys integration service
│   │   ├── storage.service.js        # MinIO storage service
│   │   ├── database.service.js       # PostgreSQL operations
│   │   ├── redis.service.js          # Redis caching service
│   │   └── worker-registry.service.js # Backend registration service
│   ├── middleware/
│   │   ├── auth.middleware.js        # API authentication
│   │   ├── validation.middleware.js  # Request validation
│   │   ├── rate-limit.middleware.js  # Rate limiting
│   │   └── error-handler.middleware.js # Error handling
│   ├── models/
│   │   ├── session.model.js          # Session data model
│   │   └── message.model.js          # Message data model
│   ├── utils/
│   │   ├── logger.js                 # Winston logger setup
│   │   ├── qr-generator.js           # QR code generation
│   │   └── helpers.js                # Utility functions
│   ├── routes/
│   │   ├── session.routes.js         # Session routes
│   │   ├── message.routes.js         # Message routes
│   │   ├── health.routes.js          # Health routes
│   │   └── index.js                  # Route aggregator
│   ├── config/
│   │   ├── database.config.js        # Database configuration
│   │   ├── redis.config.js           # Redis configuration
│   │   ├── minio.config.js           # MinIO configuration
│   │   └── baileys.config.js         # Baileys configuration
│   └── app.js                        # Express app setup
├── storage/                          # Local session backup
├── logs/                             # Application logs
├── .env.example                      # Environment variables template
├── Dockerfile                        # Container configuration
├── package.json
└── README.md

---

## 🔌 API Endpoints

### Session Management

#### Create Session

```http
POST /session/create
Content-Type: application/json

{
  "sessionId": "user123-session1",
  "userId": "user123",
  "sessionName": "Personal WhatsApp"
}

Response: {
  "success": true,
  "data": {
    "sessionId": "user123-session1",
    "status": "initializing",
    "qrCode": "data:image/png;base64,..."
  }
}
````

#### Get QR Code

```http
GET /session/{sessionId}/qr

Response: {
  "success": true,
  "data": {
    "qrCode": "data:image/png;base64,....."
    "status": "qr_ready",
    "expiresAt": "2024-01-15T10:30:00Z"
  }
}
```

#### Get Session Status

```http
GET /session/{sessionId}/status

Response: {
  "success": true,
  "data": {
    "sessionId": "user123-session1",
    "status": "connected", // initializing, qr_ready, connected, disconnected
    "phoneNumber": "+6281234567890",
    "lastSeen": "2024-01-15T10:25:00Z",
    "messageCount": 157
  }
}
```

#### Delete Session

```http
DELETE /session/{sessionId}

Response: {
  "success": true,
  "message": "Session deleted successfully"
}
```

### Message Operations

#### Send Text Message

```http
POST /session/{sessionId}/send
Content-Type: application/json

{
  "to": "6281234567890@s.whatsapp.net",
  "type": "text",
  "message": "Hello from WhatsApp Gateway!"
}

Response: {
  "success": true,
  "data": {
    "messageId": "msg_12345",
    "status": "sent",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Send Media Message

```http
POST /session/{sessionId}/send
Content-Type: multipart/form-data

{
  "to": "6281234567890@s.whatsapp.net",
  "type": "image", // image, document, audio, video
  "caption": "Check this out!",
  "media": [file upload]
}

Response: {
  "success": true,
  "data": {
    "messageId": "msg_12346",
    "status": "sent",
    "mediaUrl": "https://minio.../media/12346.jpg"
  }
}
```

#### Get Message History

```http
GET /session/{sessionId}/messages?limit=50&offset=0&contact=6281234567890

Response: {
  "success": true,
  "data": {
    "messages": [...],
    "pagination": {
      "total": 250,
      "limit": 50,
      "offset": 0
    }
  }
}
```

### Health & Monitoring

#### Health Check

```http
GET /health

Response: {
  "status": "healthy",
  "workerId": "worker-001",
  "uptime": 3600,
  "sessions": {
    "total": 25,
    "connected": 23,
    "disconnected": 2
  },
  "resources": {
    "cpuUsage": 45.5,
    "memoryUsage": 67.8,
    "memoryTotal": 2048
  },
  "storage": {
    "minioConnected": true,
    "redisConnected": true,
    "dbConnected": true
  }
}
```

#### Worker Metrics

```http
GET /metrics

Response: {
  "worker": {
    "id": "worker-001",
    "endpoint": "http://192.168.1.100:8001",
    "startTime": "2024-01-15T08:00:00Z",
    "version": "1.0.0"
  },
  "sessions": {
    "total": 25,
    "byStatus": {
      "connected": 23,
      "disconnected": 2,
      "initializing": 0
    }
  },
  "messages": {
    "sent": 1250,
    "received": 890,
    "failed": 5,
    "lastHour": 45
  },
  "performance": {
    "avgResponseTime": 120,
    "errorRate": 0.02,
    "throughput": 15.5
  }
}
```

---

## 🔧 Core Services Implementation

### Baileys Integration Service

```javascript
// services/baileys.js
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");

class BaileysService {
  constructor() {
    this.sessions = new Map(); // sessionId -> socket instance
    this.qrCodes = new Map(); // sessionId -> qr code data
  }

  async createSession(sessionId, userId) {
    try {
      // Setup auth state from storage
      const authDir = `./storage/sessions/${sessionId}`;
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.logger,
        generateHighQualityLinkPreview: true,
      });

      // Handle QR code generation
      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrCodeData = await QRCode.toDataURL(qr);
          this.qrCodes.set(sessionId, qrCodeData);

          // Notify backend about QR code ready
          await this.notifyBackend("qr_ready", sessionId, {
            qrCode: qrCodeData,
          });
        }

        if (connection === "close") {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut;

          if (shouldReconnect) {
            setTimeout(() => this.createSession(sessionId, userId), 5000);
          }
        } else if (connection === "open") {
          this.sessions.set(sessionId, socket);
          await this.notifyBackend("connected", sessionId, {
            phoneNumber: socket.user?.id,
          });
        }
      });

      // Handle credentials update
      socket.ev.on("creds.update", saveCreds);

      // Handle incoming messages
      socket.ev.on("messages.upsert", (m) => {
        this.handleIncomingMessages(sessionId, m);
      });

      return { success: true, sessionId };
    } catch (error) {
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  async sendMessage(sessionId, to, message) {
    const socket = this.sessions.get(sessionId);
    if (!socket) {
      throw new Error("Session not found or not connected");
    }

    try {
      const result = await socket.sendMessage(to, message);
      return {
        messageId: result.key.id,
        status: "sent",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  getSessionStatus(sessionId) {
    const socket = this.sessions.get(sessionId);
    const qrCode = this.qrCodes.get(sessionId);

    if (!socket && !qrCode) {
      return { status: "not_found" };
    }

    if (qrCode && !socket) {
      return { status: "qr_ready", qrCode };
    }

    if (socket) {
      return {
        status: "connected",
        phoneNumber: socket.user?.id,
        lastSeen: new Date().toISOString(),
      };
    }

    return { status: "initializing" };
  }

  async deleteSession(sessionId) {
    const socket = this.sessions.get(sessionId);

    if (socket) {
      await socket.logout();
      this.sessions.delete(sessionId);
    }

    this.qrCodes.delete(sessionId);

    // Clean up auth files from storage
    await this.storageService.deleteSessionFiles(sessionId);

    return { success: true };
  }
}
```

### Storage Service (MinIO Integration)

```javascript
// services/storage.js
const Minio = require("minio");

class StorageService {
  constructor() {
    this.client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });

    this.bucketName = "whatsapp-sessions";
    this.mediaBucket = "whatsapp-media";
  }

  async initialize() {
    // Ensure buckets exist
    const bucketsToCreate = [this.bucketName, this.mediaBucket];

    for (const bucket of bucketsToCreate) {
      const exists = await this.client.bucketExists(bucket);
      if (!exists) {
        await this.client.makeBucket(bucket);
      }
    }
  }

  async uploadSessionFiles(sessionId) {
    const localPath = `./storage/sessions/${sessionId}`;
    const remotePath = `sessions/${sessionId}`;

    try {
      const files = await fs.readdir(localPath);

      for (const file of files) {
        const filePath = path.join(localPath, file);
        const objectName = `${remotePath}/${file}`;

        await this.client.fPutObject(this.bucketName, objectName, filePath);
      }

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to upload session files: ${error.message}`);
    }
  }

  async downloadSessionFiles(sessionId) {
    const localPath = `./storage/sessions/${sessionId}`;
    const remotePath = `sessions/${sessionId}`;

    try {
      await fs.mkdir(localPath, { recursive: true });

      const objectsStream = this.client.listObjects(
        this.bucketName,
        remotePath,
        true
      );

      for await (const obj of objectsStream) {
        const localFile = path.join(localPath, path.basename(obj.name));
        await this.client.fGetObject(this.bucketName, obj.name, localFile);
      }

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to download session files: ${error.message}`);
    }
  }

  async uploadMedia(sessionId, mediaBuffer, fileName, mimeType) {
    const objectName = `media/${sessionId}/${Date.now()}-${fileName}`;

    try {
      await this.client.putObject(this.mediaBucket, objectName, mediaBuffer, {
        "Content-Type": mimeType,
      });

      const url = await this.client.presignedGetObject(
        this.mediaBucket,
        objectName,
        3600
      );
      return { url, objectName };
    } catch (error) {
      throw new Error(`Failed to upload media: ${error.message}`);
    }
  }

  async deleteSessionFiles(sessionId) {
    const remotePath = `sessions/${sessionId}`;

    try {
      const objectsStream = this.client.listObjects(
        this.bucketName,
        remotePath,
        true
      );
      const objectsList = [];

      for await (const obj of objectsStream) {
        objectsList.push(obj.name);
      }

      if (objectsList.length > 0) {
        await this.client.removeObjects(this.bucketName, objectsList);
      }

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to delete session files: ${error.message}`);
    }
  }
}
```

### Worker Registry Service

```javascript
// services/worker-registry.js
const axios = require("axios");

class WorkerRegistryService {
  constructor() {
    this.backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    this.workerId = process.env.WORKER_ID || `worker-${Date.now()}`;
    this.workerEndpoint =
      process.env.WORKER_ENDPOINT || "http://localhost:8001";
    this.maxSessions = parseInt(process.env.MAX_SESSIONS) || 50;
    this.heartbeatInterval = null;
  }

  async registerWorker() {
    try {
      const response = await axios.post(
        `${this.backendUrl}/api/admin/workers/register`,
        {
          workerId: this.workerId,
          endpoint: this.workerEndpoint,
          maxSessions: this.maxSessions,
          status: "online",
        }
      );

      console.log("Worker registered successfully:", response.data);

      // Start heartbeat
      this.startHeartbeat();

      return response.data;
    } catch (error) {
      console.error("Failed to register worker:", error.message);
      throw error;
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const metrics = await this.getWorkerMetrics();

        await axios.put(
          `${this.backendUrl}/api/admin/workers/${this.workerId}/heartbeat`,
          {
            status: "online",
            metrics,
            timestamp: new Date().toISOString(),
          }
        );
      } catch (error) {
        console.error("Heartbeat failed:", error.message);
      }
    }, 30000); // Every 30 seconds
  }

  async getWorkerMetrics() {
    const sessions = this.baileysService.sessions;
    const connectedSessions = Array.from(sessions.values()).filter(
      (s) => s.user
    ).length;

    return {
      sessionCount: sessions.size,
      connectedSessions,
      cpuUsage: process.cpuUsage(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };
  }

  async notifyBackend(event, sessionId, data = {}) {
    try {
      await axios.post(
        `${this.backendUrl}/api/admin/workers/${this.workerId}/events`,
        {
          event,
          sessionId,
          data,
          timestamp: new Date().toISOString(),
        }
      );
    } catch (error) {
      console.error("Failed to notify backend:", error.message);
    }
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
```

---

## 🔒 Security & Authentication

### API Authentication Middleware

```javascript
// middleware/auth.js
const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Access token required",
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    req.user = user;
    next();
  });
};

const authenticateWorker = async (req, res, next) => {
  const workerToken = req.headers["x-worker-token"];

  if (workerToken !== process.env.WORKER_AUTH_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Invalid worker token",
    });
  }

  next();
};
```

### Rate Limiting

```javascript
// middleware/rate-limit.js
const rateLimit = require("express-rate-limit");

const sessionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per window per IP
  message: {
    success: false,
    error: "Too many session requests, please try again later",
  },
});

const messageRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Max 30 messages per minute per IP
  message: {
    success: false,
    error: "Message rate limit exceeded",
  },
});
```

---

## 📊 Monitoring & Logging

### Logger Configuration

```javascript
// utils/logger.js
const winston = require("winston");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: "whatsapp-worker",
    workerId: process.env.WORKER_ID,
  },
  transports: [
    new winston.transports.File({
      filename: "./logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "./logs/combined.log",
    }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});
```

### Performance Metrics

```javascript
// utils/metrics.js
class MetricsCollector {
  constructor() {
    this.metrics = {
      messagesTotal: 0,
      messagesSent: 0,
      messagesReceived: 0,
      messagesFailed: 0,
      sessionCreated: 0,
      sessionDeleted: 0,
      errors: 0,
    };
  }

  incrementCounter(metric) {
    if (this.metrics.hasOwnProperty(metric)) {
      this.metrics[metric]++;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  reset() {
    Object.keys(this.metrics).forEach((key) => {
      this.metrics[key] = 0;
    });
  }
}
```

---

## 🚀 Development Phases

### Phase 1: Foundation Setup (Week 1)

- ✅ Node.js project initialization
- ✅ Express server setup dengan basic routing
- ✅ Baileys integration untuk basic WhatsApp connection
- ✅ QR code generation functionality
- ✅ Basic session create/delete endpoints
- ✅ Manual testing: scan QR dan send message
- **Deliverable:** Working WhatsApp connection

### Phase 2: Storage Integration (Week 2)

- ✅ MinIO client setup dan bucket management
- ✅ Session file persistence ke MinIO
- ✅ Session recovery mechanism dari storage
- ✅ Multiple session handling dalam single worker
- ✅ Database integration untuk session metadata
- **Deliverable:** Persistent session management

### Phase 3: Service Communication (Week 3)

- ✅ Worker registration dengan Backend Gateway
- ✅ Health check endpoints implementation
- ✅ Heartbeat mechanism ke backend
- ✅ Session status reporting
- ✅ Error handling dan retry mechanisms
- **Deliverable:** Backend-integrated worker

### Phase 4: Advanced Features (Week 4)

- ✅ Media message support (image, document, video)
- ✅ Message history dan storage
- ✅ Session migration preparation
- ✅ Performance optimization
- ✅ Resource monitoring implementation
- **Deliverable:** Feature-complete worker

### Phase 5: Production Ready (Week 5)

- ✅ Comprehensive error handling
- ✅ Security hardening
- ✅ Rate limiting implementation
- ✅ Logging dan monitoring enhancement
- ✅ Load testing dan optimization
- **Deliverable:** Production-ready worker

### Phase 6: Monitoring & Maintenance (Week 6)

- ✅ Metrics collection enhancement
- ✅ Health monitoring improvement
- ✅ Auto-recovery mechanisms
- ✅ Documentation completion
- ✅ Deployment preparation
- **Deliverable:** Monitored dan maintainable worker

---

## 🔧 Configuration

### Environment Variables

```bash
# Server Configuration
PORT=8001
NODE_ENV=development
WORKER_ID=worker-001
WORKER_ENDPOINT=http://localhost:8001
MAX_SESSIONS=50

# Backend Integration
BACKEND_URL=http://localhost:8000
WORKER_AUTH_TOKEN=worker-secret-token
HEARTBEAT_INTERVAL=30000

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_gateway
REDIS_URL=redis://localhost:6379

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# Security
JWT_SECRET=your-jwt-secret-key
ENCRYPTION_KEY=your-encryption-key

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=./logs
```

### Docker Configuration

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY . .

# Create necessary directories
RUN mkdir -p storage/sessions logs

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

# Start application
CMD ["npm", "start"]
```

---

## 🧪 Testing Strategy

### Manual Testing Checklist

- [ ] Worker startup dan registration ke backend
- [ ] Session creation dengan QR code generation
- [ ] QR code scanning dan WhatsApp connection
- [ ] Text message sending dan receiving
- [ ] Media message support
- [ ] Session persistence dan recovery
- [ ] Worker health check functionality
- [ ] Session deletion dan cleanup

### Load Testing Targets

- **Concurrent Sessions:** 50 sessions per worker
- **Message Throughput:** 100 messages/minute per session
- **Memory Usage:** <2GB untuk 50 sessions
- **CPU Usage:** <80% under normal load
- **Response Time:** <500ms untuk API calls

---

## 📦 Deployment

### Production Deployment

```bash
# Build Docker image
docker build -t whatsapp-worker:latest .

# Run container
docker run -d \
  --name whatsapp-worker-01 \
  --env-file .env.production \
  -p 8001:8001 \
  -v worker-storage:/app/storage \
  -v worker-logs:/app/logs \
  whatsapp-worker:latest
```

### Kubernetes Deployment

```yaml
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
          volumeMounts:
            - name: storage
              mountPath: /app/storage
      volumes:
        - name: storage
          persistentVolumeClaim:
            claimName: worker-storage-pvc
```

---

## 🎯 Success Metrics

### Technical KPIs

- **Session Success Rate:** >95% successful WhatsApp connections
- **Message Delivery Rate:** >98% message delivery success
- **Uptime:** >99.5% worker availability
- **Response Time:** <200ms untuk session operations
- **Recovery Time:** <30s untuk session failover

### Performance Targets

- **Memory Efficiency:** <50MB per session
- **CPU Efficiency:** <2% CPU per active session
- **Storage Efficiency:** <10MB per session auth data
- **Network Efficiency:** <1KB/s per idle session

---

**Project:** WhatsApp Gateway PaaS  
**Service:** Worker Component  
**Expected Development:** 6 weeks  
**Tech Stack:** Node.js, Express, Baileys, MinIO

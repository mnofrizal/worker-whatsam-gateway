# Session Recovery & Enhanced Heartbeat Plan

## 🎯 Overview

This document outlines the implementation plan for **Session Recovery** and **Enhanced Push Heartbeat** mechanisms in the WhatsApp Gateway PaaS system. The goal is to ensure sessions survive worker restarts and provide better worker monitoring.

**Current Problem:**

- When workers restart, sessions are lost from worker memory
- Users must manually recreate sessions even though backend database still has session records
- Current heartbeat system has both push and pull mechanisms (inefficient)

**Solution:**

- Implement session recovery on worker startup
- Enhance push heartbeat with session data
- Remove redundant polling from backend

---

## 🏗️ Architecture Overview

### Current Flow (Problematic):

```
Worker Restart → Sessions Lost → User Must Recreate Session
```

### New Flow (With Recovery):

```
Worker Restart → Worker Asks Backend for Assigned Sessions → Worker Recovers Sessions → Sessions Continue Working
```

### Enhanced Heartbeat Flow:

```
Worker → Send Heartbeat with Session Data → Backend Updates Status → Backend Detects Stale Workers
```

---

## 📋 Implementation Plan

### Phase 1: Session Recovery Implementation

### Phase 2: Enhanced Push Heartbeat

### Phase 3: Backend Optimization

---

# 🔄 PHASE 1: SESSION RECOVERY IMPLEMENTATION

## 1.1 Backend Changes Required

### 1.1.1 New API Endpoint: Get Assigned Sessions

**File:** `src/routes/worker.routes.js`

```javascript
// Add new route for session recovery
router.get(
  "/sessions/assigned",
  authenticateWorker,
  WorkerController.getAssignedSessions
);
```

**File:** `src/controllers/worker.controller.js`

```javascript
/**
 * Get sessions assigned to this worker for recovery
 * Called by worker on startup to recover sessions
 */
static getAssignedSessions = asyncHandler(async (req, res) => {
  const workerId = req.headers['x-worker-id'];

  if (!workerId) {
    return res.status(400).json(
      ApiResponse.createErrorResponse('Worker ID required in headers')
    );
  }

  const sessions = await WorkerService.getAssignedSessions(workerId);

  return res.status(HTTP_STATUS.OK).json(
    ApiResponse.createSuccessResponse(
      { workerId, sessions },
      'Assigned sessions retrieved successfully'
    )
  );
});
```

### 1.1.2 Worker Service Enhancement

**File:** `src/services/worker.service.js`

```javascript
/**
 * Get sessions assigned to a specific worker
 * Used for session recovery on worker startup
 * @param {string} workerId - Worker ID
 * @returns {Array} Array of session objects
 */
export const getAssignedSessions = async (workerId) => {
  try {
    logger.info("Getting assigned sessions for worker", {
      workerId,
      service: "WorkerService",
    });

    // Get sessions assigned to this worker
    const sessions = await prisma.session.findMany({
      where: {
        workerId: workerId,
        status: {
          in: ["CONNECTED", "QR_REQUIRED", "INIT", "RECONNECTING"],
        },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        status: true,
        phoneNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info("Retrieved assigned sessions", {
      workerId,
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({ id: s.id, status: s.status })),
      service: "WorkerService",
    });

    return sessions;
  } catch (error) {
    logger.error("Failed to get assigned sessions", {
      workerId,
      error: error.message,
      service: "WorkerService",
    });
    throw error;
  }
};
```

### 1.1.3 Session Recovery Status Endpoint

**File:** `src/routes/worker.routes.js`

```javascript
// Add route for session recovery status reporting
router.post(
  "/sessions/recovery-status",
  authenticateWorker,
  WorkerController.reportRecoveryStatus
);
```

**File:** `src/controllers/worker.controller.js`

```javascript
/**
 * Report session recovery status from worker
 * Called by worker after attempting to recover sessions
 */
static reportRecoveryStatus = asyncHandler(async (req, res) => {
  const workerId = req.headers['x-worker-id'];
  const { recoveredSessions, failedSessions } = req.body;

  await WorkerService.handleRecoveryStatus(workerId, recoveredSessions, failedSessions);

  return res.status(HTTP_STATUS.OK).json(
    ApiResponse.createSuccessResponse(
      { workerId, recovered: recoveredSessions.length, failed: failedSessions.length },
      'Recovery status reported successfully'
    )
  );
});
```

### 1.1.4 Recovery Status Handler

**File:** `src/services/worker.service.js`

```javascript
/**
 * Handle session recovery status from worker
 * @param {string} workerId - Worker ID
 * @param {Array} recoveredSessions - Successfully recovered sessions
 * @param {Array} failedSessions - Failed to recover sessions
 */
export const handleRecoveryStatus = async (
  workerId,
  recoveredSessions,
  failedSessions
) => {
  try {
    logger.info("Processing session recovery status", {
      workerId,
      recovered: recoveredSessions.length,
      failed: failedSessions.length,
      service: "WorkerService",
    });

    // Update successfully recovered sessions
    for (const sessionData of recoveredSessions) {
      await prisma.session.update({
        where: { id: sessionData.sessionId },
        data: {
          status: sessionData.status.toUpperCase(),
          phoneNumber: sessionData.phoneNumber || null,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update Redis routing
      await redis.hset("session_routing", sessionData.sessionId, workerId);
    }

    // Handle failed recoveries
    for (const sessionData of failedSessions) {
      await prisma.session.update({
        where: { id: sessionData.sessionId },
        data: {
          status: "DISCONNECTED",
          workerId: null,
          qrCode: null,
          updatedAt: new Date(),
        },
      });

      // Remove from Redis routing
      await redis.hdel("session_routing", sessionData.sessionId);
    }

    // Update worker session count
    await updateWorkerSessionCount(workerId);

    logger.info("Session recovery status processed successfully", {
      workerId,
      recovered: recoveredSessions.length,
      failed: failedSessions.length,
      service: "WorkerService",
    });
  } catch (error) {
    logger.error("Failed to process recovery status", {
      workerId,
      error: error.message,
      service: "WorkerService",
    });
    throw error;
  }
};
```

---

# 🔄 PHASE 2: ENHANCED PUSH HEARTBEAT

## 2.1 Backend Changes Required

### 2.1.1 Enhanced Heartbeat Endpoint

**File:** `src/controllers/worker.controller.js`

```javascript
/**
 * Enhanced worker heartbeat with session data
 * Replaces simple heartbeat with comprehensive status
 */
static updateHeartbeat = asyncHandler(async (req, res) => {
  const workerId = req.params.workerId;
  const {
    status,
    metrics,
    sessions,
    capabilities,
    lastActivity
  } = req.body;

  // Validate required fields
  if (!status || !metrics) {
    return res.status(400).json(
      ApiResponse.createErrorResponse('Status and metrics are required')
    );
  }

  const heartbeatData = {
    status,
    metrics: {
      sessionCount: metrics.sessionCount || 0,
      cpuUsage: metrics.cpuUsage || 0,
      memoryUsage: metrics.memoryUsage || 0,
      uptime: metrics.uptime || 0,
      ...metrics
    },
    sessions: sessions || [],
    capabilities: capabilities || {},
    lastActivity: lastActivity || new Date().toISOString()
  };

  await WorkerService.updateWorkerHeartbeat(workerId, heartbeatData);

  return res.status(HTTP_STATUS.OK).json(
    ApiResponse.createSuccessResponse(
      { workerId, status: 'updated' },
      'Heartbeat updated successfully'
    )
  );
});
```

### 2.1.2 Enhanced Worker Service Heartbeat

**File:** `src/services/worker.service.js`

```javascript
/**
 * Enhanced worker heartbeat update with session data
 * @param {string} workerId - Worker ID
 * @param {Object} heartbeatData - Enhanced heartbeat data
 */
export const updateWorkerHeartbeat = async (workerId, heartbeatData) => {
  try {
    const { status, metrics, sessions, capabilities, lastActivity } =
      heartbeatData;

    logger.info("Processing enhanced heartbeat", {
      workerId,
      status,
      sessionCount: metrics.sessionCount,
      activeSessions: sessions.length,
      service: "WorkerService",
    });

    // Update worker record
    const worker = await prisma.worker.update({
      where: { id: workerId },
      data: {
        status: status.toUpperCase(),
        sessionCount: metrics.sessionCount,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
    });

    // Store detailed metrics
    await prisma.workerMetric.create({
      data: {
        workerId,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        sessionCount: metrics.sessionCount,
        messageCount: metrics.messageCount || 0,
        uptime: metrics.uptime || 0,
        timestamp: new Date(),
      },
    });

    // Update Redis with enhanced data
    await redis.hset(
      "workers",
      workerId,
      JSON.stringify({
        endpoint: worker.endpoint,
        status: status.toUpperCase(),
        sessionCount: metrics.sessionCount,
        sessions: sessions,
        capabilities: capabilities,
        lastHeartbeat: new Date().toISOString(),
        lastActivity: lastActivity,
      })
    );

    // Sync session statuses if provided
    if (sessions && sessions.length > 0) {
      await syncSessionStatuses(workerId, sessions);
    }

    logger.info("Enhanced heartbeat processed successfully", {
      workerId,
      status,
      sessionCount: metrics.sessionCount,
      service: "WorkerService",
    });

    return worker;
  } catch (error) {
    logger.error("Failed to update enhanced heartbeat", {
      workerId,
      error: error.message,
      service: "WorkerService",
    });
    throw error;
  }
};

/**
 * Sync session statuses from worker heartbeat
 * @param {string} workerId - Worker ID
 * @param {Array} sessions - Session status array from worker
 */
const syncSessionStatuses = async (workerId, sessions) => {
  try {
    for (const sessionData of sessions) {
      const { sessionId, status, phoneNumber, lastActivity } = sessionData;

      // Update session if status changed
      const currentSession = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { status: true, phoneNumber: true },
      });

      if (
        currentSession &&
        (currentSession.status !== status.toUpperCase() ||
          currentSession.phoneNumber !== phoneNumber)
      ) {
        await prisma.session.update({
          where: { id: sessionId },
          data: {
            status: status.toUpperCase(),
            phoneNumber: phoneNumber || null,
            lastSeenAt: lastActivity ? new Date(lastActivity) : new Date(),
            updatedAt: new Date(),
          },
        });

        // Update Redis routing
        await redis.hset("session_routing", sessionId, workerId);
      }
    }
  } catch (error) {
    logger.error("Failed to sync session statuses", {
      workerId,
      error: error.message,
      service: "WorkerService",
    });
  }
};
```

### 2.1.3 Remove Redundant Polling Logic

**File:** `src/services/worker.service.js`

```javascript
// REMOVE OR COMMENT OUT the performHealthChecks method
// This is no longer needed with enhanced push heartbeat

/*
export const performHealthChecks = async () => {
  // Remove this entire method - replaced by stale worker detection
};
*/

/**
 * Background job to detect stale workers
 * Replaces active health checking with passive monitoring
 */
export const detectStaleWorkers = async () => {
  try {
    const HEARTBEAT_TIMEOUT = 90000; // 90 seconds (3x heartbeat interval)
    const staleThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT);

    const staleWorkers = await prisma.worker.findMany({
      where: {
        status: "ONLINE",
        lastHeartbeat: {
          lt: staleThreshold,
        },
      },
      include: {
        sessions: {
          where: {
            status: {
              in: ["CONNECTED", "QR_REQUIRED", "INIT", "RECONNECTING"],
            },
          },
        },
      },
    });

    for (const worker of staleWorkers) {
      logger.warn("Detected stale worker", {
        workerId: worker.id,
        lastHeartbeat: worker.lastHeartbeat,
        sessionCount: worker.sessions.length,
        service: "WorkerService",
      });

      await markWorkerOffline(worker.id);
    }

    if (staleWorkers.length > 0) {
      logger.info("Stale worker detection completed", {
        staleCount: staleWorkers.length,
        service: "WorkerService",
      });
    }
  } catch (error) {
    logger.error("Failed to detect stale workers", {
      error: error.message,
      service: "WorkerService",
    });
  }
};

// Start stale worker detection (replace health check interval)
setInterval(detectStaleWorkers, 60000); // Check every 60 seconds
```

---

# 🔄 PHASE 3: BACKEND OPTIMIZATION

## 3.1 Worker Service Cleanup

### 3.1.1 Remove Duplicate Health Check Logic

**File:** `src/services/worker.service.js`

```javascript
// Remove the constructor that starts health checking
// Replace with stale worker detection only

class WorkerService {
  // Remove this constructor:
  /*
  constructor() {
    this.startHealthChecking();
  }
  */
  // Remove this method:
  /*
  startHealthChecking() {
    setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckInterval);
  }
  */
}
```

### 3.1.2 Enhanced Worker Registration

**File:** `src/services/worker.service.js`

```javascript
/**
 * Enhanced worker registration with recovery trigger
 * @param {string} workerId - Worker ID
 * @param {string} endpoint - Worker endpoint
 * @param {number} maxSessions - Maximum sessions
 * @param {Object} capabilities - Worker capabilities
 */
export const registerWorker = async (
  workerId,
  endpoint,
  maxSessions = 50,
  capabilities = {}
) => {
  try {
    // Normalize worker ID
    const normalizedWorkerId = normalizeWorkerId(workerId);

    logger.info("Registering worker with recovery check", {
      workerId: normalizedWorkerId,
      endpoint,
      maxSessions,
      service: "WorkerService",
    });

    // Check if worker was previously registered (recovery scenario)
    const existingWorker = await prisma.worker.findUnique({
      where: { id: normalizedWorkerId },
      include: {
        sessions: {
          where: {
            status: {
              in: ["CONNECTED", "QR_REQUIRED", "INIT", "RECONNECTING"],
            },
          },
        },
      },
    });

    const isRecovery = existingWorker && existingWorker.sessions.length > 0;

    // Register or update worker
    const worker = await prisma.worker.upsert({
      where: { id: normalizedWorkerId },
      update: {
        endpoint,
        maxSessions,
        status: "ONLINE",
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
      create: {
        id: normalizedWorkerId,
        endpoint,
        maxSessions,
        status: "ONLINE",
        sessionCount: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        lastHeartbeat: new Date(),
      },
    });

    // Update Redis
    await redis.hset(
      "workers",
      normalizedWorkerId,
      JSON.stringify({
        endpoint,
        status: "ONLINE",
        sessionCount: 0,
        capabilities,
        lastHeartbeat: new Date().toISOString(),
        isRecovery,
      })
    );

    logger.info("Worker registered successfully", {
      workerId: normalizedWorkerId,
      endpoint,
      isRecovery,
      previousSessions: isRecovery ? existingWorker.sessions.length : 0,
      service: "WorkerService",
    });

    return {
      ...worker,
      isRecovery,
      previousSessions: isRecovery ? existingWorker.sessions : [],
    };
  } catch (error) {
    logger.error("Failed to register worker", {
      workerId,
      endpoint,
      error: error.message,
      service: "WorkerService",
    });
    throw error;
  }
};
```

---

# 🔧 WORKER IMPLEMENTATION REQUIREMENTS

## Worker Side Changes Required

### 1. Session Recovery on Startup

**Required Implementation:**

```javascript
// worker/src/startup.js
async function recoverSessions() {
  try {
    console.log("Starting session recovery...");

    // 1. Get assigned sessions from backend
    const response = await axios.get(
      `${BACKEND_URL}/api/admin/workers/sessions/assigned`,
      {
        headers: {
          Authorization: `Bearer ${WORKER_AUTH_TOKEN}`,
          "X-Worker-Id": WORKER_ID,
        },
      }
    );

    const { sessions } = response.data.data;
    console.log(`Found ${sessions.length} sessions to recover`);

    const recoveredSessions = [];
    const failedSessions = [];

    // 2. Attempt to recover each session
    for (const sessionData of sessions) {
      try {
        const recovered = await recoverSession(sessionData);
        if (recovered) {
          recoveredSessions.push({
            sessionId: sessionData.id,
            status: recovered.status,
            phoneNumber: recovered.phoneNumber,
          });
        } else {
          failedSessions.push({
            sessionId: sessionData.id,
            error: "Failed to load session state",
          });
        }
      } catch (error) {
        failedSessions.push({
          sessionId: sessionData.id,
          error: error.message,
        });
      }
    }

    // 3. Report recovery status to backend
    await axios.post(
      `${BACKEND_URL}/api/admin/workers/sessions/recovery-status`,
      {
        recoveredSessions,
        failedSessions,
      },
      {
        headers: {
          Authorization: `Bearer ${WORKER_AUTH_TOKEN}`,
          "X-Worker-Id": WORKER_ID,
        },
      }
    );

    console.log(
      `Session recovery completed: ${recoveredSessions.length} recovered, ${failedSessions.length} failed`
    );
  } catch (error) {
    console.error("Session recovery failed:", error);
  }
}

async function recoverSession(sessionData) {
  // Implementation depends on your session storage mechanism
  // This should load Baileys auth state and reconnect

  const sessionPath = `./sessions/${sessionData.id}`;

  // Check if session files exist
  if (!fs.existsSync(sessionPath)) {
    console.log(`No session files found for ${sessionData.id}`);
    return null;
  }

  try {
    // Load Baileys session
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
    });

    // Store session reference
    activeSessions.set(sessionData.id, {
      sock,
      userId: sessionData.userId,
      sessionName: sessionData.name,
      status: "connected",
    });

    return {
      status: "connected",
      phoneNumber: sock.user?.id?.split(":")[0] || null,
    };
  } catch (error) {
    console.error(`Failed to recover session ${sessionData.id}:`, error);
    return null;
  }
}
```

### 2. Enhanced Heartbeat Implementation

**Required Implementation:**

```javascript
// worker/src/heartbeat.js
async function sendEnhancedHeartbeat() {
  try {
    const metrics = {
      sessionCount: activeSessions.size,
      cpuUsage: getCPUUsage(),
      memoryUsage: getMemoryUsage(),
      uptime: process.uptime(),
      messageCount: getTotalMessageCount(),
    };

    const sessions = Array.from(activeSessions.entries()).map(
      ([sessionId, sessionData]) => ({
        sessionId,
        status: sessionData.status,
        phoneNumber: sessionData.phoneNumber,
        lastActivity: sessionData.lastActivity,
      })
    );

    const capabilities = {
      maxSessions: MAX_SESSIONS,
      version: WORKER_VERSION,
      features: ["qr-generation", "media-upload", "session-recovery"],
    };

    await axios.put(
      `${BACKEND_URL}/api/admin/workers/${WORKER_ID}/heartbeat`,
      {
        status: "online",
        metrics,
        sessions,
        capabilities,
        lastActivity: new Date().toISOString(),
      },
      {
        headers: {
          Authorization: `Bearer ${WORKER_AUTH_TOKEN}`,
        },
      }
    );

    console.log(`Heartbeat sent: ${sessions.length} active sessions`);
  } catch (error) {
    console.error("Failed to send heartbeat:", error);
  }
}

// Send heartbeat every 30 seconds
setInterval(sendEnhancedHeartbeat, 30000);
```

### 3. Session State Persistence

**Required Implementation:**

```javascript
// worker/src/session-manager.js
class SessionManager {
  constructor() {
    this.activeSessions = new Map();
  }

  async createSession(sessionId, userId, sessionName) {
    // Existing implementation + persistence
    const sessionPath = `./sessions/${sessionId}`;

    // Ensure session directory exists
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    // Create Baileys session with persistent auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
    });

    // Save credentials on updates
    sock.ev.on("creds.update", saveCreds);

    // Store session data
    this.activeSessions.set(sessionId, {
      sock,
      userId,
      sessionName,
      status: "initializing",
      createdAt: new Date(),
      lastActivity: new Date(),
    });

    return sock;
  }

  async saveSessionState(sessionId) {
    // Additional state saving if needed
    const session = this.activeSessions.get(sessionId);
    if (session) {
      const stateFile = `./sessions/${sessionId}/session-state.json`;
      const stateData = {
        userId: session.userId,
        sessionName: session.sessionName,
        status: session.status,
        phoneNumber: session.phoneNumber,
        lastActivity: session.lastActivity,
        createdAt: session.createdAt,
      };

      fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
    }
  }
}
```

---

# 📋 IMPLEMENTATION CHECKLIST

## Backend Implementation Checklist

### Phase 1: Session Recovery

- [ ] Add `GET /api/admin/workers/sessions/assigned` endpoint
- [ ] Add `POST /api/admin/workers/sessions/recovery-status` endpoint
- [ ] Implement `getAssignedSessions()` in WorkerService
- [ ] Implement `handleRecoveryStatus()` in WorkerService
- [ ] Update worker registration to detect recovery scenarios

### Phase 2: Enhanced Heartbeat

- [ ] Enhance `PUT /api/admin/workers/:workerId/heartbeat` endpoint
- [ ] Implement enhanced `updateWorkerHeartbeat()` method
- [ ] Add `syncSessionStatuses()` helper function
- [ ] Remove redundant `performHealthChecks()` method
- [ ] Implement `detectStaleWorkers()` background job

### Phase 3: Optimization

- [ ] Remove constructor health checking from WorkerService
- [ ] Update Redis data structures for enhanced data
- [ ] Add comprehensive logging for recovery operations
- [ ] Update API documentation for new endpoints

## Worker Implementation Checklist

### Session Recovery

- [ ] Implement `recoverSessions()` startup function
- [ ] Implement `recoverSession()` for individual session recovery
- [ ] Add session state persistence mechanisms
- [ ] Handle recovery failure scenarios gracefully

### Enhanced Heartbeat

- [ ] Implement `sendEnhancedHeartbeat()` function
- [ ] Add system metrics collection (CPU, memory, uptime)
- [ ] Include active session data in heartbeat
- [ ] Add worker capabilities reporting

### Session Management

- [ ] Ensure session state persistence across restarts
- [ ] Implement proper session cleanup on shutdown
- [ ] Add session activity tracking
- [ ] Handle session state corruption gracefully

---

# 🔍 TESTING PLAN

## Backend Testing

### 1. Session Recovery Testing

```bash
# Test assigned sessions endpoint
GET /api/admin/workers/sessions/assigned
Headers: Authorization: Bearer {workerToken}, X-Worker-Id: worker-001

# Test recovery status reporting
POST /api/admin/workers/sessions/recovery-status
{
  "recoveredSessions": [{"sessionId": "test-session", "status": "connected"}],
  "failedSessions": []
}
```

### 2. Enhanced Heartbeat Testing

```bash
# Test enhanced heartbeat
PUT /api/admin/workers/worker-001/heartbeat
{
  "status": "online",
  "metrics": {
    "sessionCount": 2,
    "cpuUsage": 45.2,
    "memoryUsage": 67.8,
    "uptime": 3600
  },
  "sessions": [
    {
      "sessionId": "test-session",
      "status": "connected",
      "phoneNumber": "+6281234567890"
    }
  ],
  "capabilities": {
    "maxSessions": 50,
    "version": "1.0.0"
  }
}
```

## Worker Testing

### 1. Recovery Testing

- Start worker with existing session files
- Verify worker calls backend for assigned sessions
- Verify sessions are recovered and reported back
- Test recovery failure scenarios

### 2. Heartbeat Testing

- Verify heartbeat includes session data
- Test heartbeat failure and retry logic
- Verify metrics accuracy

---

# 🚀 DEPLOYMENT PLAN

## Deployment Order

1. **Deploy Backend Changes First**
   - New endpoints for session recovery
   - Enhanced heartbeat processing
   - Stale worker detection

2. **Update Worker Implementation**
   - Session recovery on startup
   - Enhanced heartbeat sending
   - Session state persistence

3. **Test End-to-End Flow**
   - Worker restart with session recovery
   - Enhanced heartbeat monitoring
   - Stale worker detection

## Rollback Plan

- Keep old heartbeat endpoint active during transition
- Gradual worker updates with feature flags
- Monitor logs for recovery success rates

---

# 📊 SUCCESS METRICS

## Recovery Success Metrics

- **Session Recovery Rate**: >90% of sessions should recover successfully
- **Recovery Time**: Sessions should recover within 30 seconds of worker startup
- **Data Consistency**: Recovered sessions should maintain correct status and phone numbers

## Heartbeat Efficiency Metrics

- **Heartbeat Frequency**: Consistent 30-second intervals
- **Data Accuracy**: Session counts and statuses should match between worker and backend
- **Stale Detection**: Offline workers should be detected within 90 seconds

## System Performance Metrics

- **Backend CPU Usage**: Should decrease with removal of polling
- **Network Efficiency**: Fewer total HTTP requests with push-only model
- **Database Load**: Optimized queries for session recovery

---

This plan provides a comprehensive roadmap for implementing session recovery and enhanced heartbeat mechanisms. The worker AI can use this document to implement the worker-side changes while you implement the backend changes.

# Worker Session Recovery Implementation Plan

## 🎯 Overview

This document outlines the **worker-side implementation** for session recovery in the WhatsApp Gateway Worker. When a worker restarts, sessions should be automatically recovered from storage without requiring users to recreate them.

**Current Problem:**

- Worker restart → Sessions lost from memory → Users must recreate sessions
- Backend database still has session records
- MinIO storage has session authentication files
- No recovery mechanism in worker

**Solution:**

- Implement session recovery on worker startup
- Restore Baileys sessions from MinIO/local storage
- Report recovery status to backend
- Enhanced heartbeat with session data

---

## 🏗️ Architecture Overview

### Current Flow (Problematic):

```
Worker Restart → Sessions Lost → User Must Recreate Session
```

### New Flow (With Recovery):

```
Worker Startup → Get Assigned Sessions from Backend → Download Session Files from MinIO → Restore Baileys Sessions → Report Status to Backend
```

### Recovery Process Flow:

```
1. Worker starts up
2. Worker registers with backend
3. Worker calls backend: GET /api/admin/workers/sessions/assigned
4. Backend returns list of sessions assigned to this worker
5. Worker attempts to recover each session:
   a. Download session files from MinIO (if not local)
   b. Load Baileys auth state from files
   c. Create new Baileys socket with existing auth
   d. Wait for connection status
6. Worker reports recovery results to backend
7. Backend updates session statuses in database
8. Sessions are now available for use
```

---

## 📋 Implementation Plan

### Phase 1: Core Recovery Infrastructure

- Add session recovery methods to BaileysService
- Add backend communication methods to WorkerRegistryService
- Implement startup recovery flow

### Phase 2: Enhanced Heartbeat

- Include session data in heartbeat
- Track session activity and metrics
- Optimize heartbeat frequency

### Phase 3: Error Handling & Optimization

- Handle recovery failures gracefully
- Implement retry mechanisms
- Add comprehensive logging

---

# 🔧 IMPLEMENTATION DETAILS

## 1. BaileysService Enhancements

### 1.1 Add Session Recovery Methods

**File:** `src/services/baileys.service.js`

```javascript
/**
 * Load and recover sessions on worker startup
 * Called after worker registration to restore existing sessions
 */
async loadPersistedSessions() {
  try {
    logger.info("Starting session recovery process...");

    // Get assigned sessions from backend
    const assignedSessions = await global.services.workerRegistry.getAssignedSessions();

    if (!assignedSessions || assignedSessions.length === 0) {
      logger.info("No sessions assigned for recovery");
      return { recovered: 0, failed: 0 };
    }

    logger.info(`Found ${assignedSessions.length} sessions to recover`);

    const recoveredSessions = [];
    const failedSessions = [];

    // Attempt to recover each session
    for (const sessionData of assignedSessions) {
      try {
        const recovered = await this.restoreSessionFromStorage(sessionData);
        if (recovered) {
          recoveredSessions.push({
            sessionId: sessionData.id,
            status: recovered.status,
            phoneNumber: recovered.phoneNumber,
          });
          logger.info(`Successfully recovered session: ${sessionData.id}`);
        } else {
          failedSessions.push({
            sessionId: sessionData.id,
            error: "Failed to restore session state",
          });
          logger.warn(`Failed to recover session: ${sessionData.id}`);
        }
      } catch (error) {
        failedSessions.push({
          sessionId: sessionData.id,
          error: error.message,
        });
        logger.error(`Error recovering session ${sessionData.id}:`, error);
      }
    }

    // Report recovery status to backend
    await global.services.workerRegistry.reportRecoveryStatus(
      recoveredSessions,
      failedSessions
    );

    logger.info(`Session recovery completed: ${recoveredSessions.length} recovered, ${failedSessions.length} failed`);

    return {
      recovered: recoveredSessions.length,
      failed: failedSessions.length,
      details: { recoveredSessions, failedSessions }
    };
  } catch (error) {
    logger.error("Session recovery process failed:", error);
    throw error;
  }
}

/**
 * Restore individual session from storage
 * @param {Object} sessionData - Session data from backend
 * @returns {Object|null} Recovery result or null if failed
 */
async restoreSessionFromStorage(sessionData) {
  try {
    const { id: sessionId, userId, name } = sessionData;

    logger.info(`Attempting to restore session: ${sessionId}`);

    // Check if session already exists in memory
    if (this.sessions.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists in memory, skipping recovery`);
      return null;
    }

    // Try to download session files from MinIO first
    if (global.services?.storage) {
      try {
        const downloadResult = await global.services.storage.downloadSessionFiles(sessionId);
        if (downloadResult.success) {
          logger.info(`Downloaded session files from MinIO for ${sessionId}`);
        }
      } catch (error) {
        logger.warn(`Failed to download session files from MinIO for ${sessionId}:`, error);
        // Continue with local files if available
      }
    }

    // Setup auth state directory
    const authDir = join(this.storageDir, sessionId);

    // Check if local session files exist
    try {
      await fs.access(authDir);
    } catch (error) {
      logger.warn(`No local session files found for ${sessionId}`);
      return null;
    }

    // Load Baileys auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Check if auth state is valid
    if (!state.creds || !state.creds.noiseKey) {
      logger.warn(`Invalid auth state for session ${sessionId}`);
      return null;
    }

    // Create socket configuration
    const socketConfig = {
      auth: state,
      printQRInTerminal: false,
      logger: this.createBaileysLogger(),
      generateHighQualityLinkPreview: true,
      defaultQueryTimeoutMs: 60000,
    };

    const socket = makeWASocket(socketConfig);

    // Set initial session status for recovery
    this.sessionStatus.set(sessionId, {
      sessionId,
      userId,
      status: "recovering",
      createdAt: sessionData.createdAt || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isRecovered: true,
    });

    // Handle connection updates for recovered session
    socket.ev.on("connection.update", (update) => {
      this.handleRecoveredConnectionUpdate(sessionId, update).catch((error) => {
        logger.error(`Error in recovered connection update handler for ${sessionId}:`, error);
      });
    });

    // Handle credentials update
    socket.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    socket.ev.on("messages.upsert", (messageUpdate) => {
      this.handleIncomingMessages(sessionId, messageUpdate);
    });

    // Handle message updates
    socket.ev.on("messages.update", (messageUpdate) => {
      this.handleMessageUpdates(sessionId, messageUpdate);
    });

    // Store socket reference
    this.sessions.set(sessionId, socket);

    logger.info(`Session ${sessionId} restored from storage successfully`);

    // Wait a moment to see if connection establishes
    await new Promise(resolve => setTimeout(resolve, 2000));

    const sessionStatus = this.sessionStatus.get(sessionId);
    return {
      status: sessionStatus?.status || "recovering",
      phoneNumber: sessionStatus?.phoneNumber || null,
    };
  } catch (error) {
    logger.error(`Failed to restore session ${sessionData.id} from storage:`, error);

    // Clean up on failure
    this.sessions.delete(sessionData.id);
    this.sessionStatus.delete(sessionData.id);

    return null;
  }
}

/**
 * Handle connection updates for recovered sessions
 * Similar to handleConnectionUpdate but for recovery scenarios
 */
async handleRecoveredConnectionUpdate(sessionId, update) {
  const { connection, lastDisconnect, qr } = update;

  logger.info(`Recovered session connection update for ${sessionId}:`, {
    connection,
    lastDisconnect: lastDisconnect?.error?.message,
  });

  try {
    if (qr) {
      // For recovered sessions, QR code means auth expired
      logger.warn(`Recovered session ${sessionId} requires new QR code - auth expired`);

      this.updateSessionStatus(sessionId, {
        status: "qr_required",
        qrCode: qr,
        recoveryFailed: true,
        reason: "auth_expired",
      });

      // Notify backend that recovery failed due to expired auth
      await this.notifyBackend("recovery_failed", sessionId, {
        reason: "auth_expired",
        qrCode: qr,
      });
    } else if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        logger.info(`Recovered session ${sessionId} disconnected, attempting reconnection`);

        this.updateSessionStatus(sessionId, {
          status: "reconnecting",
          lastDisconnect: lastDisconnect?.error?.message,
        });

        // Attempt reconnection
        setTimeout(() => {
          this.reconnectSession(sessionId).catch((error) => {
            logger.error(`Reconnection failed for recovered session ${sessionId}:`, error);
          });
        }, 5000);
      } else {
        logger.warn(`Recovered session ${sessionId} logged out`);

        this.updateSessionStatus(sessionId, {
          status: "logged_out",
          recoveryFailed: true,
          reason: "logged_out",
        });

        await this.notifyBackend("recovery_failed", sessionId, {
          reason: "logged_out",
        });
      }
    } else if (connection === "open") {
      const socket = this.sessions.get(sessionId);
      const phoneNumber = socket?.user?.id;

      logger.info(`Recovered session ${sessionId} connected successfully`);

      this.updateSessionStatus(sessionId, {
        status: "connected",
        phoneNumber,
        connectedAt: new Date().toISOString(),
        recoverySuccessful: true,
      });

      // Clear any recovery flags
      this.qrCodes.delete(sessionId);
      this.qrAttempts.delete(sessionId);

      // Notify backend about successful recovery
      await this.notifyBackend("recovery_successful", sessionId, {
        phoneNumber,
      });

      // Upload session files to storage after successful recovery
      if (global.services?.storage) {
        try {
          await global.services.storage.uploadSessionFiles(sessionId);
          logger.info(`Session files uploaded for recovered session ${sessionId}`);
        } catch (error) {
          logger.error(`Failed to upload session files for recovered session ${sessionId}:`, error);
        }
      }
    }
  } catch (error) {
    logger.error(`Error handling recovered connection update for ${sessionId}:`, error);
  }
}

/**
 * Get session data for heartbeat
 * Returns current session statuses for heartbeat reporting
 */
getSessionDataForHeartbeat() {
  const sessions = [];

  for (const [sessionId, sessionInfo] of this.sessionStatus) {
    sessions.push({
      sessionId,
      status: sessionInfo.status,
      phoneNumber: sessionInfo.phoneNumber || null,
      lastActivity: sessionInfo.lastSeen,
      isRecovered: sessionInfo.isRecovered || false,
      userId: sessionInfo.userId,
    });
  }

  return sessions;
}

/**
 * Get session statistics for monitoring
 */
getRecoveryStatistics() {
  const stats = {
    total: 0,
    recovered: 0,
    connected: 0,
    failed: 0,
    qr_required: 0,
  };

  for (const [, sessionInfo] of this.sessionStatus) {
    stats.total++;

    if (sessionInfo.isRecovered) {
      stats.recovered++;
    }

    switch (sessionInfo.status) {
      case "connected":
        stats.connected++;
        break;
      case "qr_required":
        stats.qr_required++;
        break;
      case "failed":
      case "logged_out":
        stats.failed++;
        break;
    }
  }

  return stats;
}
```

## 2. WorkerRegistryService Enhancements

### 2.1 Add Backend Communication Methods

**File:** `src/services/worker-registry.service.js`

```javascript
/**
 * Get sessions assigned to this worker for recovery
 * Called on worker startup to get list of sessions to recover
 */
async getAssignedSessions() {
  try {
    logger.info("Getting assigned sessions from backend for recovery", {
      workerId: this.workerId,
      service: "WorkerRegistryService",
    });

    const response = await axios.get(
      `${this.backendUrl}/api/admin/workers/sessions/assigned`,
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "X-Worker-Id": this.workerId,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const { sessions } = response.data.data;

    logger.info("Retrieved assigned sessions for recovery", {
      workerId: this.workerId,
      sessionCount: sessions.length,
      sessions: sessions.map(s => ({ id: s.id, status: s.status })),
      service: "WorkerRegistryService",
    });

    return sessions;
  } catch (error) {
    if (error.response?.status === 404) {
      logger.info("No assigned sessions found for recovery", {
        workerId: this.workerId,
        service: "WorkerRegistryService",
      });
      return [];
    }

    logger.error("Failed to get assigned sessions for recovery", {
      workerId: this.workerId,
      error: error.message,
      status: error.response?.status,
      service: "WorkerRegistryService",
    });

    // Don't throw error - allow worker to start without recovery
    return [];
  }
}

/**
 * Report session recovery status to backend
 * Called after attempting to recover sessions
 */
async reportRecoveryStatus(recoveredSessions, failedSessions) {
  try {
    logger.info("Reporting session recovery status to backend", {
      workerId: this.workerId,
      recovered: recoveredSessions.length,
      failed: failedSessions.length,
      service: "WorkerRegistryService",
    });

    const response = await axios.post(
      `${this.backendUrl}/api/admin/workers/sessions/recovery-status`,
      {
        recoveredSessions,
        failedSessions,
      },
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "X-Worker-Id": this.workerId,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    logger.info("Recovery status reported successfully", {
      workerId: this.workerId,
      recovered: recoveredSessions.length,
      failed: failedSessions.length,
      service: "WorkerRegistryService",
    });

    return response.data;
  } catch (error) {
    logger.error("Failed to report recovery status", {
      workerId: this.workerId,
      error: error.message,
      status: error.response?.status,
      service: "WorkerRegistryService",
    });

    // Don't throw error - recovery status reporting is not critical
    return null;
  }
}

/**
 * Enhanced heartbeat with session data
 * Replaces simple heartbeat with comprehensive status
 */
async sendEnhancedHeartbeat() {
  try {
    const metrics = await this.getWorkerMetrics();
    const sessions = global.services?.baileys?.getSessionDataForHeartbeat() || [];
    const recoveryStats = global.services?.baileys?.getRecoveryStatistics() || {};

    const heartbeatData = {
      status: "online",
      metrics: {
        sessionCount: sessions.length,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        uptime: metrics.uptime,
        messageCount: metrics.messageCount || 0,
      },
      sessions,
      capabilities: {
        maxSessions: this.maxSessions,
        version: process.env.WORKER_VERSION || "1.0.0",
        features: ["qr-generation", "media-upload", "session-recovery"],
      },
      recoveryStats,
      lastActivity: new Date().toISOString(),
    };

    await axios.put(
      `${this.backendUrl}/api/admin/workers/${this.workerId}/heartbeat`,
      heartbeatData,
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    logger.debug("Enhanced heartbeat sent successfully", {
      workerId: this.workerId,
      sessionCount: sessions.length,
      recoveryStats,
      service: "WorkerRegistryService",
    });
  } catch (error) {
    logger.error("Failed to send enhanced heartbeat", {
      workerId: this.workerId,
      error: error.message,
      service: "WorkerRegistryService",
    });
  }
}

/**
 * Start enhanced heartbeat interval
 * Replaces simple heartbeat with session data
 */
startEnhancedHeartbeat() {
  // Clear existing heartbeat if any
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
  }

  // Start enhanced heartbeat every 30 seconds
  this.heartbeatInterval = setInterval(async () => {
    await this.sendEnhancedHeartbeat();
  }, 30000);

  logger.info("Enhanced heartbeat started", {
    workerId: this.workerId,
    interval: "30 seconds",
    service: "WorkerRegistryService",
  });
}

/**
 * Enhanced worker registration with recovery detection
 */
async registerWorker() {
  try {
    logger.info("Registering worker with backend", {
      workerId: this.workerId,
      endpoint: this.workerEndpoint,
      maxSessions: this.maxSessions,
      service: "WorkerRegistryService",
    });

    const response = await axios.post(
      `${this.backendUrl}/api/admin/workers/register`,
      {
        workerId: this.workerId,
        endpoint: this.workerEndpoint,
        maxSessions: this.maxSessions,
        status: "online",
        capabilities: {
          version: process.env.WORKER_VERSION || "1.0.0",
          features: ["qr-generation", "media-upload", "session-recovery"],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const registrationData = response.data.data;
    const isRecovery = registrationData.isRecovery || false;

    logger.info("Worker registered successfully", {
      workerId: this.workerId,
      isRecovery,
      previousSessions: registrationData.previousSessions?.length || 0,
      service: "WorkerRegistryService",
    });

    // Start enhanced heartbeat
    this.startEnhancedHeartbeat();

    return {
      ...registrationData,
      isRecovery,
    };
  } catch (error) {
    logger.error("Failed to register worker", {
      workerId: this.workerId,
      error: error.message,
      status: error.response?.status,
      service: "WorkerRegistryService",
    });
    throw error;
  }
}
```

## 3. Main Startup Flow Enhancement

### 3.1 Add Recovery to Startup Process

**File:** `src/app.js` (or main startup file)

```javascript
/**
 * Enhanced startup with session recovery
 */
async function startWorker() {
  try {
    logger.info("Starting WhatsApp Gateway Worker...");

    // 1. Initialize services
    await initializeServices();

    // 2. Start Express server
    const server = app.listen(config.port, () => {
      logger.info(`Worker server started on port ${config.port}`);
    });

    // 3. Register worker with backend
    const registrationResult =
      await global.services.workerRegistry.registerWorker();

    // 4. Perform session recovery if this is a restart
    if (
      registrationResult.isRecovery ||
      registrationResult.previousSessions?.length > 0
    ) {
      logger.info("Worker restart detected, starting session recovery...");

      try {
        const recoveryResult =
          await global.services.baileys.loadPersistedSessions();

        logger.info("Session recovery completed", {
          recovered: recoveryResult.recovered,
          failed: recoveryResult.failed,
        });
      } catch (error) {
        logger.error("Session recovery failed:", error);
        // Continue startup even if recovery fails
      }
    } else {
      logger.info("Fresh worker start, no sessions to recover");
    }

    // 5. Setup graceful shutdown
    setupGracefulShutdown(server);

    logger.info("Worker startup completed successfully");

    return server;
  } catch (error) {
    logger.error("Worker startup failed:", error);
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown with session cleanup
 */
function setupGracefulShutdown(server) {
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      // 1. Stop accepting new requests
      server.close(() => {
        logger.info("HTTP server closed");
      });

      // 2. Stop heartbeat
      if (global.services?.workerRegistry) {
        global.services.workerRegistry.stopHeartbeat();
      }

      // 3. Upload session files to storage before shutdown
      if (global.services?.baileys && global.services?.storage) {
        const sessions = global.services.baileys.getAllSessions();

        for (const [sessionId] of sessions) {
          try {
            await global.services.storage.uploadSessionFiles(sessionId);
            logger.info(
              `Session files uploaded for ${sessionId} before shutdown`
            );
          } catch (error) {
            logger.error(
              `Failed to upload session files for ${sessionId}:`,
              error
            );
          }
        }
      }

      // 4. Close all sessions gracefully (without logout to preserve auth)
      if (global.services?.baileys) {
        const sessions = global.services.baileys.getAllSessions();

        for (const [sessionId] of sessions) {
          try {
            await global.services.baileys.disconnectSession(sessionId);
            logger.info(`Session ${sessionId} disconnected gracefully`);
          } catch (error) {
            logger.error(`Failed to disconnect session ${sessionId}:`, error);
          }
        }
      }

      // 5. Close storage connections
      if (global.services?.storage) {
        await global.services.storage.close();
      }

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Start the worker
startWorker().catch((error) => {
  logger.error("Failed to start worker:", error);
  process.exit(1);
});
```

## 4. Configuration Updates

### 4.1 Environment Variables

**File:** `.env.example`

```bash
# Session Recovery Configuration
ENABLE_SESSION_RECOVERY=true
RECOVERY_TIMEOUT=30000
MAX_RECOVERY_ATTEMPTS=3

# Enhanced Heartbeat Configuration
HEARTBEAT_INTERVAL=30000
HEARTBEAT_TIMEOUT=10000
INCLUDE_SESSION_DATA=true

# Worker Identification
WORKER_VERSION=1.0.0
WORKER_FEATURES=qr-generation,media-upload,session-recovery
```

### 4.2 Configuration File Updates

**File:** `src/config/environment.js`

```javascript
export default {
  // ... existing config ...

  recovery: {
    enabled: process.env.ENABLE_SESSION_RECOVERY === "true",
    timeout: parseInt(process.env.RECOVERY_TIMEOUT) || 30000,
    maxAttempts: parseInt(process.env.MAX_RECOVERY_ATTEMPTS) || 3,
  },

  heartbeat: {
    interval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
    timeout: parseInt(process.env.HEARTBEAT_TIMEOUT) || 10000,
    includeSessionData: process.env.INCLUDE_SESSION_DATA === "true",
  },

  worker: {
    version: process.env.WORKER_VERSION || "1.0.0",
    features: process.env.WORKER_FEATURES?.split(",") || [
      "qr-generation",
      "media-upload",
    ],
  },
};
```

---

# 📋 IMPLEMENTATION CHECKLIST

## Core Recovery Implementation

- [ ] Add `loadPersistedSessions()` method to BaileysService
- [ ] Add `restoreSessionFromStorage()` method to BaileysService
- [ ] Add `handleRecoveredConnectionUpdate()` method to BaileysService
- [ ] Add `getSessionDataForHeartbeat()` method to BaileysService
- [ ] Add `getRecoveryStatistics()` method to BaileysService

## Backend Communication

- [ ] Add `getAssignedSessions()` method to WorkerRegistryService
- [ ] Add `reportRecoveryStatus()` method to WorkerRegistryService
- [ ] Add `sendEnhancedHeartbeat()` method to WorkerRegistryService
- [ ] Add `startEnhancedHeartbeat()` method to WorkerRegistryService
- [ ] Update `registerWorker()` method to detect recovery scenarios

## Startup Flow

- [ ] Update main startup to call session recovery after registration
- [ ] Add graceful shutdown with session state preservation
- [ ] Add configuration for recovery settings
- [ ] Add environment variables for recovery features

## Error Handling

- [ ] Handle recovery failures gracefully
- [ ] Add retry mechanisms for failed recoveries
- [ ] Add comprehensive logging for recovery process
- [ ] Handle network failures during recovery

## Testing

- [ ] Test worker restart with existing sessions
- [ ] Test recovery with expired auth (QR required)
- [ ] Test recovery with logged out sessions
- [ ] Test enhanced heartbeat with session data
- [ ] Test graceful shutdown and session preservation

---

# 🔍 TESTING PLAN

## Manual Testing

### 1. Session Recovery Testing

```bash
# 1. Create a session and connect it
POST /session/create
{
  "sessionId": "test-recovery",
  "userId": "user123"
}

# 2. Scan QR and connect session
# 3. Verify session is connected
GET /session/test-recovery/status

# 4. Stop worker (Ctrl+C or kill process)
# 5. Start worker again
# 6. Check if session is recovered automatically
GET /session/test-recovery/status

# Expected: Session should be "connected" without requiring new QR
```

### 2. Recovery Failure Testing

```bash
# 1. Create and connect session
# 2. Manually delete session auth files
rm -rf storage/sessions/test-recovery/

# 3. Restart worker
# 4. Check recovery status
GET /health

# Expected: Session should be marked as failed recovery
```

### 3. Enhanced Heartbeat Testing

```bash
# Monitor backend logs for enhanced heartbeat data
# Should include session information every 30 seconds
```

## Automated Testing

### Unit Tests

```javascript
// Test session recovery methods
describe("Session Recovery", () => {
  test("should recover connected session", async () => {
    // Mock session data and auth files
    // Call restoreSessionFromStorage
    // Verify session is restored
  });

  test("should handle recovery failure gracefully", async () => {
    // Mock missing auth files
    // Call restoreSessionFromStorage
    // Verify failure is handled properly
  });
});
```

---

# 🚀 DEPLOYMENT PLAN

## Deployment Steps

1. **Update Worker Code**
   - Deploy new recovery methods
   - Update configuration
   - Test in staging environment

2. **Gradual Rollout**
   - Deploy to one worker instance first
   - Monitor recovery success rate
   - Deploy to remaining workers

3. **Monitoring**
   - Monitor recovery success rates
   - Check enhanced heartbeat data
   - Verify session persistence

## Rollback Plan

- Keep old startup flow as fallback
- Feature flag for session recovery
- Monitor logs for recovery failures
- Quick rollback if issues detected

---

# 📊 SUCCESS METRICS

## Recovery Performance

- **Recovery Success Rate**: >90% of sessions should recover successfully
- **Recovery Time**: Sessions should recover within 30 seconds of worker startup
- **Data Consistency**: Recovered sessions should maintain correct status and phone numbers

## System Performance

- **Worker Startup Time**: Should not increase significantly with recovery
- **Memory Usage**: Recovered sessions should use same memory as new sessions
- **Heartbeat Efficiency**: Enhanced heartbeat should provide better monitoring

## User Experience

- **Zero Downtime**: Users should not need to recreate sessions after worker restart
- **Transparent Recovery**: Recovery should be invisible to end users
- **Error Handling**: Failed recoveries should be handled gracefully

---

This implementation plan provides a comprehensive roadmap for adding session recovery to the WhatsApp Gateway Worker. The recovery process ensures sessions survive worker restarts, providing a better user experience and system reliability.

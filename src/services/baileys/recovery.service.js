import { join } from "path";
import fs from "fs/promises";
import logger from "../../utils/logger.js";

let sessionManagement;
let workerRegistryService;
let storageService;

const setServices = (services) => {
  sessionManagement = services.sessionManagement;
  workerRegistryService = services.workerRegistry;
  storageService = services.storage;
};

const loadPersistedSessions = async () => {
  try {
    logger.info("Loading persisted sessions...");

    // Get assigned sessions from backend
    const assignedSessions = await getAssignedSessionsFromBackend();

    if (!assignedSessions || assignedSessions.length === 0) {
      logger.info("No assigned sessions found from backend");
      return { success: true, recovered: 0 };
    }

    logger.info(
      `Found ${assignedSessions.length} assigned sessions from backend`
    );

    let recoveredCount = 0;
    const recoveryPromises = [];

    for (const sessionData of assignedSessions) {
      const { sessionId, userId } = sessionData;

      logger.info(
        `Attempting to recover session: ${sessionId} for user: ${userId}`
      );

      const recoveryPromise = recoverSession(sessionId, userId)
        .then(() => {
          recoveredCount++;
          logger.info(`Successfully recovered session: ${sessionId}`);
        })
        .catch((error) => {
          logger.error(`Failed to recover session ${sessionId}:`, error);
        });

      recoveryPromises.push(recoveryPromise);
    }

    // Wait for all recovery attempts to complete
    await Promise.allSettled(recoveryPromises);

    logger.info(
      `Session recovery completed. Recovered: ${recoveredCount}/${assignedSessions.length}`
    );

    return {
      success: true,
      total: assignedSessions.length,
      recovered: recoveredCount,
      failed: assignedSessions.length - recoveredCount,
    };
  } catch (error) {
    logger.error("Failed to load persisted sessions:", error);
    return {
      success: false,
      error: error.message,
      recovered: 0,
    };
  }
};

const recoverSession = async (sessionId, userId) => {
  try {
    logger.info(`Starting recovery for session: ${sessionId}`);

    // Check if session already exists
    if (sessionManagement.sessions.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists, skipping recovery`);
      return { success: true, message: "Session already exists" };
    }

    // Try to restore session files from storage
    const storageRestored = await restoreSessionFromStorage(sessionId);

    if (!storageRestored) {
      logger.warn(
        `No storage files found for session ${sessionId}, will require new authentication`
      );
    }

    // Create session with recovery flag
    const result = await sessionManagement.createSession(sessionId, userId, {
      isRecovery: true,
    });

    logger.info(`Session recovery initiated for ${sessionId}`);
    return result;
  } catch (error) {
    logger.error(`Failed to recover session ${sessionId}:`, error);
    throw error;
  }
};

const restoreSessionFromStorage = async (sessionId) => {
  try {
    logger.info(
      `Attempting to restore session files from storage for: ${sessionId}`
    );

    if (!storageService) {
      logger.warn("Storage service not available, skipping file restoration");
      return false;
    }

    // Check if local session files exist
    const localSessionPath = join(sessionManagement.storageDir, sessionId);

    try {
      await fs.access(localSessionPath);
      const files = await fs.readdir(localSessionPath);

      if (files.length > 0) {
        logger.info(
          `Local session files already exist for ${sessionId}, skipping download`
        );
        return true;
      }
    } catch (error) {
      // Local files don't exist, try to download from MinIO
      logger.info(
        `Local session files not found for ${sessionId}, attempting download from MinIO`
      );
    }

    // Download session files from MinIO
    const downloadResult = await storageService.downloadSessionFiles(sessionId);

    if (downloadResult.success) {
      logger.info(
        `Successfully restored session files from storage for ${sessionId}`
      );
      return true;
    } else {
      logger.warn(
        `Failed to restore session files from storage for ${sessionId}`
      );
      return false;
    }
  } catch (error) {
    logger.error(`Error restoring session files for ${sessionId}:`, error);
    return false;
  }
};

const getAssignedSessionsFromBackend = async () => {
  try {
    if (!workerRegistryService) {
      logger.warn("Worker registry service not available");
      return [];
    }

    logger.info("Fetching assigned sessions from backend...");

    const workerId = process.env.WORKER_ID || `worker-${Date.now()}`;
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

    const response = await fetch(
      `${backendUrl}/api/workers/${workerId}/sessions/assigned`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        logger.info("No assigned sessions found (404 response)");
        return [];
      }
      throw new Error(
        `Backend request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Backend returned error: ${data.error}`);
    }

    const sessions = data.data?.sessions || [];
    logger.info(`Backend returned ${sessions.length} assigned sessions`);

    return sessions;
  } catch (error) {
    logger.error("Failed to fetch assigned sessions from backend:", error);
    return [];
  }
};

const backupSessionToStorage = async (sessionId) => {
  try {
    if (!storageService) {
      logger.warn(
        `Storage service not available, skipping backup for ${sessionId}`
      );
      return { success: false, error: "Storage service not available" };
    }

    logger.info(`Backing up session files to storage for: ${sessionId}`);

    const result = await storageService.uploadSessionFiles(sessionId);

    if (result.success) {
      logger.info(`Successfully backed up session files for ${sessionId}`);
    } else {
      logger.error(`Failed to backup session files for ${sessionId}`);
    }

    return result;
  } catch (error) {
    logger.error(`Error backing up session files for ${sessionId}:`, error);
    return { success: false, error: error.message };
  }
};

const cleanupSessionStorage = async (sessionId) => {
  try {
    logger.info(`Cleaning up storage for session: ${sessionId}`);

    // Clean up local files
    const localSessionPath = join(sessionManagement.storageDir, sessionId);

    try {
      await fs.access(localSessionPath);
      const files = await fs.readdir(localSessionPath);

      for (const file of files) {
        const filePath = join(localSessionPath, file);
        await fs.unlink(filePath);
        logger.debug(`Deleted local file: ${filePath}`);
      }

      await fs.rmdir(localSessionPath);
      logger.info(`Local session directory deleted: ${localSessionPath}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(`Local session directory not found: ${localSessionPath}`);
      }
    }

    // Clean up MinIO storage
    if (storageService) {
      try {
        const result = await storageService.deleteSessionFiles(sessionId);
        if (result.success) {
          logger.info(`MinIO storage cleaned up for ${sessionId}`);
        } else {
          logger.warn(`Failed to cleanup MinIO storage for ${sessionId}`);
        }
      } catch (error) {
        logger.error(
          `Error cleaning up MinIO storage for ${sessionId}:`,
          error
        );
      }
    }

    return { success: true };
  } catch (error) {
    logger.error(`Failed to cleanup session storage for ${sessionId}:`, error);
    return { success: false, error: error.message };
  }
};

const validateSessionFiles = async (sessionId) => {
  try {
    const localSessionPath = join(sessionManagement.storageDir, sessionId);

    // Check if directory exists
    try {
      await fs.access(localSessionPath);
    } catch (error) {
      return { valid: false, reason: "Session directory not found" };
    }

    // Check for required files
    const files = await fs.readdir(localSessionPath);
    const requiredFiles = ["creds.json"];

    for (const requiredFile of requiredFiles) {
      if (!files.includes(requiredFile)) {
        return {
          valid: false,
          reason: `Required file missing: ${requiredFile}`,
          files: files,
        };
      }
    }

    // Validate creds.json
    try {
      const credsPath = join(localSessionPath, "creds.json");
      const credsContent = await fs.readFile(credsPath, "utf8");
      const creds = JSON.parse(credsContent);

      if (!creds.noiseKey || !creds.signedIdentityKey) {
        return {
          valid: false,
          reason: "Invalid credentials format",
          files: files,
        };
      }
    } catch (error) {
      return {
        valid: false,
        reason: `Invalid creds.json: ${error.message}`,
        files: files,
      };
    }

    return {
      valid: true,
      files: files,
      fileCount: files.length,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Validation error: ${error.message}`,
    };
  }
};

const getRecoveryStatistics = () => {
  const stats = {
    totalSessions: sessionManagement.getSessionCount(),
    connectedSessions: sessionManagement.getConnectedSessionCount(),
    sessionsByStatus: sessionManagement.getSessionsByStatus(),
    recoveryCapable: 0,
    requiresAuth: 0,
  };

  // Count sessions that can be recovered vs need new auth
  for (const [sessionId] of sessionManagement.sessionStatus) {
    const validation = validateSessionFiles(sessionId);
    if (validation.valid) {
      stats.recoveryCapable++;
    } else {
      stats.requiresAuth++;
    }
  }

  return stats;
};

const performHealthCheck = async () => {
  try {
    const stats = getRecoveryStatistics();
    const backendConnected = await testBackendConnection();
    const storageConnected = await testStorageConnection();

    return {
      healthy: true,
      timestamp: new Date().toISOString(),
      statistics: stats,
      connections: {
        backend: backendConnected,
        storage: storageConnected,
      },
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
};

const testBackendConnection = async () => {
  try {
    if (!workerRegistryService) {
      return { connected: false, reason: "Service not available" };
    }

    const workerId = process.env.WORKER_ID || `worker-${Date.now()}`;
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

    const response = await fetch(
      `${backendUrl}/api/workers/${workerId}/health`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
        },
        timeout: 5000,
      }
    );

    return {
      connected: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
};

const testStorageConnection = async () => {
  try {
    if (!storageService) {
      return { connected: false, reason: "Service not available" };
    }

    // Test MinIO connection by listing buckets or checking health
    // This is a placeholder - actual implementation depends on storage service
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
};

export default {
  setServices,
  loadPersistedSessions,
  recoverSession,
  restoreSessionFromStorage,
  getAssignedSessionsFromBackend,
  backupSessionToStorage,
  cleanupSessionStorage,
  validateSessionFiles,
  getRecoveryStatistics,
  performHealthCheck,
  testBackendConnection,
  testStorageConnection,
};

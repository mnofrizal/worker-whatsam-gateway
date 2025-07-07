# Session Recovery Implementation

## Overview

The WhatsApp Gateway Worker now includes comprehensive session recovery functionality that ensures sessions persist across worker restarts, providing high availability and reliability for WhatsApp connections.

## How It Works

### Session Persistence

1. **Active Session Monitoring**: All active sessions are continuously monitored
2. **Storage Backup**: Session authentication files are backed up to MinIO storage
3. **Database Tracking**: Session metadata is stored in the database
4. **Graceful Shutdown**: Sessions are preserved before worker shutdown

### Recovery Process

1. **Worker Startup**: After worker registration with backend
2. **Session Discovery**: Retrieve assigned sessions from backend
3. **Storage Restoration**: Download session files from MinIO
4. **Connection Restoration**: Re-establish WhatsApp connections
5. **Status Reporting**: Report recovery results to backend

## Configuration

### Environment Variables

```bash
# Session Recovery Configuration
SESSION_RECOVERY_ENABLED=true                    # Enable/disable recovery
SESSION_RECOVERY_STARTUP_DELAY=5000             # Delay before starting recovery (ms)
SESSION_RECOVERY_TIMEOUT=30000                  # Recovery timeout per session (ms)
SESSION_RECOVERY_MAX_RETRIES=3                  # Max retry attempts per session
SESSION_RECOVERY_RETRY_DELAY=5000               # Delay between retries (ms)
SESSION_PRESERVE_ON_SHUTDOWN=true               # Preserve sessions on shutdown
GRACEFUL_SHUTDOWN_TIMEOUT=10000                 # Graceful shutdown timeout (ms)
```

## Implementation Details

### Core Components

#### 1. BaileysService Recovery Methods

```javascript
// Main recovery orchestrator
async loadPersistedSessions()

// Get assigned sessions from backend
async getAssignedSessionsFromBackend()

// Restore individual session
async restoreSessionFromStorage(sessionData)

// Handle recovered session connections
async handleRecoveredConnectionUpdate(sessionId, update)

// Preserve sessions before shutdown
async preserveSessionsForShutdown()

// Report recovery status to backend
async reportRecoveryStatus(results)
```

#### 2. WorkerRegistryService Integration

```javascript
// Get sessions assigned to this worker
async getAssignedSessions()

// Report recovery results
async reportRecoveryStatus(results)

// Notify about preserved sessions
async notifySessionsPreserved(sessionIds)
```

### Recovery Flow

1. **Worker Startup** → Register with backend → Get assigned sessions
2. **Session Discovery** → Download session files from MinIO storage
3. **Connection Restoration** → Re-establish Baileys WhatsApp connections
4. **Status Reporting** → Report recovery results to backend
5. **Graceful Shutdown** → Preserve active sessions → Notify backend

## Testing

### Automated Testing

Run the session recovery test script:

```bash
node test-session-recovery.js
```

### Manual Testing

1. **Start Worker**: `npm start`
2. **Create Session**: Use API to create a WhatsApp session
3. **Scan QR Code**: Connect the session to WhatsApp
4. **Stop Worker**: `Ctrl+C` or `docker stop`
5. **Restart Worker**: `npm start`
6. **Verify Recovery**: Check that session is automatically restored

## Troubleshooting

### Common Issues

1. **Sessions Not Recovering**
   - Check if `SESSION_RECOVERY_ENABLED=true`
   - Verify backend connectivity
   - Check MinIO storage accessibility

2. **Recovery Timeout**
   - Increase `SESSION_RECOVERY_TIMEOUT`
   - Check network connectivity to WhatsApp servers
   - Verify session files integrity

3. **Storage Errors**
   - Verify MinIO credentials and connectivity
   - Check bucket permissions
   - Ensure sufficient storage space

### Debug Mode

Enable debug logging for detailed recovery information:

```bash
LOG_LEVEL=debug SESSION_RECOVERY_ENABLED=true npm start
```

## Best Practices

1. **Regular Backups**: Ensure MinIO storage is regularly backed up
2. **Monitoring**: Monitor recovery success rates and failure patterns
3. **Timeout Configuration**: Adjust timeouts based on network conditions
4. **Graceful Shutdowns**: Always use SIGTERM for graceful shutdowns
5. **Health Checks**: Implement health checks to detect failed recoveries

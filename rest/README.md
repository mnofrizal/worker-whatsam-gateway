# WhatsApp Gateway Worker - REST API Testing Guide

This directory contains REST files for testing the WhatsApp Gateway Worker integration with the backend.

## 📋 Prerequisites

### Required Tools

- **VS Code** with **REST Client** extension installed
- **Worker Service** running on `http://localhost:8001`
- **Backend Service** running on `http://localhost:8000` (optional for standalone testing)

### Environment Setup

1. Start the worker service:

   ```bash
   npm start
   # or
   npm run dev
   ```

2. Update variables in `worker.rest`:
   ```http
   @baseUrl = http://localhost:8001
   @backendUrl = http://localhost:8000
   @authToken = your-backend-auth-token
   ```

## 🧪 Test Categories

### 1. **Worker Health & Metrics** (Tests 1-2)

- Health check endpoint
- Performance metrics
- Resource usage monitoring

### 2. **Session Management** (Tests 3-10)

- Create WhatsApp sessions
- Get session status and QR codes
- Send text and media messages
- Message history retrieval
- Session cleanup

### 3. **Backend Integration** (Tests 11-19)

- Worker registration with backend
- Heartbeat mechanism
- Webhook notifications
- Worker management endpoints

### 4. **Bulk Operations** (Tests 20-21)

- Multiple session creation
- Bulk message sending
- Load testing scenarios

### 5. **Error Handling** (Tests 22-24)

- Invalid session IDs
- Malformed requests
- Error response validation

### 6. **Monitoring** (Tests 25-28)

- Continuous health monitoring
- Performance tracking
- Session list monitoring

## 🚀 Testing Workflow

### Standalone Worker Testing

1. **Health Check**: Run test #1 to verify worker is running
2. **Create Session**: Run test #3 to create a test session
3. **Get QR Code**: Run test #5 to get QR for WhatsApp scanning
4. **Send Message**: Run test #6 after QR is scanned
5. **Cleanup**: Run test #9 to delete test session

### Backend Integration Testing

1. **Register Worker**: Run test #11 to register with backend
2. **Send Heartbeat**: Run test #12 to test health reporting
3. **Session Webhooks**: Run tests #13-15 to test status reporting
4. **Worker Management**: Run tests #16-19 to test CRUD operations

### Load Testing

1. **Create Multiple Sessions**: Run tests #20
2. **Bulk Messages**: Run tests #21
3. **Rapid Status Checks**: Run tests #25
4. **Monitor Performance**: Run tests #26-28

## 📊 Expected Responses

### Successful Health Check

```json
{
  "status": "healthy",
  "workerId": "worker-001",
  "uptime": 3600,
  "sessions": {
    "total": 0,
    "connected": 0,
    "disconnected": 0
  },
  "resources": {
    "cpuUsage": 45.5,
    "memoryUsage": 67.8
  }
}
```

### Session Creation Success

```json
{
  "success": true,
  "data": {
    "sessionId": "user123-session1",
    "status": "initializing",
    "message": "Session created successfully"
  }
}
```

### QR Code Response

```json
{
  "success": true,
  "data": {
    "sessionId": "user123-session1",
    "status": "qr_required",
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "expiresAt": "2024-01-15T10:32:00Z"
  }
}
```

### Message Send Success

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

## 🔧 Configuration Variables

Update these variables in `worker.rest` based on your setup:

```http
# Local Development
@baseUrl = http://localhost:8001
@backendUrl = http://localhost:8000

# Docker Setup
@baseUrl = http://worker:8001
@backendUrl = http://backend:8000

# Production
@baseUrl = https://worker.yourdomain.com
@backendUrl = https://api.yourdomain.com

# Authentication
@authToken = your-backend-jwt-token
@workerId = worker-001
@sessionId = user123-session1
@userId = user123
```

## 🐛 Troubleshooting

### Common Issues

1. **Connection Refused**
   - Verify worker service is running
   - Check port configuration (default: 8001)

2. **Authentication Errors**
   - Update `@authToken` with valid backend token
   - Verify token format: `Bearer your-token`

3. **Session Not Found**
   - Create session first (test #3)
   - Use correct `sessionId` in subsequent tests

4. **QR Code Timeout**
   - QR codes expire after 2 minutes
   - Generate new QR if expired

5. **Backend Integration Errors**
   - Verify backend service is running
   - Check backend API endpoints match specification
   - Validate authentication headers

### Debug Steps

1. **Check Worker Logs**:

   ```bash
   tail -f logs/combined.log
   ```

2. **Verify Environment**:

   ```bash
   cat .env
   ```

3. **Test Health Endpoint**:

   ```bash
   curl http://localhost:8001/health
   ```

4. **Check Database**:
   ```bash
   sqlite3 storage/worker.db ".tables"
   ```

## 📈 Performance Benchmarks

### Expected Response Times

- Health check: < 50ms
- Session creation: < 200ms
- QR generation: < 500ms
- Message sending: < 300ms
- Status queries: < 100ms

### Resource Usage

- Memory: ~50MB per session
- CPU: <5% per active session
- Storage: ~10MB per session

## 🔄 Continuous Testing

For automated testing, use these curl commands:

```bash
# Health monitoring
watch -n 5 'curl -s http://localhost:8001/health | jq'

# Session status monitoring
watch -n 2 'curl -s http://localhost:8001/session/user123-session1/status | jq'

# Performance monitoring
watch -n 10 'curl -s http://localhost:8001/metrics | jq'
```

## 📝 Test Results

Document your test results:

- [ ] Worker starts successfully
- [ ] Health endpoint responds
- [ ] Session creation works
- [ ] QR code generation works
- [ ] Message sending works
- [ ] Backend registration works
- [ ] Heartbeat mechanism works
- [ ] Webhook notifications work
- [ ] Error handling works
- [ ] Performance meets benchmarks

## 🎯 Next Steps

After successful testing:

1. **Deploy to staging environment**
2. **Run integration tests with real backend**
3. **Perform load testing with multiple sessions**
4. **Monitor production metrics**
5. **Set up automated health checks**

---

**Note**: Always test in a safe environment before production deployment. Use test phone numbers for WhatsApp integration testing.

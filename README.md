# WhatsApp Gateway Worker

A scalable WhatsApp Gateway Worker service built with Node.js and Baileys library. This worker handles WhatsApp Web connections, session management, and message operations as part of a larger WhatsApp Gateway PaaS system.

## 🚀 Features

- **WhatsApp Integration**: Full WhatsApp Web API support via Baileys
- **Session Management**: Create, manage, and persist multiple WhatsApp sessions
- **Message Operations**: Send text messages, media files, and bulk messages
- **Session Persistence**: Automatic session backup and recovery using MinIO
- **Health Monitoring**: Comprehensive health checks and metrics
- **Worker Registry**: Auto-registration with backend API gateway
- **Scalable Architecture**: Horizontal scaling with multiple worker instances

## 🏗️ Architecture

```
Customer/Admin → Backend API Gateway → WhatsApp Worker → Baileys → WhatsApp
```

This worker is the third component in the chain, responsible for:

- Actual WhatsApp connections using Baileys
- Session lifecycle management
- Message sending/receiving
- File storage and persistence
- Health monitoring and reporting

## 📋 Prerequisites

- Node.js 18+ (LTS recommended)
- MinIO server (for session storage)
- PostgreSQL database (for metadata)
- Redis server (for caching)
- Backend API Gateway (optional, for production)

## 🔧 Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd worker-whatsam-gateway
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the worker**

   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## ⚙️ Configuration

### Environment Variables

| Variable       | Description                 | Default       |
| -------------- | --------------------------- | ------------- |
| `PORT`         | Server port                 | `8001`        |
| `NODE_ENV`     | Environment                 | `development` |
| `WORKER_ID`    | Unique worker identifier    | `worker-001`  |
| `MAX_SESSIONS` | Maximum concurrent sessions | `50`          |

### Storage Configuration

| Variable           | Description           | Default      |
| ------------------ | --------------------- | ------------ |
| `MINIO_ENDPOINT`   | MinIO server endpoint | `localhost`  |
| `MINIO_PORT`       | MinIO server port     | `9000`       |
| `MINIO_ACCESS_KEY` | MinIO access key      | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO secret key      | `minioadmin` |

### Database Configuration

| Variable       | Description                  | Default                  |
| -------------- | ---------------------------- | ------------------------ |
| `DATABASE_URL` | PostgreSQL connection string | -                        |
| `REDIS_URL`    | Redis connection string      | `redis://localhost:6379` |

### Backend Integration

| Variable             | Description                 | Default                 |
| -------------------- | --------------------------- | ----------------------- |
| `BACKEND_URL`        | Backend API Gateway URL     | `http://localhost:8000` |
| `WORKER_AUTH_TOKEN`  | Worker authentication token | -                       |
| `HEARTBEAT_INTERVAL` | Heartbeat interval (ms)     | `30000`                 |

## 🔌 API Endpoints

### Session Management

#### Create Session

```http
POST /api/sessions/create
Content-Type: application/json

{
  "sessionId": "user123-session1",
  "userId": "user123",
  "sessionName": "Personal WhatsApp"
}
```

#### Get QR Code

```http
GET /api/sessions/{sessionId}/qr
```

#### Get Session Status

```http
GET /api/sessions/{sessionId}/status
```

#### Delete Session

```http
DELETE /api/sessions/{sessionId}
```

#### List Sessions

```http
GET /api/sessions
```

### Message Operations

#### Send Text Message

```http
POST /api/messages/{sessionId}/send/text
Content-Type: application/json

{
  "to": "6281234567890",
  "message": "Hello from WhatsApp Gateway!"
}
```

#### Send Media Message

```http
POST /api/messages/{sessionId}/send/media
Content-Type: multipart/form-data

{
  "to": "6281234567890",
  "caption": "Check this out!",
  "media": [file upload]
}
```

#### Get Message History

```http
GET /api/messages/{sessionId}/history?limit=50&offset=0
```

#### Bulk Send Messages

```http
POST /api/messages/{sessionId}/send/bulk
Content-Type: application/json

{
  "messages": [
    {
      "to": "6281234567890",
      "message": "Hello!"
    },
    {
      "to": "6281234567891",
      "message": "Hi there!"
    }
  ],
  "delay": 1000
}
```

### Health & Monitoring

#### Health Check

```http
GET /health
```

#### Detailed Metrics

```http
GET /metrics
```

#### Readiness Probe

```http
GET /ready
```

#### Liveness Probe

```http
GET /live
```

## 🐳 Docker Deployment

### Build Image

```bash
docker build -t whatsapp-worker:latest .
```

### Run Container

```bash
docker run -d \
  --name whatsapp-worker-01 \
  --env-file .env \
  -p 8001:8001 \
  -v worker-storage:/app/storage \
  -v worker-logs:/app/logs \
  whatsapp-worker:latest
```

### Docker Compose

```yaml
version: "3.8"
services:
  whatsapp-worker:
    build: .
    ports:
      - "8001:8001"
    environment:
      - NODE_ENV=production
      - WORKER_ID=worker-001
    volumes:
      - ./storage:/app/storage
      - ./logs:/app/logs
    depends_on:
      - minio
      - postgres
      - redis
```

## 🔒 Security

- **API Authentication**: JWT tokens for external API access
- **Worker Authentication**: Worker-specific tokens for backend communication
- **Session Isolation**: Each session runs in isolated context
- **Rate Limiting**: Per-IP and per-session rate limits
- **Input Validation**: All requests validated before processing
- **Secure Headers**: Helmet.js security middleware

## 📊 Monitoring

### Health Endpoints

- `/health` - Overall worker health status
- `/metrics` - Detailed performance metrics
- `/ready` - Kubernetes readiness probe
- `/live` - Kubernetes liveness probe
- `/api/health/services` - Individual service status

### Metrics Collected

- **Session Metrics**: Active sessions, connection success rate
- **Message Metrics**: Send/receive rates, delivery success
- **Resource Metrics**: CPU, memory, disk usage
- **Performance Metrics**: Response times, error rates

## 🚀 Development

### Project Structure

```
src/
├── controllers/          # HTTP request handlers
├── services/            # Business logic services
├── middleware/          # Express middleware
├── routes/             # API route definitions
├── utils/              # Utility functions
└── app.js              # Main application entry point
```

### Development Commands

```bash
# Start development server with auto-reload
npm run dev

# Run linting
npm run lint

# Run tests (when implemented)
npm test

# Build for production
npm run build
```

### Adding New Features

1. **Services**: Add business logic in `src/services/`
2. **Controllers**: Add HTTP handlers in `src/controllers/`
3. **Routes**: Define API endpoints in `src/routes/`
4. **Middleware**: Add request processing in `src/middleware/`

## 🔧 Troubleshooting

### Common Issues

1. **QR Code Not Generated**
   - Check Baileys service initialization
   - Verify session creation logs
   - Ensure storage service is available

2. **Session Not Connecting**
   - Check WhatsApp Web compatibility
   - Verify QR code scanning
   - Check network connectivity

3. **Messages Not Sending**
   - Verify session is connected
   - Check recipient number format
   - Review rate limiting settings

4. **Storage Issues**
   - Verify MinIO server is running
   - Check bucket permissions
   - Review storage service logs

### Debug Mode

Enable debug logging:

```bash
export LOG_LEVEL=debug
npm run dev
```

### Health Check

Check worker health:

```bash
curl http://localhost:8001/health
```

## 📝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:

- Check the troubleshooting section
- Review the logs in `./logs/`
- Open an issue on GitHub
- Contact the development team

## 🔄 Changelog

### v1.0.0

- Initial release
- Basic WhatsApp session management
- Message sending/receiving
- MinIO storage integration
- Health monitoring
- Worker registry integration

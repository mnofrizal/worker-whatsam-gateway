# Docker Setup Guide

## 🐳 Development Setup (Recommended)

### Option 1: Use Backend Infrastructure (No Duplication)

This is the **recommended approach** to avoid resource duplication between backend and worker projects.

#### Prerequisites

1. Backend project must be running with its Docker Compose infrastructure
2. Backend services accessible on localhost ports

#### Step-by-Step Setup

**1. Start Backend Infrastructure**

```bash
# Navigate to your backend project
cd /path/to/backend-project

# Start only the infrastructure services
docker-compose up -d postgres redis minio adminer redis-commander

# Verify services are running
docker-compose ps
```

**2. Start Backend API**

```bash
# In backend project directory
npm run dev
# Backend API should be running on http://localhost:8000
```

**3. Start Worker (Local Development)**

```bash
# Navigate to worker project
cd /path/to/worker-project

# Install dependencies (if not done)
npm install

# Start worker locally
npm start
# Worker API will be running on http://localhost:8001
```

#### Service URLs

- **Backend API**: http://localhost:8000
- **Worker API**: http://localhost:8001
- **Database Admin (Adminer)**: http://localhost:8080
- **Redis Admin**: http://localhost:8081
- **MinIO Console**: http://localhost:9001

---

### Option 2: Worker with Docker (Alternative)

If you prefer to run the worker in Docker while connecting to backend infrastructure:

```bash
# Start backend infrastructure first (as above)
cd /path/to/backend-project
docker-compose up -d postgres redis minio

# Start backend API
npm run dev

# Start worker with Docker
cd /path/to/worker-project
docker-compose up -d
```

---

## 🔧 Configuration Details

### Backend Infrastructure Compatibility

The worker is configured to connect to backend's infrastructure with these credentials:

**PostgreSQL:**

- Host: `localhost:5432`
- Database: `whatsapp_gateway`
- User: `postgres`
- Password: `password`

**Redis:**

- Host: `localhost:6379`
- Password: `redispassword`

**MinIO:**

- Endpoint: `localhost:9000`
- Console: `localhost:9001`
- Access Key: `minioadmin`
- Secret Key: `minioadmin123`

### Environment Variables

The worker's `.env` file has been updated to match backend credentials:

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/whatsapp_gateway

# Redis
REDIS_URL=redis://:redispassword@localhost:6379

# MinIO
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
```

---

## 🚀 Development Workflow

### Daily Development

1. **Start Backend Infrastructure** (once per day)

   ```bash
   cd /path/to/backend-project
   docker-compose up -d postgres redis minio
   ```

2. **Start Backend API**

   ```bash
   cd /path/to/backend-project
   npm run dev
   ```

3. **Start Worker**
   ```bash
   cd /path/to/worker-project
   npm start
   ```

### Stopping Services

```bash
# Stop worker
# Ctrl+C in worker terminal

# Stop backend API
# Ctrl+C in backend terminal

# Stop infrastructure (optional - can keep running)
cd /path/to/backend-project
docker-compose down
```

---

## 🔍 Troubleshooting

### Connection Issues

**Problem**: Worker can't connect to database/redis/minio
**Solution**:

1. Verify backend infrastructure is running: `docker-compose ps`
2. Check ports are not blocked: `netstat -an | grep :5432`
3. Verify credentials in `.env` match backend setup

**Problem**: Backend API not accessible
**Solution**:

1. Ensure backend is running on port 8000
2. Check `BACKEND_URL=http://localhost:8000` in worker `.env`

### Port Conflicts

If you encounter port conflicts:

- Backend API: 8000
- Worker API: 8001
- PostgreSQL: 5432
- Redis: 6379
- MinIO: 9000, 9001
- Adminer: 8080
- Redis Commander: 8081

Change ports in respective docker-compose files if needed.

---

## 📊 Resource Usage

### With Shared Infrastructure

- **Memory**: ~500MB (infrastructure shared)
- **CPU**: Minimal overhead
- **Disk**: Single set of data volumes

### Benefits

- ✅ No resource duplication
- ✅ Consistent data across services
- ✅ Faster development setup
- ✅ Easier debugging
- ✅ Production-like architecture

---

## 🎯 Production Considerations

For production deployment, consider:

1. **Separate Infrastructure**: Each service with its own database
2. **Load Balancing**: Multiple worker instances
3. **Service Discovery**: Kubernetes service mesh
4. **Monitoring**: Centralized logging and metrics
5. **Security**: Network policies and encryption

This development setup mimics production architecture while optimizing for development efficiency.

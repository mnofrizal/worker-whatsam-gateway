# WhatsApp Gateway Worker - Technology Stack

## Core Technologies

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **WhatsApp Library:** @whiskeysockets/baileys (latest stable)
- **Storage Client:** MinIO SDK for session persistence
- **Database Client:** pg (PostgreSQL) for metadata
- **Caching:** ioredis for Redis integration
- **Process Management:** PM2 (production) / nodemon (development)

## Key Dependencies

This is the planned dependency list based on the project brief.

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "@whiskeysockets/baileys": "^6.0.0",
    "qrcode": "^1.5.3",
    "minio": "^7.1.3",
    "pg": "^8.11.0",
    "ioredis": "^5.3.2",
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "winston": "^3.11.0",
    "multer": "^1.4.5",
    "jsonwebtoken": "^9.0.0",
    "express-rate-limit": "^7.0.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "eslint": "^8.50.0",
    "prettier": "^3.0.3"
  }
}
```

## Development Environment

- **Node.js:** Version 18 or higher is required.
- **Package Manager:** `npm` is the standard for this project.
- **Local Storage:** A local MinIO instance is needed for session file storage.
- **Database:** A local or containerized PostgreSQL database is required for metadata.
- **Caching:** A local Redis instance is recommended for caching and rate limiting.
- **Environment Variables:** The project will be configured using a `.env` file.

## Tool Usage Patterns

- **Linting:** ESLint will be used to enforce code quality and style consistency.
- **Formatting:** Prettier will be used for automatic code formatting.
- **Development Server:** `nodemon` will be used to automatically restart the server during development.
- **Production Management:** `pm2` will be used to manage the application in a production environment.

## Technical Constraints

- **Single-threaded Nature of Node.js:** The application must be designed to be non-blocking to handle concurrent connections efficiently.
- **Baileys Library Updates:** The Baileys library is frequently updated. The implementation should be modular to accommodate future updates with minimal disruption.
- **WhatsApp Web Protocol:** The service is dependent on the unofficial WhatsApp Web protocol, which can change without notice. The system should have robust error handling and recovery mechanisms.

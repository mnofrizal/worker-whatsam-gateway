import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DatabaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.dbPath = join(__dirname, "../../storage/worker.db");
  }

  async initialize() {
    try {
      logger.info("Initializing SQLite database service...");

      // Ensure storage directory exists
      const storageDir = join(__dirname, "../../storage");
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      // Initialize SQLite database
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better performance
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("cache_size = 1000");
      this.db.pragma("temp_store = memory");

      // Initialize schema
      await this.initializeSchema();

      this.initialized = true;
      logger.info("SQLite database service initialized successfully", {
        dbPath: this.dbPath,
        mode: "WAL",
      });
    } catch (error) {
      logger.error("Failed to initialize SQLite database service:", error);
      // Don't throw error to allow worker to start without database
      logger.warn("Database service will be disabled");
    }
  }

  query(sql, params = []) {
    if (!this.initialized) {
      throw new Error("Database service not initialized");
    }

    try {
      const start = Date.now();
      let result;

      if (sql.trim().toLowerCase().startsWith("select")) {
        const stmt = this.db.prepare(sql);
        result = stmt.all(params);
        result.rowCount = result.length;
        result.rows = result;
      } else {
        const stmt = this.db.prepare(sql);
        result = stmt.run(params);
        result.rows = [];
      }

      const duration = Date.now() - start;
      logger.debug("Executed query", {
        sql,
        duration,
        rows: result.rowCount || result.changes,
      });

      return result;
    } catch (error) {
      logger.error("Database query error:", { sql, error: error.message });
      throw error;
    }
  }

  async close() {
    if (this.db) {
      this.db.close();
      logger.info("SQLite database connection closed");
    }
  }

  isInitialized() {
    return this.initialized;
  }

  // Session-related database operations
  async saveSession(sessionData) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping session save");
      return { success: false, reason: "Database not available" };
    }

    try {
      const sql = `
        INSERT OR REPLACE INTO worker_sessions (
          session_id, user_id, session_name, status, phone_number, 
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `;

      const params = [
        sessionData.sessionId,
        sessionData.userId,
        sessionData.sessionName || "WhatsApp Session",
        sessionData.status || "disconnected",
        sessionData.phoneNumber || null,
      ];

      this.query(sql, params);
      logger.info(`Session saved to database: ${sessionData.sessionId}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to save session to database:", error);
      return { success: false, error: error.message };
    }
  }

  async updateSessionStatus(sessionId, status, additionalData = {}) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping session status update");
      return { success: false, reason: "Database not available" };
    }

    try {
      const sql = `
        UPDATE worker_sessions 
        SET status = ?, phone_number = ?, last_activity = datetime('now'), updated_at = datetime('now')
        WHERE session_id = ?
      `;

      const params = [status, additionalData.phoneNumber || null, sessionId];

      const result = this.query(sql, params);

      if (result.changes === 0) {
        logger.warn(`Session not found for status update: ${sessionId}`);
        return { success: false, reason: "Session not found" };
      }

      logger.info(`Session status updated: ${sessionId} -> ${status}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to update session status:", error);
      return { success: false, error: error.message };
    }
  }

  async getSession(sessionId) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping session retrieval");
      return null;
    }

    try {
      const sql = `
        SELECT session_id, user_id, session_name, status, phone_number, 
               created_at, updated_at, last_activity
        FROM worker_sessions 
        WHERE session_id = ?
      `;

      const result = this.query(sql, [sessionId]);

      if (result.length === 0) {
        return null;
      }

      return result[0];
    } catch (error) {
      logger.error("Failed to get session from database:", error);
      return null;
    }
  }

  async getAllSessions() {
    if (!this.initialized) {
      logger.warn("Database not available, skipping sessions retrieval");
      return [];
    }

    try {
      const sql = `
        SELECT session_id, user_id, session_name, status, phone_number, 
               created_at, updated_at, last_activity
        FROM worker_sessions 
        ORDER BY created_at DESC
      `;

      const result = this.query(sql);
      return result;
    } catch (error) {
      logger.error("Failed to get sessions from database:", error);
      return [];
    }
  }

  async deleteSession(sessionId) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping session deletion");
      return { success: false, reason: "Database not available" };
    }

    try {
      // Delete related messages first
      this.query("DELETE FROM worker_messages WHERE session_id = ?", [
        sessionId,
      ]);

      // Delete session
      const result = this.query(
        "DELETE FROM worker_sessions WHERE session_id = ?",
        [sessionId]
      );

      if (result.changes === 0) {
        logger.warn(`Session not found for deletion: ${sessionId}`);
        return { success: false, reason: "Session not found" };
      }

      logger.info(`Session deleted from database: ${sessionId}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to delete session from database:", error);
      return { success: false, error: error.message };
    }
  }

  async saveMessage(messageData) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping message save");
      return { success: false, reason: "Database not available" };
    }

    try {
      const sql = `
        INSERT INTO worker_messages (
          message_id, session_id, from_number, to_number, message_type,
          content, media_url, status, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `;

      const params = [
        messageData.messageId || `msg_${Date.now()}`,
        messageData.sessionId,
        messageData.from || null,
        messageData.to || null,
        messageData.type || "text",
        messageData.content || messageData.message || "",
        messageData.mediaUrl || null,
        messageData.status || "sent",
        messageData.timestamp || new Date().toISOString(),
      ];

      this.query(sql, params);
      logger.debug(`Message saved to database: ${messageData.messageId}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to save message to database:", error);
      return { success: false, error: error.message };
    }
  }

  async getMessages(sessionId, limit = 50, offset = 0) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping messages retrieval");
      return { messages: [], total: 0 };
    }

    try {
      // Get total count
      const countSql =
        "SELECT COUNT(*) as count FROM worker_messages WHERE session_id = ?";
      const countResult = this.query(countSql, [sessionId]);
      const total = countResult[0].count;

      // Get messages
      const sql = `
        SELECT message_id, session_id, from_number, to_number, message_type,
               content, media_url, status, timestamp, created_at
        FROM worker_messages 
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      const result = this.query(sql, [sessionId, limit, offset]);

      return {
        messages: result,
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error("Failed to get messages from database:", error);
      return { messages: [], total: 0 };
    }
  }

  async updateMessageStatus(messageId, status) {
    if (!this.initialized) {
      logger.warn("Database not available, skipping message status update");
      return { success: false, reason: "Database not available" };
    }

    try {
      const sql = "UPDATE worker_messages SET status = ? WHERE message_id = ?";
      const result = this.query(sql, [status, messageId]);

      if (result.changes === 0) {
        logger.warn(`Message not found for status update: ${messageId}`);
        return { success: false, reason: "Message not found" };
      }

      logger.debug(`Message status updated: ${messageId} -> ${status}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to update message status:", error);
      return { success: false, error: error.message };
    }
  }

  // Database schema initialization
  async initializeSchema() {
    if (!this.initialized && !this.db) {
      logger.warn("Database not available, skipping schema initialization");
      return { success: false, reason: "Database not available" };
    }

    try {
      logger.info("Initializing database schema...");

      // Create worker_sessions table
      const sessionsTable = `
        CREATE TABLE IF NOT EXISTS worker_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          status TEXT DEFAULT 'disconnected',
          phone_number TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          last_activity TEXT DEFAULT (datetime('now'))
        )
      `;

      this.db.exec(sessionsTable);

      // Create worker_messages table
      const messagesTable = `
        CREATE TABLE IF NOT EXISTS worker_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT UNIQUE NOT NULL,
          session_id TEXT NOT NULL,
          from_number TEXT,
          to_number TEXT,
          message_type TEXT DEFAULT 'text',
          content TEXT,
          media_url TEXT,
          status TEXT DEFAULT 'sent',
          timestamp TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES worker_sessions(session_id) ON DELETE CASCADE
        )
      `;

      this.db.exec(messagesTable);

      // Create indexes for better performance
      const indexes = [
        "CREATE INDEX IF NOT EXISTS idx_worker_sessions_user_id ON worker_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_worker_sessions_status ON worker_sessions(status)",
        "CREATE INDEX IF NOT EXISTS idx_worker_messages_session_id ON worker_messages(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_worker_messages_timestamp ON worker_messages(timestamp)",
        "CREATE INDEX IF NOT EXISTS idx_worker_messages_status ON worker_messages(status)",
      ];

      for (const indexQuery of indexes) {
        this.db.exec(indexQuery);
      }

      logger.info("Database schema initialized successfully");
      return { success: true };
    } catch (error) {
      logger.error("Failed to initialize database schema:", error);
      return { success: false, error: error.message };
    }
  }

  // Utility methods for SQLite
  getStats() {
    if (!this.initialized) {
      return null;
    }

    try {
      const sessionCount = this.query(
        "SELECT COUNT(*) as count FROM worker_sessions"
      )[0].count;
      const messageCount = this.query(
        "SELECT COUNT(*) as count FROM worker_messages"
      )[0].count;
      const connectedSessions = this.query(
        "SELECT COUNT(*) as count FROM worker_sessions WHERE status = 'connected'"
      )[0].count;

      return {
        sessionCount,
        messageCount,
        connectedSessions,
        dbPath: this.dbPath,
        dbSize: fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0,
      };
    } catch (error) {
      logger.error("Failed to get database stats:", error);
      return null;
    }
  }

  // Backup database
  backup(backupPath) {
    if (!this.initialized) {
      throw new Error("Database not initialized");
    }

    try {
      this.db.backup(backupPath);
      logger.info(`Database backed up to: ${backupPath}`);
      return { success: true, backupPath };
    } catch (error) {
      logger.error("Failed to backup database:", error);
      throw error;
    }
  }
}

export default DatabaseService;

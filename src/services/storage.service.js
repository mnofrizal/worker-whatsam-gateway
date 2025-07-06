import { Client } from "minio";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class StorageService {
  constructor() {
    this.client = null;
    this.config = config.minio;
    this.bucketName = this.config.buckets.sessions;
    this.mediaBucket = this.config.buckets.media;
    this.backupsBucket = this.config.buckets.backups;
    this.initialized = false;
  }

  async initialize() {
    try {
      logger.info("Initializing MinIO storage service...");

      // Check if MinIO configuration is available
      if (!this.config.endpoint) {
        logger.warn("MinIO not configured, storage service will be disabled");
        return;
      }

      this.client = new Client({
        endPoint: this.config.endpoint,
        port: this.config.port,
        useSSL: this.config.useSSL,
        accessKey: this.config.accessKey,
        secretKey: this.config.secretKey,
        region: this.config.region,
      });

      // Test connection and create buckets
      await this.ensureBucketsExist();

      this.initialized = true;
      logger.info("MinIO storage service initialized successfully", {
        endpoint: this.config.endpoint,
        port: this.config.port,
        useSSL: this.config.useSSL,
        buckets: Object.values(this.config.buckets),
      });
    } catch (error) {
      logger.error("Failed to initialize MinIO storage service:", error);
      // Don't throw error to allow worker to start without MinIO
      logger.warn("Storage service will be disabled");
    }
  }

  async ensureBucketsExist() {
    const buckets = [this.bucketName, this.mediaBucket, this.backupsBucket];

    for (const bucket of buckets) {
      try {
        const exists = await this.client.bucketExists(bucket);
        if (!exists) {
          await this.client.makeBucket(bucket, this.config.region);
          logger.info(`Created MinIO bucket: ${bucket}`);
        }
      } catch (error) {
        logger.error(`Failed to create/check bucket ${bucket}:`, error);
        throw error;
      }
    }
  }

  async uploadSessionFiles(sessionId) {
    if (!this.initialized) {
      logger.warn(
        "Storage service not initialized, skipping session file upload"
      );
      return { success: false, reason: "Storage not available" };
    }

    try {
      const localPath = join(
        __dirname,
        "../../",
        config.whatsapp.sessionPath,
        sessionId
      );
      const remotePath = `sessions/${sessionId}`;

      // Check if local session directory exists
      try {
        await fs.access(localPath);
      } catch (error) {
        logger.warn(`Session directory not found: ${localPath}`);
        return { success: false, reason: "Session directory not found" };
      }

      const files = await fs.readdir(localPath);

      if (files.length === 0) {
        logger.warn(`No session files found in: ${localPath}`);
        return { success: false, reason: "No session files found" };
      }

      for (const file of files) {
        const filePath = join(localPath, file);
        const objectName = `${remotePath}/${file}`;

        await this.client.fPutObject(this.bucketName, objectName, filePath);
        logger.debug(`Uploaded session file: ${objectName}`);
      }

      logger.info(`Session files uploaded successfully for ${sessionId}`);
      return { success: true, filesUploaded: files.length };
    } catch (error) {
      logger.error(`Failed to upload session files for ${sessionId}:`, error);
      throw new Error(`Failed to upload session files: ${error.message}`);
    }
  }

  async downloadSessionFiles(sessionId) {
    if (!this.initialized) {
      logger.warn(
        "Storage service not initialized, skipping session file download"
      );
      return { success: false, reason: "Storage not available" };
    }

    try {
      const localPath = join(
        __dirname,
        "../../",
        config.whatsapp.sessionPath,
        sessionId
      );
      const remotePath = `sessions/${sessionId}`;

      // Ensure local directory exists
      await fs.mkdir(localPath, { recursive: true });

      // List objects in the session path
      const objectsStream = this.client.listObjects(
        this.bucketName,
        remotePath,
        true
      );
      const objects = [];

      for await (const obj of objectsStream) {
        objects.push(obj.name);
      }

      if (objects.length === 0) {
        logger.warn(`No session files found in storage for ${sessionId}`);
        return { success: false, reason: "No session files found in storage" };
      }

      // Download each file
      for (const objectName of objects) {
        const fileName = objectName.split("/").pop();
        const localFile = join(localPath, fileName);

        await this.client.fGetObject(this.bucketName, objectName, localFile);
        logger.debug(`Downloaded session file: ${objectName}`);
      }

      logger.info(`Session files downloaded successfully for ${sessionId}`);
      return { success: true, filesDownloaded: objects.length };
    } catch (error) {
      logger.error(`Failed to download session files for ${sessionId}:`, error);
      throw new Error(`Failed to download session files: ${error.message}`);
    }
  }

  async deleteSessionFiles(sessionId) {
    if (!this.initialized) {
      logger.warn(
        "Storage service not initialized, skipping session file deletion"
      );
      return { success: false, reason: "Storage not available" };
    }

    try {
      const remotePath = `sessions/${sessionId}`;

      // List objects to delete
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
        logger.info(
          `Deleted ${objectsList.length} session files for ${sessionId}`
        );
      }

      return { success: true, filesDeleted: objectsList.length };
    } catch (error) {
      logger.error(`Failed to delete session files for ${sessionId}:`, error);
      throw new Error(`Failed to delete session files: ${error.message}`);
    }
  }

  async uploadMedia(sessionId, mediaBuffer, fileName, mimeType) {
    if (!this.initialized) {
      throw new Error("Storage service not initialized");
    }

    try {
      const objectName = `media/${sessionId}/${Date.now()}-${fileName}`;

      await this.client.putObject(this.mediaBucket, objectName, mediaBuffer, {
        "Content-Type": mimeType,
      });

      // Generate presigned URL for access
      const url = await this.client.presignedGetObject(
        this.mediaBucket,
        objectName,
        3600
      );

      logger.info(`Media uploaded successfully: ${objectName}`);
      return { url, objectName };
    } catch (error) {
      logger.error(`Failed to upload media for ${sessionId}:`, error);
      throw new Error(`Failed to upload media: ${error.message}`);
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async close() {
    if (this.initialized && this.client) {
      logger.info("Closing MinIO storage service...");
      // MinIO client doesn't have a close method, just mark as not initialized
      this.initialized = false;
      this.client = null;
      logger.info("MinIO storage service closed");
    }
  }
}

export default StorageService;

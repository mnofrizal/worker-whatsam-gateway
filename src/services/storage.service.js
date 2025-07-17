import { Client } from "minio";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import config from "../config/environment.js";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let client = null;
const minioConfig = config.minio;
const bucketName = minioConfig.buckets.sessions;
const mediaBucket = minioConfig.buckets.media;
const backupsBucket = minioConfig.buckets.backups;
let initialized = false;

const initialize = async () => {
  try {
    logger.info("Initializing MinIO storage service...");

    if (!minioConfig.endpoint) {
      logger.warn("MinIO not configured, storage service will be disabled");
      return;
    }

    client = new Client({
      endPoint: minioConfig.endpoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL,
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
      region: minioConfig.region,
    });

    await ensureBucketsExist();

    initialized = true;
    logger.info("MinIO storage service initialized successfully", {
      endpoint: minioConfig.endpoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL,
      buckets: Object.values(minioConfig.buckets),
    });
  } catch (error) {
    logger.error("Failed to initialize MinIO storage service:", error);
    logger.warn("Storage service will be disabled");
  }
};

const ensureBucketsExist = async () => {
  const buckets = [bucketName, mediaBucket, backupsBucket];

  for (const bucket of buckets) {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket, minioConfig.region);
        logger.info(`Created MinIO bucket: ${bucket}`);
      }
    } catch (error) {
      logger.error(`Failed to create/check bucket ${bucket}:`, error);
      throw error;
    }
  }
};

const uploadSessionFiles = async (sessionId) => {
  if (!initialized) {
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

      await client.fPutObject(bucketName, objectName, filePath);
      logger.debug(`Uploaded session file: ${objectName}`);
    }

    logger.info(`Session files uploaded successfully for ${sessionId}`);
    return { success: true, filesUploaded: files.length };
  } catch (error) {
    logger.error(`Failed to upload session files for ${sessionId}:`, error);
    throw new Error(`Failed to upload session files: ${error.message}`);
  }
};

const downloadSessionFiles = async (sessionId) => {
  if (!initialized) {
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

    await fs.mkdir(localPath, { recursive: true });

    const objectsStream = client.listObjects(bucketName, remotePath, true);
    const objects = [];

    for await (const obj of objectsStream) {
      objects.push(obj.name);
    }

    if (objects.length === 0) {
      logger.warn(`No session files found in storage for ${sessionId}`);
      return { success: false, reason: "No session files found in storage" };
    }

    for (const objectName of objects) {
      const fileName = objectName.split("/").pop();
      const localFile = join(localPath, fileName);

      await client.fGetObject(bucketName, objectName, localFile);
      logger.debug(`Downloaded session file: ${objectName}`);
    }

    logger.info(`Session files downloaded successfully for ${sessionId}`);
    return { success: true, filesDownloaded: objects.length };
  } catch (error) {
    logger.error(`Failed to download session files for ${sessionId}:`, error);
    throw new Error(`Failed to download session files: ${error.message}`);
  }
};

const deleteSessionFiles = async (sessionId) => {
  if (!initialized) {
    logger.warn(
      "Storage service not initialized, skipping session file deletion"
    );
    return { success: false, reason: "Storage not available" };
  }

  try {
    const remotePath = `sessions/${sessionId}`;

    const objectsStream = client.listObjects(bucketName, remotePath, true);
    const objectsList = [];

    for await (const obj of objectsStream) {
      objectsList.push(obj.name);
    }

    if (objectsList.length > 0) {
      await client.removeObjects(bucketName, objectsList);
      logger.info(
        `Deleted ${objectsList.length} session files for ${sessionId}`
      );
    }

    return { success: true, filesDeleted: objectsList.length };
  } catch (error) {
    logger.error(`Failed to delete session files for ${sessionId}:`, error);
    throw new Error(`Failed to delete session files: ${error.message}`);
  }
};

const uploadMedia = async (sessionId, mediaBuffer, fileName, mimeType) => {
  if (!initialized) {
    throw new Error("Storage service not initialized");
  }

  try {
    const objectName = `media/${sessionId}/${Date.now()}-${fileName}`;

    await client.putObject(mediaBucket, objectName, mediaBuffer, {
      "Content-Type": mimeType,
    });

    const url = await client.presignedGetObject(mediaBucket, objectName, 3600);

    logger.info(`Media uploaded successfully: ${objectName}`);
    return { url, objectName };
  } catch (error) {
    logger.error(`Failed to upload media for ${sessionId}:`, error);
    throw new Error(`Failed to upload media: ${error.message}`);
  }
};

const isInitialized = () => {
  return initialized;
};

const close = async () => {
  if (initialized && client) {
    logger.info("Closing MinIO storage service...");
    initialized = false;
    client = null;
    logger.info("MinIO storage service closed");
  }
};

export default {
  initialize,
  uploadSessionFiles,
  downloadSessionFiles,
  deleteSessionFiles,
  uploadMedia,
  isInitialized,
  close,
};

import express from "express";
import {
  getHealth,
  getMetrics,
  getReadiness,
  getLiveness,
  getServiceStatus,
} from "../controllers/health.controller.js";

const router = express.Router();

// Health check endpoint
router.get("/", getHealth);

// Detailed metrics endpoint
router.get("/metrics", getMetrics);

// Kubernetes readiness probe
router.get("/ready", getReadiness);

// Kubernetes liveness probe
router.get("/live", getLiveness);

// Service status endpoint
router.get("/services", getServiceStatus);

export default router;

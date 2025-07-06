import express from "express";
import { healthRateLimit } from "../middleware/rate-limit.middleware.js";

const router = express.Router();

// Health check endpoint
router.get("/", async (req, res, next) => {
  try {
    await global.controllers.health.getHealth(req, res);
  } catch (error) {
    next(error);
  }
});

// Detailed metrics endpoint
router.get("/metrics", healthRateLimit, async (req, res, next) => {
  try {
    await global.controllers.health.getMetrics(req, res);
  } catch (error) {
    next(error);
  }
});

// Readiness probe endpoint
router.get("/ready", async (req, res, next) => {
  try {
    await global.controllers.health.getReadiness(req, res);
  } catch (error) {
    next(error);
  }
});

// Liveness probe endpoint
router.get("/live", async (req, res, next) => {
  try {
    await global.controllers.health.getLiveness(req, res);
  } catch (error) {
    next(error);
  }
});

// Service status endpoint
router.get("/services", healthRateLimit, async (req, res, next) => {
  try {
    await global.controllers.health.getServiceStatus(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;

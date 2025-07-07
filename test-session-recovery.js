#!/usr/bin/env node

/**
 * Session Recovery Test Script
 *
 * This script tests the session recovery functionality by:
 * 1. Starting the worker
 * 2. Creating a test session
 * 3. Simulating worker restart
 * 4. Verifying session recovery
 */

import { spawn } from "child_process";
import axios from "axios";
import fs from "fs/promises";
import path from "path";

const WORKER_URL = "http://localhost:8001";
const TEST_SESSION_ID = "test-recovery-session";
const TEST_USER_ID = "test-user-123";

class SessionRecoveryTester {
  constructor() {
    this.workerProcess = null;
    this.testResults = {
      sessionCreation: false,
      sessionPersistence: false,
      workerRestart: false,
      sessionRecovery: false,
      sessionFunctionality: false,
    };
  }

  async runTest() {
    console.log("🚀 Starting Session Recovery Test...\n");

    try {
      // Step 1: Start worker
      await this.startWorker();
      await this.waitForWorkerReady();

      // Step 2: Create test session
      await this.createTestSession();

      // Step 3: Verify session files exist
      await this.verifySessionPersistence();

      // Step 4: Stop worker gracefully
      await this.stopWorker();

      // Step 5: Start worker again
      await this.startWorker();
      await this.waitForWorkerReady();

      // Step 6: Verify session recovery
      await this.verifySessionRecovery();

      // Step 7: Test session functionality
      await this.testSessionFunctionality();

      // Print results
      this.printTestResults();
    } catch (error) {
      console.error("❌ Test failed:", error.message);
      this.printTestResults();
      process.exit(1);
    } finally {
      if (this.workerProcess) {
        this.workerProcess.kill("SIGTERM");
      }
    }
  }

  async startWorker() {
    console.log("📦 Starting WhatsApp Worker...");

    return new Promise((resolve, reject) => {
      this.workerProcess = spawn("node", ["src/app.js"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "development",
          SESSION_RECOVERY_ENABLED: "true",
          SESSION_RECOVERY_STARTUP_DELAY: "2000",
          SESSION_PRESERVE_ON_SHUTDOWN: "true",
          LOG_LEVEL: "info",
        },
      });

      this.workerProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log(`[WORKER] ${output.trim()}`);

        if (output.includes("WhatsApp Worker started on port")) {
          resolve();
        }
      });

      this.workerProcess.stderr.on("data", (data) => {
        console.error(`[WORKER ERROR] ${data.toString().trim()}`);
      });

      this.workerProcess.on("error", (error) => {
        reject(new Error(`Failed to start worker: ${error.message}`));
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error("Worker startup timeout"));
      }, 30000);
    });
  }

  async waitForWorkerReady() {
    console.log("⏳ Waiting for worker to be ready...");

    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${WORKER_URL}/health`, {
          timeout: 2000,
        });

        if (response.status === 200) {
          console.log("✅ Worker is ready");
          return;
        }
      } catch (error) {
        // Worker not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error("Worker failed to become ready");
  }

  async createTestSession() {
    console.log("🔧 Creating test session...");

    try {
      const response = await axios.post(
        `${WORKER_URL}/api/session/create`,
        {
          sessionId: TEST_SESSION_ID,
          userId: TEST_USER_ID,
          sessionName: "Test Recovery Session",
        },
        {
          timeout: 10000,
        }
      );

      if (response.data.success) {
        console.log("✅ Test session created successfully");
        this.testResults.sessionCreation = true;
      } else {
        throw new Error(`Session creation failed: ${response.data.error}`);
      }
    } catch (error) {
      throw new Error(`Failed to create test session: ${error.message}`);
    }
  }

  async verifySessionPersistence() {
    console.log("💾 Verifying session persistence...");

    try {
      // Check session status via API
      const response = await axios.get(
        `${WORKER_URL}/api/session/${TEST_SESSION_ID}/status`
      );

      if (response.data.success) {
        console.log("✅ Session status retrievable");
        this.testResults.sessionPersistence = true;
      }
    } catch (error) {
      throw new Error(
        `Session persistence verification failed: ${error.message}`
      );
    }
  }

  async stopWorker() {
    console.log("🛑 Stopping worker gracefully...");

    return new Promise((resolve) => {
      if (this.workerProcess) {
        this.workerProcess.on("exit", () => {
          console.log("✅ Worker stopped gracefully");
          this.testResults.workerRestart = true;
          this.workerProcess = null;
          resolve();
        });

        // Send SIGTERM for graceful shutdown
        this.workerProcess.kill("SIGTERM");

        // Force kill after 15 seconds if not stopped
        setTimeout(() => {
          if (this.workerProcess) {
            console.log("⚠️  Force killing worker...");
            this.workerProcess.kill("SIGKILL");
            this.workerProcess = null;
            resolve();
          }
        }, 15000);
      } else {
        resolve();
      }
    });
  }

  async verifySessionRecovery() {
    console.log("🔄 Verifying session recovery...");

    // Wait a bit for recovery to complete
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      const response = await axios.get(
        `${WORKER_URL}/api/session/${TEST_SESSION_ID}/status`
      );

      if (response.data.success) {
        const sessionData = response.data.data;
        console.log("✅ Session recovered successfully");
        console.log(`   Session ID: ${sessionData.sessionId}`);
        console.log(`   Status: ${sessionData.status}`);
        this.testResults.sessionRecovery = true;
      } else {
        throw new Error(
          `Session not found after recovery: ${response.data.error}`
        );
      }
    } catch (error) {
      throw new Error(`Session recovery verification failed: ${error.message}`);
    }
  }

  async testSessionFunctionality() {
    console.log("🧪 Testing recovered session functionality...");

    try {
      // Test getting session status
      const statusResponse = await axios.get(
        `${WORKER_URL}/api/session/${TEST_SESSION_ID}/status`
      );

      if (statusResponse.data.success) {
        console.log("✅ Session status endpoint working");
      }

      // Test session deletion (cleanup)
      const deleteResponse = await axios.delete(
        `${WORKER_URL}/api/session/${TEST_SESSION_ID}`
      );

      if (deleteResponse.data.success) {
        console.log("✅ Session deletion working");
        this.testResults.sessionFunctionality = true;
      }
    } catch (error) {
      console.log(`⚠️  Session functionality test failed: ${error.message}`);
    }
  }

  printTestResults() {
    console.log("\n📊 Test Results:");
    console.log("================");

    Object.entries(this.testResults).forEach(([test, passed]) => {
      const status = passed ? "✅ PASS" : "❌ FAIL";
      const testName = test.replace(/([A-Z])/g, " $1").toLowerCase();
      console.log(`${status} ${testName}`);
    });

    const passedTests = Object.values(this.testResults).filter(Boolean).length;
    const totalTests = Object.keys(this.testResults).length;

    console.log(`\n📈 Overall: ${passedTests}/${totalTests} tests passed`);

    if (passedTests === totalTests) {
      console.log(
        "🎉 All tests passed! Session recovery is working correctly."
      );
    } else {
      console.log("⚠️  Some tests failed. Please check the implementation.");
    }
  }
}

// Run the test
const tester = new SessionRecoveryTester();
tester.runTest().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});

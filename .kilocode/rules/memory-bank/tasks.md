# Repetitive Task Workflows

This file documents common, repetitive tasks to ensure consistency and efficiency.

## Add New API Endpoint

**Last performed:** N/A
**Files to modify:**

- `/src/controllers/{feature}.js` - Add new controller function.
- `/src/services/{feature}.js` - Implement the business logic.
- `/src/routes/{feature}.js` - Define the new route.
- `/src/routes/index.js` - Mount the feature route.
- `/src/middleware/validation.js` - Add request validation schema.
- `docs/api.md` - Document the new endpoint.
- `tests/integration/{feature}.test.js` - Add integration tests.

**Steps:**

1.  **Define Route:** Add the new endpoint path and HTTP method in the appropriate route file.
2.  **Add Validation:** Create a validation schema in `validation.js` to sanitize and validate the request body/params/query.
3.  **Create Controller:** Implement the controller function that takes the request and response objects, calls the service, and sends the response.
4.  **Implement Service:** Write the core business logic for the endpoint in the corresponding service file. This includes any database or external API calls.
5.  **Add Tests:** Write integration tests to cover the new endpoint's success and error cases.
6.  **Update Documentation:** Add the new endpoint to the API documentation, including details about the request, response, and potential errors.

**Important notes:**

- Ensure all new endpoints are covered by authentication middleware if they handle sensitive data.
- Follow the existing error handling pattern by throwing custom errors from the service layer.
- Update the Postman collection or Swagger/OpenAPI specification.

---

## Add New Baileys Event Handler

**Last performed:** N/A
**Files to modify:**

- `/src/services/baileys.js` - Add the new event listener in the `createSession` method.
- `/src/services/worker-registry.js` - Add a new `notifyBackend` event if needed.
- `/src/controllers/webhook.js` - (Optional) Add a controller to handle webhooks related to the event.

**Steps:**

1.  **Identify Event:** Determine the correct Baileys event to listen to from the official Baileys documentation.
2.  **Add Listener:** In `baileys.js`, add a new `socket.ev.on()` listener for the event.
3.  **Implement Handler:** Write the logic to handle the event data. This might involve updating the database, notifying the backend, or emitting a webhook.
4.  **Notify Backend:** If the backend needs to be aware of the event, use the `worker-registry.js` service to send a notification.
5.  **Test:** Manually trigger the event (e.g., by changing connection status, receiving a message) and verify the handler works as expected.

**Important notes:**

- Be mindful of the data structure of the event payload.
- Handle potential errors within the event handler to prevent the worker from crashing.
- Consider the performance implications of frequent events.

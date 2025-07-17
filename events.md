# WhatsApp Gateway Worker - Tracked Events

This document outlines all the events that are tracked by the WhatsApp Gateway Worker. These events provide real-time updates on the status of sessions and messages, and are communicated to the backend via webhooks.

## Session & Connection Events

| Event Name                      | Trigger                                                                    | Payload Sent to Backend                                                                                 | Purpose                                                                                               |
| :------------------------------ | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- |
| **`qr_ready`**                  | A new QR code is generated for authentication.                             | `{ "qrCode": "data:image/...", "attempts": 1 }`                                                         | Informs the backend that a new QR code is available for the user to scan.                             |
| **`connected`**                 | The WhatsApp session successfully connects.                                | `{ "phoneNumber": "...", "displayName": "..." }`                                                        | Notifies the backend that the session is online and ready to send/receive messages.                   |
| **`disconnected`**              | The session is manually disconnected by the user.                          | `{ "reason": "manual_disconnection", "timestamp": "..." }`                                              | Informs the backend that the session has been intentionally disconnected.                             |
| **`session_logged_out`**        | The session is logged out from the phone (unlinked).                       | `{ "reason": "logged_out_from_phone", "timestamp": "...", "phoneNumber": "...", "displayName": "..." }` | Alerts the backend that the session has been terminated and requires a new QR scan to reconnect.      |
| **`session_auto_disconnected`** | The session is automatically disconnected after 3 failed QR scan attempts. | `{ "reason": "max_qr_attempts_reached", "timestamp": "..." }`                                           | Informs the backend that the session has been terminated due to excessive failed connection attempts. |
| **`reconnecting`**              | The session is attempting to reconnect after an unexpected disconnection.  | `{ "displayName": "..." }`                                                                              | Notifies the backend that the session is in the process of re-establishing a connection.              |
| **`session_created`**           | A new session is created and begins the initialization process.            | `{ "userId": "...", "sessionName": "...", "status": "initializing" }`                                   | Informs the backend that a new session has been initiated.                                            |

## Message Events

| Event Name            | Trigger                                                          | Payload Sent to Backend    | Purpose                                                                                                                                |
| :-------------------- | :--------------------------------------------------------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **`message`**         | A new message is received from others (contacts, groups).        | _None_ (ready for webhook) | This event is logged internally and ready for webhook implementation to notify backend about incoming messages from external contacts. |
| **`message.any`**     | Any message is received (including own sent messages).           | _None_                     | This event is logged internally for debugging and monitoring all messages including self-sent messages.                                |
| **`messages.update`** | The status of a sent message is updated (e.g., delivered, read). | _None_                     | This event is logged internally for debugging but does not trigger a webhook to the backend.                                           |

## Other Events

| Event Name            | Trigger                                                     | Payload Sent to Backend | Purpose                                                                                      |
| :-------------------- | :---------------------------------------------------------- | :---------------------- | :------------------------------------------------------------------------------------------- |
| **`presence.update`** | A contact's presence status changes (e.g., typing, online). | _None_                  | This event is logged internally for debugging but does not trigger a webhook to the backend. |
| **`creds.update`**    | The session's authentication credentials are updated.       | _None_                  | This event triggers an automatic save of the new credentials to the local file system.       |

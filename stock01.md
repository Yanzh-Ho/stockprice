# System Architecture Overview

## Project

**Anonymous WebSocket Chat** — A serverless, single-channel, anonymous chat room accessible via mobile and desktop browsers.

**Repository:** `git@github.com:samsonchen/ai\_course\_2.git`

## Goals

* Anonymous, no-authentication chat service
* Single global channel — all connected users see all messages
* Real-time message delivery via WebSocket
* Fully serverless backend on AWS
* Static frontend hosted on GitHub Pages
* Minimal infrastructure, minimal cost

## High-Level Architecture

```
┌─────────────────────┐
│   Browser (React)   │
│  GitHub Pages Host   │
└────────┬────────────┘
         │ WebSocket (wss://)
         ▼
┌─────────────────────┐
│  API Gateway         │
│  (WebSocket API)     │
└────────┬────────────┘
         │ Routes: $connect / $disconnect / sendMessage
         ▼
┌─────────────────────┐
│  AWS Lambda (x3)     │
│  Python 3.12         │
├─────────────────────┤
│  connect.handler     │──▶ DynamoDB PUT (store connectionId)
│  disconnect.handler  │──▶ DynamoDB DELETE (remove connectionId)
│  send\_message.handler│──▶ DynamoDB SCAN + PostToConnection fan-out
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  DynamoDB Table      │
│  "Connections"       │
│  PK: connectionId    │
│  Attr: callsign      │
│  Attr: connectedAt   │
└─────────────────────┘
```

## Component Summary

|Component|Technology|Purpose|
|-|-|-|
|Frontend|React + Vite + TypeScript|Chat UI served as static files|
|Hosting|GitHub Pages|Serve the built frontend|
|API Gateway|AWS API Gateway v2 (WebSocket)|Manage WebSocket connections|
|Compute|AWS Lambda (Python 3.12) x3|Handle connect, disconnect, sendMessage|
|Storage|DynamoDB (on-demand)|Track active WebSocket connections only|
|IaC|AWS SAM|Define and deploy all AWS resources|

## Data Flow

### User Connects

1. Browser opens WebSocket to API Gateway endpoint
2. API Gateway triggers `$connect` route → `connect` Lambda
3. Lambda stores `connectionId` and `callsign` in DynamoDB
4. WebSocket connection is established

### User Sends a Message

1. Browser sends JSON payload over WebSocket: `{"action": "sendMessage", "text": "...", "callsign": "..."}`
2. API Gateway matches `sendMessage` route → `send\_message` Lambda
3. Lambda scans DynamoDB for all active `connectionId` values
4. Lambda calls `PostToConnection` API for each connection to push the message
5. If a `PostToConnection` call returns `GoneException`, Lambda deletes that stale connection from DynamoDB

### User Disconnects

1. Browser closes WebSocket (or connection drops)
2. API Gateway triggers `$disconnect` route → `disconnect` Lambda
3. Lambda deletes the `connectionId` from DynamoDB

## Key Design Decisions

### Why WebSocket API (not SQS or MQTT)?

* **SQS** is pull-based. Browsers cannot subscribe to SQS queues directly, so you would need a polling layer, adding latency and complexity.
* **IoT Core MQTT** supports browser WebSocket connections, but requires its own authentication layer and is heavier to configure for a simple single-channel chat.
* **API Gateway WebSocket API** manages connections natively, supports `PostToConnection` for server-push, and scales to zero cost when idle.

### Why DynamoDB (not for messages)?

DynamoDB stores **only active connections**, not messages. It serves as a phone book so the `sendMessage` Lambda can answer "who is currently connected?" Lambda is stateless — there is no shared memory between invocations, so an external store is required. DynamoDB is the lightest serverless option: single table, no provisioning, pay-per-request, sub-millisecond reads.

### Why No Message Persistence?

This is a deliberate design choice. Messages are ephemeral — they are delivered in real-time to connected users and then gone. No chat history, no storage cost, no data retention concerns.

### Why GitHub Pages?

Free static hosting. The frontend is a single-page application (SPA) that makes a cross-origin WebSocket connection to the API Gateway endpoint. WebSocket connections are not subject to CORS restrictions the same way HTTP requests are.

## Repository Structure

```
ai\_course\_2/
├── webui/                          # Frontend (React + Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── ...
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── lambda/
│   ├── connect/                    # $connect Lambda
│   │   ├── connect.py
│   │   └── requirements.txt
│   ├── disconnect/                 # $disconnect Lambda
│   │   ├── disconnect.py
│   │   └── requirements.txt
│   └── send\_message/               # sendMessage Lambda
│       ├── send\_message.py
│       └── requirements.txt
├── documents/                      # Design and spec documents
│   ├── 01-system-architecture.md
│   ├── 02-api-specification.md
│   ├── 03-aws-configuration.md
│   ├── 04-lambda-connect-spec.md
│   ├── 05-lambda-disconnect-spec.md
│   ├── 06-lambda-send-message-spec.md
│   └── 07-frontend-design.md
├── template.yaml                   # SAM template
└── README.md
```

## Cost Estimate (Low Usage)

All components fall within AWS free tier for a demo/educational project with a handful of concurrent users:

* **Lambda:** 1M free requests/month
* **API Gateway WebSocket:** 1M messages free (first 12 months)
* **DynamoDB:** 25 GB storage, 25 WCU/RCU free
* **GitHub Pages:** Free


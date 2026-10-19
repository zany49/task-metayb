# RELAY: API reference

This document describes every endpoint of the RELAY dispatch desk API: what it does, who may call it,
its parameters, example requests and responses, and the errors it can return. It is written from the
server code in `server/src`, so it should match what the API actually does.

**Contents**

1. [Overview](#1-overview)
2. [Errors](#2-errors)
3. [Common objects](#3-common-objects)
4. [Auth](#4-auth)
5. [Riders](#5-riders)
6. [Jobs](#6-jobs)
7. [Recommendations and assignment](#7-recommendations-and-assignment)
8. [Assignments (rider answers)](#8-assignments-rider-answers)
9. [Delivery updates](#9-delivery-updates)
10. [Dashboard](#10-dashboard)
11. [Settings](#11-settings)
12. [Demo controls (simulation)](#12-demo-controls-simulation)
13. [Meta and health](#13-meta-and-health)
14. [Job lifecycle reference](#14-job-lifecycle-reference)
15. [End-to-end example](#15-end-to-end-example)

---

## 1. Overview

### 1.1 Basics

| Item | Value |
|---|---|
| Base URL | `http://localhost:4000/api` (port from `PORT`, default 4000) |
| Format | JSON in, JSON out. Send `Content-Type: application/json` with every request body. |
| Body size limit | 100 kB (larger bodies get `413 PAYLOAD_TOO_LARGE`) |
| Authentication | `Authorization: Bearer <token>` on every endpoint except `/auth/otp/request`, `/auth/otp/verify` and `/health` |
| CORS | Browsers may call the API only from the origins in `CORS_ORIGIN` (default `http://localhost:5173`). Other HTTP clients are not affected. |

Request bodies:

- Without `Content-Type: application/json` the body is not read, and the request fails validation
  (`VALIDATION_ERROR`, path `""`, "Invalid input: expected object, received undefined").
- Unknown fields are ignored. For example, `mobile` in `PATCH /riders/:id` is dropped silently.
- Numbers must be JSON numbers. `"load": "3"` is rejected; `"load": 3` is accepted.
- Enum values (zones, priorities, availability) are case-sensitive and upper case: `"CENTRAL"`, not `"central"`.
  The only exception is the `status` filter of `GET /jobs`, which is upper-cased for you.
- Text fields are trimmed before they are checked.

Endpoints that take no body (for example `POST /assignments/:id/accept`) can be called with an empty body.

### 1.2 Authentication flow

Login is a mobile number plus a one-time code (OTP):

1. `POST /auth/otp/request` with `{ "mobile": "9000000001" }`. The answer is the same whether or not the
   number is registered, so the endpoint cannot be used to find accounts.
2. `POST /auth/otp/verify` with `{ "mobile": "9000000001", "otp": "1234" }`. The response holds a JWT.
3. Send the token on every other call: `Authorization: Bearer <token>`.

Details:

- **Demo code.** No SMS is sent. Every account logs in with the code in `STATIC_OTP` (default `1234`).
  Outside production, the response to step 1 also includes a `demoHint` that shows the code.
- **OTP rules.** A code is valid for `OTP_TTL_SECONDS` (default 300 s), can be used once, and allows
  `OTP_MAX_ATTEMPTS` verify attempts (default 5). A new request replaces any unused code for that number.
- **Token.** HS256 JWT. Claims: `sub` (user id), `role`, `riderId` (riders only), `iat`, `exp`. It lasts
  `JWT_EXPIRES_IN` (default `12h`); the verify response repeats that value as `expiresIn`.
- **Deactivated accounts** are refused on every request, even with a token that has not expired
  (`401 ACCOUNT_INACTIVE`). There is no endpoint to deactivate an account; it is done in the database.
- Mobile numbers are Indian 10-digit numbers starting with 6–9. The API accepts common formats and stores
  10 digits: `9876543210`, `98765 43210`, `+91 98765-43210`, `919876543210`, `09876543210`, `0091 98765 43210`.

### 1.3 Roles

| Role | How the account is created | What it can do |
|---|---|---|
| `DISPATCHER` | Seed script only (there is no endpoint to create dispatchers) | Everything: manage riders, create and cancel jobs, get recommendations, assign and take back jobs, park jobs in the manual queue, record a rider's answer, pickup or delivery on their behalf, dashboard, settings, demo controls |
| `RIDER` | A dispatcher calls `POST /riders` | See their own profile and change their own availability; list their own assignments; accept or decline their own offers; view, pick up, deliver or drop the job they hold; read that job's history and attempts |

A third actor, `SYSTEM`, never logs in. It appears in job history for automatic actions: intake
(`JOB_READY`, `NO_ELIGIBLE_RIDER`) and confirmation timeouts.

A wrong role gets `403 FORBIDDEN` with the message "Only dispatchers can perform this action" or
"Only riders can perform this action".

### 1.4 Time and the app clock

- **In requests**, the only time field is a job's `deadline`. It must be an ISO 8601 date-time **with an
  offset**: `"2026-10-19T18:30:00+05:30"` or `"2026-10-19T13:00:00Z"`. A time without an offset is rejected.
- **In responses**, every time is UTC in ISO 8601 with milliseconds and a `Z` suffix:
  `"2026-10-19T13:00:00.000Z"`. Convert to local time in the client.
- **The app clock.** The server reads "now" from an app clock. Normally it equals real time. With the demo
  controls (section 12) a dispatcher can move it forward, for example by 2 hours to see a confirmation
  timeout. The app clock drives:
  - job, assignment and history timestamps (`createdAt`, `updatedAt`, `statusChangedAt`, `assignedAt`,
    `expiresAt`, `respondedAt`, `endedAt`, event `at`);
  - deadline checks (`DEADLINE_IN_PAST`, `isOverdue`, the `overdue` filter, dashboard counts);
  - confirmation timeouts, `minutesInStatus`, and the deadline part of recommendations.

  It does **not** drive OTP expiry, token expiry, or the `createdAt`/`updatedAt` of riders and settings,
  which use real time. The offset lives in memory: restarting the server returns to real time.
- To show countdowns that stay correct when the clock is moved, compare against the server's time:
  `serverTime` in `GET /meta` and `GET /assignments/mine`, or `now` in `GET /simulation/clock`.

### 1.5 Identifiers and job references

- Ids are MongoDB ObjectIds: 24 hex characters, e.g. `6713845c9b1e4c0012a3f301`. Upper case is accepted.
- **`:jobRef`** in a job URL accepts either the job id or the order reference:
  `/api/jobs/ORD-1001`, `/api/jobs/ord-1001` and `/api/jobs/6713845c9b1e4c0012a3f301` all reach the same job.
  Order references are matched case-insensitively. If the value is 24 hex characters, the API tries it
  both as an id and as an order reference. A `:jobRef` must be 1–40 characters of letters, digits, `-` or `_`.
- **Order references** (`orderRef`) are 3–40 characters: letters, digits, `-` and `_`, starting with a
  letter or digit. They are stored in upper case, so `ord-1001` and `ORD-1001` are the same order.
- **Rider id vs. user id.** A rider has a login account (`userId`) and a rider profile (`id`). Every
  `riderId` in the API is the rider profile id. In history and in `assignedBy` / `respondedBy` / `endedBy`,
  `actor.id` is the **user** id of whoever acted.

### 1.6 Lists and pagination

Only `GET /jobs` is paginated:

```json
{ "items": [], "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
```

- `page` starts at 1 (default 1). `limit` is 1–100 (default 20).
- `totalPages` is `ceil(total / limit)`, so it is 0 when nothing matches. A page past the end returns `items: []`.

Other lists are returned whole: `GET /riders` (`{ items, total }`), `GET /jobs/:jobRef/events`
(`{ jobId, orderRef, status, events }`), `GET /jobs/:jobRef/assignments` (`{ jobId, orderRef, items }`)
and `GET /assignments/mine` (`{ live, recent, serverTime }`, where `recent` holds at most 10 items).

### 1.7 Idempotent job creation

`POST /jobs` is safe to retry. The order reference is the duplicate guard, enforced by a unique index:

| You send | Result |
|---|---|
| A new `orderRef` | `201 Created` and the new job |
| An existing `orderRef` with the same details | `200 OK`, the existing job as it is now, and the header `Idempotent-Replayed: true`. No second job is created; the history gets a `DUPLICATE_SUBMISSION_IGNORED` event. |
| An existing `orderRef` with different details | `409 ORDER_REF_CONFLICT`, with `details.jobId` and `details.differences` |

"Same details" means the same `pickupZone`, `dropZone`, `load`, `priority`, `deadline` (same instant,
whatever the offset) and `notes` (a missing note and an empty note are the same). Remember that
`priority` defaults to `NORMAL`: leaving it out on a retry of a `HIGH` job is a difference.

A retry of an existing order still returns `200` after its deadline has passed. A **new** order with a
past deadline gets `400 DEADLINE_IN_PAST`.

Two identical requests sent at the same moment create one job: one gets `201`, the other `200`.

Other actions are not replayed. Repeating an action that already happened (accept twice, pick up twice)
returns a `409` saying the job or attempt has already moved on.

### 1.8 Concurrency conflicts

Every action that changes data runs in one MongoDB transaction covering the job, the assignment
attempt, the rider's reserved capacity and the history. When two requests race on the same job, rider
or attempt, one wins and the other gets a `409` with one of these codes:

| Code | Typical cause | What the client should do |
|---|---|---|
| `JOB_CHANGED` | The job changed between reading and writing it (another dispatcher, the rider, or the timeout check) | Reload the job and decide again |
| `JOB_ALREADY_ASSIGNED` | Another dispatcher assigned the same job at the same moment | Reload the job to see who has it |
| `JOB_NOT_ASSIGNABLE` | The job is no longer `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE` (already assigned, delivered, cancelled) | Reload the job |
| `RIDER_CAPACITY_CHANGED` | The chosen rider's availability, zones, capacity or job count changed after the recommendations were computed | Reload the recommendations and choose again |
| `ASSIGNMENT_CHANGED` | The assignment attempt was changed by another action (for example a decline and a take-back at the same time) | Reload the job and its attempts |
| `ASSIGNMENT_NOT_PENDING` | Accept or decline on an attempt that already ended or was already accepted | Read `details.status` and the message |
| `ASSIGNMENT_EXPIRED` | The rider's time to confirm ran out | The job is now in the manual queue; reassign it |
| `INVALID_TRANSITION` | The action is not allowed from the job's current status (section 14) | Reload the job; use `nextStatuses` |

The job's `version` field goes up by 1 on every status change. Clients cannot send it, but it is useful
to notice that a job changed while polling.

### 1.9 Order of checks

For most endpoints the checks run in this order, and the first failure is returned:

1. Authentication (`401`), then role (`403`).
2. Validation of the body, path and query (`400 VALIDATION_ERROR`).
3. The job, rider or assignment exists (`404 NOT_FOUND`).
4. A rider may act only on their own job, profile or assignment (`403 FORBIDDEN`).
5. Business rules and current state (`409`, `422`).

Demo controls are the exception: when they are turned off, every `/simulation` path returns
`404 SIMULATION_DISABLED` before authentication.

### 1.10 Endpoint index

| # | Method | Path | Who |
|---|---|---|---|
| 1 | POST | `/auth/otp/request` | Public |
| 2 | POST | `/auth/otp/verify` | Public |
| 3 | GET | `/auth/me` | Any logged-in user |
| 4 | POST | `/riders` | Dispatcher |
| 5 | GET | `/riders` | Dispatcher |
| 6 | GET | `/riders/:id` | Dispatcher, or that rider |
| 7 | PATCH | `/riders/:id` | Dispatcher |
| 8 | PATCH | `/riders/:id/availability` | Dispatcher, or that rider |
| 9 | POST | `/jobs` | Dispatcher |
| 10 | GET | `/jobs` | Dispatcher |
| 11 | GET | `/jobs/:jobRef` | Dispatcher, or the rider linked to the job |
| 12 | GET | `/jobs/:jobRef/events` | Dispatcher, or the rider linked to the job |
| 13 | GET | `/jobs/:jobRef/recommendations` | Dispatcher |
| 14 | POST | `/jobs/:jobRef/assignments` | Dispatcher |
| 15 | GET | `/jobs/:jobRef/assignments` | Dispatcher, or the rider linked to the job |
| 16 | GET | `/assignments/mine` | Rider |
| 17 | POST | `/assignments/:id/accept` | The assigned rider, or a dispatcher |
| 18 | POST | `/assignments/:id/reject` | The assigned rider, or a dispatcher |
| 19 | POST | `/jobs/:jobRef/pickup` | Dispatcher, or the rider holding the job |
| 20 | POST | `/jobs/:jobRef/deliver` | Dispatcher, or the rider holding the job |
| 21 | POST | `/jobs/:jobRef/unassign` | Dispatcher, or the rider holding the job |
| 22 | POST | `/jobs/:jobRef/manual-queue` | Dispatcher |
| 23 | POST | `/jobs/:jobRef/cancel` | Dispatcher |
| 24 | GET | `/dashboard/summary` | Dispatcher |
| 25 | GET | `/settings` | Dispatcher |
| 26 | PATCH | `/settings` | Dispatcher |
| 27 | GET | `/simulation/clock` | Dispatcher (demo controls on) |
| 28 | POST | `/simulation/clock/advance` | Dispatcher (demo controls on) |
| 29 | POST | `/simulation/clock/reset` | Dispatcher (demo controls on) |
| 30 | POST | `/simulation/sweep` | Dispatcher (demo controls on) |
| 31 | GET | `/meta` | Any logged-in user |
| 32 | GET | `/health` | Public |

"The rider linked to the job" means the rider in the job's `riderId`: the rider holding it now, or the
rider who delivered it. When a job goes to the manual queue or is cancelled, `riderId` is cleared and
that rider can no longer open it.

### 1.11 About the examples

Examples use the seed data (`npm run seed`): dispatchers Priya Raman (`9000000001`) and Arjun Mehta,
riders such as Ravi Kumar (`9100000001`), and jobs `ORD-1001` to `ORD-1010`. Each example starts from
freshly seeded data at about 08:00 UTC on 2026-10-19, unless it says otherwise. Ids are sample values.

These ids are used throughout:

| Thing | Id |
|---|---|
| Priya Raman (user) | `6713845a9b1e4c0012a3f001` |
| Ravi Kumar (user / rider) | `6713845b9b1e4c0012a3f101` / `6713845b9b1e4c0012a3f201` |
| Karthik Srinivasan (rider) | `6713845b9b1e4c0012a3f202` |
| Farhan Ali (rider) | `6713845b9b1e4c0012a3f207` |
| Deepa Rajan (rider) | `6713845b9b1e4c0012a3f208` |
| Job `ORD-1001` | `6713845c9b1e4c0012a3f301` |
| First assignment of `ORD-1001` (Ravi) | `67138bd19b1e4c0012a3f401` |

---

## 2. Errors

### 2.1 Error shape

Every error response has the same body:

```json
{
  "error": {
    "code": "RIDER_NOT_ELIGIBLE",
    "message": "Vijay Anand cannot take this job: Off duty; Does not cover North (drop)",
    "details": { "reasons": ["Off duty", "Does not cover North (drop)"] }
  }
}
```

- `code` is stable and machine-readable. Switch on it in the client.
- `message` is a readable sentence that can be shown to the user as it is.
- `details` is present only for some codes (listed below). Its shape depends on the code.

Validation errors list every problem at once, so a form can show them all:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "path": "pickupZone", "message": "Invalid option: expected one of \"CENTRAL\"|\"NORTH\"|\"SOUTH\"|\"EAST\"|\"WEST\"" },
      { "path": "dropZone", "message": "Invalid option: expected one of \"CENTRAL\"|\"NORTH\"|\"SOUTH\"|\"EAST\"|\"WEST\"" },
      { "path": "load", "message": "Too small: expected number to be >=1" }
    ]
  }
}
```

`path` is the field name (`status.0` for the first item of a list). It is `""` when the problem is the
whole body, for example a missing body or `PATCH /riders/:id` with nothing to change.

### 2.2 HTTP statuses used

| Status | Meaning in this API |
|---|---|
| `200 OK` | Success. Also a replayed job creation (with `Idempotent-Replayed: true`). |
| `201 Created` | A rider, job or assignment was created |
| `400 Bad Request` | The request is malformed or fails validation |
| `401 Unauthorized` | Not logged in, bad or expired token, inactive account, or a failed OTP check |
| `403 Forbidden` | Logged in, but not allowed: wrong role, or a rider acting on someone else's job, profile or assignment |
| `404 Not Found` | The job, rider, assignment or route does not exist, or demo controls are off |
| `409 Conflict` | The request clashes with the current state: lifecycle rules, duplicates, or a concurrent change |
| `413 Payload Too Large` | Body over 100 kB |
| `422 Unprocessable Entity` | Well-formed, but breaks an assignment rule |
| `429 Too Many Requests` | Too many wrong OTP attempts |
| `500 Internal Server Error` | Unexpected failure. The details are logged on the server, not returned. |

### 2.3 Error codes

| Code | Status | When it happens | `details` |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | A body, path or query parameter fails validation | `[{ path, message }]` |
| `INVALID_JSON` | 400 | The body is not valid JSON (or is a bare string/number instead of an object) | – |
| `INVALID_ID` | 400 | A value could not be used as a database id. Not expected in normal use, because ids are validated first and fail with `VALIDATION_ERROR`. | – |
| `DEADLINE_IN_PAST` | 400 | `POST /jobs` for a new order whose `deadline` is at or before the app clock's now | `{ deadline, now }` |
| `UNAUTHENTICATED` | 401 | No `Authorization: Bearer ...` header | – |
| `INVALID_TOKEN` | 401 | The token is malformed, has a bad signature, or has unexpected claims | – |
| `TOKEN_EXPIRED` | 401 | The token is past its expiry. Log in again. | – |
| `ACCOUNT_INACTIVE` | 401 | The account was deactivated or removed. Returned on any protected endpoint and on OTP verify. | – |
| `INVALID_OTP` | 401 | Wrong code. The message says how many attempts are left. | – |
| `OTP_EXPIRED` | 401 | No usable code for this number: never requested, expired, already used, or the number is not registered | – |
| `FORBIDDEN` | 403 | Wrong role, or a rider acting on another rider's job, profile or assignment | – |
| `NOT_FOUND` | 404 | The job, rider or assignment does not exist. The message names it: "Job not found", "Rider not found", "Assignment not found". | – |
| `ROUTE_NOT_FOUND` | 404 | No endpoint for this method and path, e.g. "No route for GET /api/does-not-exist" | – |
| `SIMULATION_DISABLED` | 404 | A `/simulation` endpoint while demo controls are off | – |
| `INVALID_TRANSITION` | 409 | The job cannot move from its current status to the one the action needs (section 14) | `{ from, to, allowed }` |
| `JOB_CHANGED` | 409 | The job was changed by another action between read and write | – |
| `JOB_NOT_ASSIGNABLE` | 409 | Recommendations or assignment for a job that is not `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE` | `{ status }` |
| `JOB_ALREADY_ASSIGNED` | 409 | Another assignment for the same job was created at the same moment | – |
| `RIDER_CAPACITY_CHANGED` | 409 | The chosen rider could not be reserved: their availability, zones, free capacity or job slots changed a moment ago | – |
| `ASSIGNMENT_NOT_PENDING` | 409 | Accept or decline on an attempt that is no longer `PENDING`. The message depends on the attempt's status (section 8). | `{ status }` |
| `ASSIGNMENT_EXPIRED` | 409 | Accept, decline or take-back after the confirmation time ran out. **The request still has an effect:** the attempt is marked `EXPIRED` and the job moves to the manual queue before this error is returned. | – |
| `ASSIGNMENT_CHANGED` | 409 | The attempt was changed by another action at the same moment | – |
| `NO_LIVE_ASSIGNMENT` | 409 | The job has no live attempt where one is needed (deliver, take back). A safety check; not expected in normal use. | – |
| `CANNOT_UNASSIGN` | 409 | `POST /jobs/:jobRef/unassign` when the job is not `AWAITING_CONFIRMATION` or `ACCEPTED` | – |
| `USE_DECLINE` | 409 | A rider calls `unassign` on an offer they have not accepted yet; they should decline it | – |
| `CANNOT_MOVE_TO_MANUAL_QUEUE` | 409 | `POST /jobs/:jobRef/manual-queue` when the job is not `READY_FOR_ASSIGNMENT` | – |
| `ORDER_REF_CONFLICT` | 409 | `POST /jobs` with an existing `orderRef` but different details | `{ jobId, differences: [{ field, existing, submitted }] }` |
| `MOBILE_ALREADY_REGISTERED` | 409 | `POST /riders` with a mobile number that any account (rider or dispatcher) already uses | – |
| `RIDER_LOAD_EXCEEDS_LIMIT` | 409 | `PATCH /riders/:id` sets `capacity` below the rider's reserved load, or `maxActiveJobs` below their active jobs | `{ reservedLoad, activeJobs }` |
| `RIDER_PROFILE_MISSING` | 409 | OTP verify for a rider account that has no rider profile (a data problem) | – |
| `DUPLICATE_KEY` | 409 | A unique value clashed in a way the service did not translate into a clearer code. Fallback; not expected in normal use. | The duplicate key and value |
| `PAYLOAD_TOO_LARGE` | 413 | The body is over 100 kB | – |
| `RIDER_NOT_ELIGIBLE` | 422 | Assigning a rider who cannot take this job right now | `{ reasons: [string] }` |
| `OVERRIDE_REASON_REQUIRED` | 422 | Assigning someone other than the top recommended rider without `overrideReason` | `{ recommendedRiderId, recommendedRiderName }` |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | The code has used up its attempts. Even the right code is refused. Request a new one. | – |
| `INTERNAL_ERROR` | 500 | An unexpected error. Message: "Something went wrong. Please try again." | – |

### 2.4 Errors common to many endpoints

To keep the endpoint sections short, they do not repeat these:

- Every endpoint that needs a token can return `401 UNAUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED` or `ACCOUNT_INACTIVE`.
- Every endpoint with a body can return `400 INVALID_JSON` and `413 PAYLOAD_TOO_LARGE`.
- Every endpoint can return `500 INTERNAL_ERROR`.

Unknown paths under a protected prefix (for example `GET /api/jobs/ORD-1001/unknown`) check the token
first, so they return `401` without a token, `403` for the wrong role on dispatcher-only prefixes
(`/dashboard`, `/settings`, `/simulation`), and `404 ROUTE_NOT_FOUND` otherwise.

---

## 3. Common objects

These objects appear in many responses. The endpoint sections show them in full in their examples.

### 3.1 Job

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Job id |
| `orderRef` | string | Order reference, upper case |
| `pickupZone`, `dropZone` | string | `CENTRAL`, `NORTH`, `SOUTH`, `EAST` or `WEST` |
| `load` | integer | Load units the job needs (same unit as rider capacity) |
| `priority` | string | `LOW`, `NORMAL`, `HIGH` or `URGENT` |
| `deadline` | string \| null | Delivery deadline |
| `notes` | string \| null | Free text |
| `status` | string | Current status (section 14) |
| `statusChangedAt` | string | When the current status began |
| `nextStatuses` | string[] | Statuses the job may move to from here. Use it to decide which buttons to show. |
| `minutesInStatus` | integer | Whole minutes since `statusChangedAt` (app clock) |
| `isOverdue` | boolean | `true` when there is a deadline, it has passed, and the job is not `DELIVERED` or `CANCELLED` |
| `riderId`, `riderName` | string \| null | The rider holding the job. Kept after delivery (who delivered it). `null` when unassigned, in the manual queue, or cancelled. |
| `currentAssignmentId` | string \| null | The live assignment attempt, or `null` |
| `confirmationDueAt` | string \| null | While `AWAITING_CONFIRMATION`: when the rider's time to accept runs out |
| `attemptCount` | integer | Assignment attempts so far |
| `manualQueueReason` | object \| null | Why the job is in the manual queue: `{ code, message, at }` (codes in section 14.3). Cleared when the job is assigned again or cancelled. |
| `cancelReason` | string \| null | Why the job was cancelled |
| `version` | integer | Goes up by 1 on every status change |
| `createdBy` | object | `{ type, id, name }` of the dispatcher who created it |
| `createdAt`, `updatedAt` | string | App clock times |

### 3.2 Assignment (one attempt to give a job to a rider)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Assignment id (used in `/assignments/:id/...`) |
| `jobId`, `orderRef` | string | The job |
| `riderId`, `riderName` | string | The rider who was asked |
| `load` | integer | Units reserved on the rider for this attempt |
| `attempt` | integer | 1 for the first attempt on the job, 2 for the next, and so on |
| `status` | string | `PENDING`, `ACCEPTED`, `COMPLETED`, `REJECTED`, `EXPIRED`, `WITHDRAWN`, `RELEASED` or `CANCELLED` (section 14.4) |
| `active` | boolean | `true` while `PENDING` or `ACCEPTED` (the rider holds the job and its load is reserved) |
| `assignedAt`, `assignedBy` | string, object | When and by whom (`{ type, id, name }`) |
| `expiresAt` | string | When a `PENDING` attempt expires. Kept as a record after the rider answers. |
| `timeoutMinutes` | integer | The confirmation timeout that applied to this attempt |
| `respondedAt`, `respondedBy` | string \| null, object \| null | When and by whom the offer was accepted or declined |
| `endedAt`, `endedBy` | string \| null, object \| null | When and by whom the attempt ended |
| `endReason` | object \| null | `{ code, message }` (codes in section 14.4) |
| `isOverride` | boolean | `true` when the dispatcher chose someone other than the top recommendation |
| `overrideReason` | string \| null | The dispatcher's reason for the override |
| `recommendation` | object \| null | What the dispatcher saw when assigning: `{ rank, score, reasons, warnings, recommendedRider: { riderId, name, score }, shortlist: [{ riderId, name, rank, score }] }` (top 3) |

### 3.3 Rider

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Rider profile id (the `riderId` used everywhere) |
| `userId` | string | Login account id |
| `name`, `mobile` | string | From the login account; `mobile` is 10 digits |
| `isActive` | boolean | `false` if the login account is deactivated |
| `zones` | string[] | Zones the rider covers |
| `capacity` | integer | Load units the rider can carry at once |
| `maxActiveJobs` | integer | Most jobs the rider may hold at once |
| `availability` | string | `AVAILABLE`, `ON_BREAK` or `OFF_DUTY` |
| `currentZone` | string | Simulated location. It changes to the pickup zone on pickup and to the drop zone on delivery. |
| `reservedLoad` | integer | Units held by the rider's live assignments |
| `activeJobs` | integer | Number of live assignments |
| `workload` | object | `{ spareCapacity, slotsLeft, canTakeMoreJobs, blockers: [string] }`. `canTakeMoreJobs` ignores zones and job size, which are checked per job by the recommendations. |
| `createdAt`, `updatedAt` | string | Real time (not the app clock) |

### 3.4 Job event (history entry)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Event id |
| `type` | string | What happened (section 6.4) |
| `at` | string | When (app clock) |
| `actor` | object | `{ type: "DISPATCHER" \| "RIDER" \| "SYSTEM", id, name }`. For people, `id` is the user id. For the system it is `{ "type": "SYSTEM", "id": "system", "name": "System" }`. |
| `message` | string | One readable sentence |
| `fromStatus`, `toStatus` | string \| null | Set when the job's status changed |
| `assignmentId`, `riderId` | string \| null | Set when the event concerns an assignment |
| `details` | object | Extra facts. Present only on some event types. |

---

## 4. Auth

### 4.1 POST /auth/otp/request

**Who:** public. **Purpose:** start a login by asking for a one-time code.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `mobile` | body | string | yes | Indian mobile number; normalised to 10 digits starting 6–9 (section 1.2) |

**Example request:** `POST /api/auth/otp/request`

```json
{ "mobile": "+91 90000-00001" }
```

**Example response:** `200 OK`

```json
{
  "message": "If this mobile number is registered, an OTP has been sent.",
  "expiresInSeconds": 300,
  "demoHint": "Demo mode: the OTP is 1234"
}
```

`demoHint` is left out when `NODE_ENV=production`. The response is the same for unknown and
deactivated numbers; no code is created for them, so a later verify fails with `OTP_EXPIRED`.

**Errors:** `400 VALIDATION_ERROR` (`mobile`: "Mobile number is required" or "Enter a valid 10-digit mobile number").

### 4.2 POST /auth/otp/verify

**Who:** public. **Purpose:** check the code and get an access token.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `mobile` | body | string | yes | Same rules as above |
| `otp` | body | string | yes | 4–6 digits, as a string |

**Example request:** `POST /api/auth/otp/verify`

```json
{ "mobile": "9000000001", "otp": "1234" }
```

**Example response:** `200 OK` (dispatcher)

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiRElTUEFUQ0hFUiIsImlhdCI6MTc5MjM5NzcwMCwiZXhwIjoxNzkyNDQwOTAwLCJzdWIiOiI2NzEzODQ1YTliMWU0YzAwMTJhM2YwMDEifQ.12DWoDqb9W-DFIszJfMMOJu5o8z-hZqrU4yIftHVtUU",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "6713845a9b1e4c0012a3f001",
    "name": "Priya Raman",
    "mobile": "9000000001",
    "role": "DISPATCHER"
  }
}
```

For a rider, `user` also has `riderId`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiUklERVIiLCJyaWRlcklkIjoiNjcxMzg0NWI5YjFlNGMwMDEyYTNmMjAxIiwiaWF0IjoxNzkyMzk3NzAwLCJleHAiOjE3OTI0NDA5MDAsInN1YiI6IjY3MTM4NDViOWIxZTRjMDAxMmEzZjEwMSJ9.nUejLgX2KyXaPvHmzOdtmXcLKXP_qcYSu7AUR28XE6Y",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "6713845b9b1e4c0012a3f101",
    "name": "Ravi Kumar",
    "mobile": "9100000001",
    "role": "RIDER",
    "riderId": "6713845b9b1e4c0012a3f201"
  }
}
```

**Errors:**

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad `mobile`; `otp` missing ("OTP is required") or not 4–6 digits ("OTP must be 4-6 digits") |
| `OTP_EXPIRED` | 401 | No live code: "OTP has expired or was not requested. Please request a new OTP." (also for unregistered numbers), or "This OTP has already been used. Please request a new OTP." |
| `INVALID_OTP` | 401 | Wrong code: "Incorrect OTP. 4 attempt(s) left." On the last allowed attempt: "Incorrect OTP. Please request a new OTP." |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | All attempts used: "Too many incorrect attempts. Please request a new OTP." |
| `ACCOUNT_INACTIVE` | 401 | The account was deactivated after the code was requested |
| `RIDER_PROFILE_MISSING` | 409 | Rider account without a rider profile |

### 4.3 GET /auth/me

**Who:** any logged-in user. **Purpose:** the logged-in user, plus their rider profile for riders.

No parameters.

**Example response:** `200 OK` (dispatcher)

```json
{
  "user": {
    "id": "6713845a9b1e4c0012a3f001",
    "name": "Priya Raman",
    "mobile": "9000000001",
    "role": "DISPATCHER"
  }
}
```

**Example response:** `200 OK` (rider)

```json
{
  "user": {
    "id": "6713845b9b1e4c0012a3f101",
    "name": "Ravi Kumar",
    "mobile": "9100000001",
    "role": "RIDER",
    "riderId": "6713845b9b1e4c0012a3f201"
  },
  "rider": {
    "id": "6713845b9b1e4c0012a3f201",
    "userId": "6713845b9b1e4c0012a3f101",
    "name": "Ravi Kumar",
    "mobile": "9100000001",
    "isActive": true,
    "zones": ["CENTRAL", "NORTH"],
    "capacity": 10,
    "maxActiveJobs": 3,
    "availability": "AVAILABLE",
    "currentZone": "CENTRAL",
    "reservedLoad": 0,
    "activeJobs": 0,
    "workload": { "spareCapacity": 10, "slotsLeft": 3, "canTakeMoreJobs": true, "blockers": [] },
    "createdAt": "2026-10-19T07:59:58.912Z",
    "updatedAt": "2026-10-19T07:59:58.912Z"
  }
}
```

**Errors:** only the common authentication errors (section 2.4).

---

## 5. Riders

### 5.1 POST /riders

**Who:** dispatcher. **Purpose:** add a rider. This creates their login account and rider profile together.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `name` | body | string | yes | 2–80 characters |
| `mobile` | body | string | yes | Indian mobile number, normalised to 10 digits; must not belong to any account |
| `zones` | body | string[] | yes | At least one zone; duplicates are removed |
| `capacity` | body | integer | yes | 1–1000 load units |
| `maxActiveJobs` | body | integer | no | 1–20; default `3` |
| `currentZone` | body | string | yes | A zone (the rider's simulated location) |
| `availability` | body | string | no | `AVAILABLE`, `ON_BREAK` or `OFF_DUTY`; default `AVAILABLE` |

**Example request:** `POST /api/riders`

```json
{
  "name": "Lakshmi Narayanan",
  "mobile": "+91 98765-43210",
  "zones": ["CENTRAL", "NORTH"],
  "capacity": 8,
  "maxActiveJobs": 2,
  "currentZone": "CENTRAL"
}
```

**Example response:** `201 Created`

```json
{
  "id": "67138c019b1e4c0012a3f209",
  "userId": "67138c019b1e4c0012a3f109",
  "name": "Lakshmi Narayanan",
  "mobile": "9876543210",
  "isActive": true,
  "zones": ["CENTRAL", "NORTH"],
  "capacity": 8,
  "maxActiveJobs": 2,
  "availability": "AVAILABLE",
  "currentZone": "CENTRAL",
  "reservedLoad": 0,
  "activeJobs": 0,
  "workload": { "spareCapacity": 8, "slotsLeft": 2, "canTakeMoreJobs": true, "blockers": [] },
  "createdAt": "2026-10-19T08:12:33.418Z",
  "updatedAt": "2026-10-19T08:12:33.418Z"
}
```

The new rider can log in straight away with their mobile number.

**Errors:** `400 VALIDATION_ERROR` (every invalid field is listed); `403 FORBIDDEN` (riders);
`409 MOBILE_ALREADY_REGISTERED` ("An account with this mobile number already exists").

### 5.2 GET /riders

**Who:** dispatcher. **Purpose:** list riders, with optional filters. Sorted by name. Not paginated.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `availability` | query | string | no | `AVAILABLE`, `ON_BREAK` or `OFF_DUTY` |
| `zone` | query | string | no | Riders who cover this zone |
| `q` | query | string | no | 1–50 characters; case-insensitive "contains" search on name or mobile |

The list includes riders whose account is deactivated (`isActive: false`).

**Example request:** `GET /api/riders?zone=SOUTH&availability=AVAILABLE`

**Example response:** `200 OK`

```json
{
  "items": [
    {
      "id": "6713845b9b1e4c0012a3f208",
      "userId": "6713845b9b1e4c0012a3f108",
      "name": "Deepa Rajan",
      "mobile": "9100000008",
      "isActive": true,
      "zones": ["CENTRAL", "NORTH", "SOUTH", "EAST", "WEST"],
      "capacity": 10,
      "maxActiveJobs": 3,
      "availability": "AVAILABLE",
      "currentZone": "WEST",
      "reservedLoad": 0,
      "activeJobs": 0,
      "workload": { "spareCapacity": 10, "slotsLeft": 3, "canTakeMoreJobs": true, "blockers": [] },
      "createdAt": "2026-10-19T07:59:59.240Z",
      "updatedAt": "2026-10-19T08:00:01.954Z"
    },
    {
      "id": "6713845b9b1e4c0012a3f202",
      "userId": "6713845b9b1e4c0012a3f102",
      "name": "Karthik Srinivasan",
      "mobile": "9100000002",
      "isActive": true,
      "zones": ["CENTRAL", "SOUTH", "EAST"],
      "capacity": 8,
      "maxActiveJobs": 3,
      "availability": "AVAILABLE",
      "currentZone": "SOUTH",
      "reservedLoad": 7,
      "activeJobs": 2,
      "workload": { "spareCapacity": 1, "slotsLeft": 1, "canTakeMoreJobs": true, "blockers": [] },
      "createdAt": "2026-10-19T07:59:58.961Z",
      "updatedAt": "2026-10-19T08:00:02.640Z"
    }
  ],
  "total": 2
}
```

**Errors:** `400 VALIDATION_ERROR` (bad filter value); `403 FORBIDDEN` (riders).

### 5.3 GET /riders/:id

**Who:** dispatcher (any rider), or a rider (only their own profile). **Purpose:** one rider with their current workload.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `id` | path | string | yes | Rider id (24 hex characters) |

**Example request:** `GET /api/riders/6713845b9b1e4c0012a3f201`

**Example response:** `200 OK`

```json
{
  "id": "6713845b9b1e4c0012a3f201",
  "userId": "6713845b9b1e4c0012a3f101",
  "name": "Ravi Kumar",
  "mobile": "9100000001",
  "isActive": true,
  "zones": ["CENTRAL", "NORTH"],
  "capacity": 10,
  "maxActiveJobs": 3,
  "availability": "AVAILABLE",
  "currentZone": "CENTRAL",
  "reservedLoad": 0,
  "activeJobs": 0,
  "workload": { "spareCapacity": 10, "slotsLeft": 3, "canTakeMoreJobs": true, "blockers": [] },
  "createdAt": "2026-10-19T07:59:58.912Z",
  "updatedAt": "2026-10-19T07:59:58.912Z"
}
```

**Errors:** `400 VALIDATION_ERROR` (`id`: "Invalid id"); `403 FORBIDDEN` ("Riders can only view their own profile");
`404 NOT_FOUND` ("Rider not found").

### 5.4 PATCH /riders/:id

**Who:** dispatcher. **Purpose:** change a rider's name, zones, capacity, job limit or location.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `id` | path | string | yes | Rider id |
| `name` | body | string | no | 2–80 characters |
| `zones` | body | string[] | no | At least one zone; duplicates removed |
| `capacity` | body | integer | no | 1–1000, and not below the rider's current `reservedLoad` |
| `maxActiveJobs` | body | integer | no | 1–20, and not below the rider's current `activeJobs` |
| `currentZone` | body | string | no | A zone |

Send at least one field. `mobile` cannot be changed (it is the login identity) and `availability` has
its own endpoint; both are ignored here. Changes apply to future recommendations; jobs the rider
already holds stay with them.

**Example request:** `PATCH /api/riders/6713845b9b1e4c0012a3f201`

```json
{ "capacity": 12, "zones": ["CENTRAL", "NORTH", "EAST"] }
```

**Example response:** `200 OK`

```json
{
  "id": "6713845b9b1e4c0012a3f201",
  "userId": "6713845b9b1e4c0012a3f101",
  "name": "Ravi Kumar",
  "mobile": "9100000001",
  "isActive": true,
  "zones": ["CENTRAL", "NORTH", "EAST"],
  "capacity": 12,
  "maxActiveJobs": 3,
  "availability": "AVAILABLE",
  "currentZone": "CENTRAL",
  "reservedLoad": 0,
  "activeJobs": 0,
  "workload": { "spareCapacity": 12, "slotsLeft": 3, "canTakeMoreJobs": true, "blockers": [] },
  "createdAt": "2026-10-19T07:59:58.912Z",
  "updatedAt": "2026-10-19T08:14:09.302Z"
}
```

**Example error:** `409 Conflict` for `{ "capacity": 5 }` on Karthik, who has 7 units reserved

```json
{
  "error": {
    "code": "RIDER_LOAD_EXCEEDS_LIMIT",
    "message": "Limits cannot be set below the rider's current workload (7 units reserved, 2 active jobs)",
    "details": { "reservedLoad": 7, "activeJobs": 2 }
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (including "Provide at least one field to update", path `""`);
`403 FORBIDDEN` (riders); `404 NOT_FOUND`; `409 RIDER_LOAD_EXCEEDS_LIMIT`.

### 5.5 PATCH /riders/:id/availability

**Who:** dispatcher (any rider), or a rider (only their own). **Purpose:** set a rider as available, on break or off duty.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `id` | path | string | yes | Rider id |
| `availability` | body | string | yes | `AVAILABLE`, `ON_BREAK` or `OFF_DUTY` |

Availability affects new assignments only. Jobs the rider already holds stay with them, and a pending
offer can still be accepted.

**Example request:** `PATCH /api/riders/6713845b9b1e4c0012a3f201/availability` (Ravi's own token)

```json
{ "availability": "ON_BREAK" }
```

**Example response:** `200 OK`

```json
{
  "id": "6713845b9b1e4c0012a3f201",
  "userId": "6713845b9b1e4c0012a3f101",
  "name": "Ravi Kumar",
  "mobile": "9100000001",
  "isActive": true,
  "zones": ["CENTRAL", "NORTH"],
  "capacity": 10,
  "maxActiveJobs": 3,
  "availability": "ON_BREAK",
  "currentZone": "CENTRAL",
  "reservedLoad": 0,
  "activeJobs": 0,
  "workload": { "spareCapacity": 10, "slotsLeft": 3, "canTakeMoreJobs": false, "blockers": ["Rider is on break"] },
  "createdAt": "2026-10-19T07:59:58.912Z",
  "updatedAt": "2026-10-19T08:15:47.611Z"
}
```

**Errors:** `400 VALIDATION_ERROR`; `403 FORBIDDEN` ("Riders can only change availability on their own profile");
`404 NOT_FOUND`.

---

## 6. Jobs

### 6.1 POST /jobs

**Who:** dispatcher. **Purpose:** create a delivery job from an order. Safe to retry (section 1.7).

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `orderRef` | body | string | yes | 3–40 characters: letters, digits, `-`, `_`; starts with a letter or digit; stored upper case |
| `pickupZone` | body | string | yes | A zone |
| `dropZone` | body | string | yes | A zone (may equal `pickupZone`) |
| `load` | body | integer | yes | 1–1000 load units |
| `priority` | body | string | no | `LOW`, `NORMAL`, `HIGH`, `URGENT`; default `NORMAL` |
| `deadline` | body | string \| null | no | ISO 8601 date-time with offset; must be in the future (app clock) for a new order |
| `notes` | body | string | no | Up to 500 characters |

What happens on creation, in one transaction:

1. The job is saved as `NEW` (event `JOB_CREATED`).
2. Intake moves it to `READY_FOR_ASSIGNMENT` (event `JOB_READY`, actor `SYSTEM`).
3. If no rider at all could take it right now (zone not covered, too heavy, everyone off duty...), it moves
   straight to `MANUAL_QUEUE` with reason `NO_ELIGIBLE_RIDER`, and the message says why.

So a new job comes back as `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE`.

**Example request:** `POST /api/jobs`

```json
{
  "orderRef": "ORD-2001",
  "pickupZone": "CENTRAL",
  "dropZone": "NORTH",
  "load": 3,
  "priority": "HIGH",
  "deadline": "2026-10-19T18:30:00+05:30",
  "notes": "Ring the bell"
}
```

**Example response:** `201 Created`

```json
{
  "id": "67138e249b1e4c0012a3f3a1",
  "orderRef": "ORD-2001",
  "pickupZone": "CENTRAL",
  "dropZone": "NORTH",
  "load": 3,
  "priority": "HIGH",
  "deadline": "2026-10-19T13:00:00.000Z",
  "notes": "Ring the bell",
  "status": "READY_FOR_ASSIGNMENT",
  "statusChangedAt": "2026-10-19T08:30:00.541Z",
  "nextStatuses": ["AWAITING_CONFIRMATION", "MANUAL_QUEUE", "CANCELLED"],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": null,
  "riderName": null,
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 0,
  "manualQueueReason": null,
  "cancelReason": null,
  "version": 1,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:30:00.517Z",
  "updatedAt": "2026-10-19T08:30:00.541Z"
}
```

Sending the same body again returns `200 OK` with the same job and the header `Idempotent-Replayed: true`.
(Browsers calling from another origin cannot read that header, because the server does not expose it
through CORS; compare the status code, `201` or `200`, instead.)

**Example error:** `409 Conflict` for the same `orderRef` with `"load": 5`

```json
{
  "error": {
    "code": "ORDER_REF_CONFLICT",
    "message": "Order ORD-2001 already exists with different details. Use a new order reference for a different job.",
    "details": {
      "jobId": "67138e249b1e4c0012a3f3a1",
      "differences": [{ "field": "load", "existing": 3, "submitted": 5 }]
    }
  }
}
```

**Example error:** `400 Bad Request` for a new order with a deadline in the past

```json
{
  "error": {
    "code": "DEADLINE_IN_PAST",
    "message": "The delivery deadline must be in the future",
    "details": { "deadline": "2026-10-19T07:30:00.000Z", "now": "2026-10-19T08:30:00.517Z" }
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (e.g. "orderRef is required", "deadline must be an ISO date-time with timezone,
e.g. 2026-10-19T18:30:00+05:30"); `400 DEADLINE_IN_PAST`; `403 FORBIDDEN` (riders); `409 ORDER_REF_CONFLICT`.

### 6.2 GET /jobs

**Who:** dispatcher. **Purpose:** list, filter and search jobs, with pagination.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `status` | query | string | no | One or more statuses, comma-separated (`status=READY_FOR_ASSIGNMENT,MANUAL_QUEUE`) or repeated (`status=A&status=B`). Case-insensitive. |
| `zone` | query | string | no | Jobs whose pickup **or** drop zone is this zone |
| `priority` | query | string | no | `LOW`, `NORMAL`, `HIGH` or `URGENT` |
| `q` | query | string | no | 1–40 characters; order reference contains this text (case-insensitive) |
| `riderId` | query | string | no | Jobs whose `riderId` is this rider: jobs they hold now, and jobs they delivered |
| `overdue` | query | string | no | `true`: only open jobs (not delivered or cancelled) whose deadline has passed. Combined with `status`, only the open statuses in it count. `false` is the same as leaving it out. |
| `sort` | query | string | no | `newest` (default), `oldest`, or `priority` (`URGENT` first, then oldest first) |
| `page` | query | integer | no | ≥ 1; default `1` |
| `limit` | query | integer | no | 1–100; default `20` |

All filters combine with AND.

**Example request:** `GET /api/jobs?status=READY_FOR_ASSIGNMENT,MANUAL_QUEUE&sort=priority&limit=2`

**Example response:** `200 OK` (requested at 08:20 UTC)

```json
{
  "items": [
    {
      "id": "6713845c9b1e4c0012a3f304",
      "orderRef": "ORD-1004",
      "pickupZone": "NORTH",
      "dropZone": "EAST",
      "load": 4,
      "priority": "URGENT",
      "deadline": "2026-10-19T08:45:00.000Z",
      "notes": "Medical supplies, deliver first",
      "status": "READY_FOR_ASSIGNMENT",
      "statusChangedAt": "2026-10-19T08:00:01.580Z",
      "nextStatuses": ["AWAITING_CONFIRMATION", "MANUAL_QUEUE", "CANCELLED"],
      "minutesInStatus": 19,
      "isOverdue": false,
      "riderId": null,
      "riderName": null,
      "currentAssignmentId": null,
      "confirmationDueAt": null,
      "attemptCount": 0,
      "manualQueueReason": null,
      "cancelReason": null,
      "version": 1,
      "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "createdAt": "2026-10-19T08:00:01.562Z",
      "updatedAt": "2026-10-19T08:00:01.580Z"
    },
    {
      "id": "6713845c9b1e4c0012a3f30a",
      "orderRef": "ORD-1010",
      "pickupZone": "CENTRAL",
      "dropZone": "EAST",
      "load": 20,
      "priority": "URGENT",
      "deadline": "2026-10-19T09:00:00.000Z",
      "notes": "Bulk order, needs a large carrier",
      "status": "MANUAL_QUEUE",
      "statusChangedAt": "2026-10-19T08:00:02.195Z",
      "nextStatuses": ["AWAITING_CONFIRMATION", "CANCELLED"],
      "minutesInStatus": 19,
      "isOverdue": false,
      "riderId": null,
      "riderName": null,
      "currentAssignmentId": null,
      "confirmationDueAt": null,
      "attemptCount": 0,
      "manualQueueReason": {
        "code": "NO_ELIGIBLE_RIDER",
        "message": "No rider can take this job right now. 8 checked: 3 do not cover the drop zone, 2 lack free capacity, 1 on break, 1 do not cover the pickup zone, 1 off duty",
        "at": "2026-10-19T08:00:02.195Z"
      },
      "cancelReason": null,
      "version": 2,
      "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "createdAt": "2026-10-19T08:00:02.170Z",
      "updatedAt": "2026-10-19T08:00:02.195Z"
    }
  ],
  "page": 1,
  "limit": 2,
  "total": 5,
  "totalPages": 3
}
```

**Errors:** `400 VALIDATION_ERROR` (e.g. `status=LOST`, `zone=MOON`, `limit=500`, `overdue=yes`); `403 FORBIDDEN` (riders).

### 6.3 GET /jobs/:jobRef

**Who:** dispatcher (any job), or the rider linked to the job (section 1.10). **Purpose:** one job.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Job id or order reference (section 1.5) |

**Example request:** `GET /api/jobs/ORD-1001`

**Example response:** `200 OK` (requested at 08:20 UTC)

```json
{
  "id": "6713845c9b1e4c0012a3f301",
  "orderRef": "ORD-1001",
  "pickupZone": "CENTRAL",
  "dropZone": "NORTH",
  "load": 3,
  "priority": "NORMAL",
  "deadline": "2026-10-19T10:00:00.000Z",
  "notes": null,
  "status": "READY_FOR_ASSIGNMENT",
  "statusChangedAt": "2026-10-19T08:00:01.231Z",
  "nextStatuses": ["AWAITING_CONFIRMATION", "MANUAL_QUEUE", "CANCELLED"],
  "minutesInStatus": 19,
  "isOverdue": false,
  "riderId": null,
  "riderName": null,
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 0,
  "manualQueueReason": null,
  "cancelReason": null,
  "version": 1,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.204Z",
  "updatedAt": "2026-10-19T08:00:01.231Z"
}
```

**Errors:** `400 VALIDATION_ERROR` (`jobRef`: "Use a job id or an order reference"); `404 NOT_FOUND` ("Job not found");
`403 FORBIDDEN` ("Riders can only view jobs assigned to them").

### 6.4 GET /jobs/:jobRef/events

**Who:** dispatcher, or the rider linked to the job. **Purpose:** the job's full history, oldest first.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Job id or order reference |

History is append-only: events are never edited or removed.

**Event types**

| Type | Meaning | Status change | `details` |
|---|---|---|---|
| `JOB_CREATED` | A dispatcher created the job | – → `NEW` | `{ pickupZone, dropZone, load, priority, deadline }` |
| `JOB_READY` | Intake passed (actor `SYSTEM`) | `NEW` → `READY_FOR_ASSIGNMENT` | – |
| `DUPLICATE_SUBMISSION_IGNORED` | The same order was submitted again; the existing job was returned | none | – |
| `RIDER_ASSIGNED` | First assignment attempt | → `AWAITING_CONFIRMATION` | `{ attempt, isOverride, overrideReason, expiresAt, timeoutMinutes, rank, score, reasons, warnings, recommendedRider, shortlist }` |
| `RIDER_REASSIGNED` | A later attempt (after an earlier one ended) | → `AWAITING_CONFIRMATION` | Same as `RIDER_ASSIGNED` |
| `ASSIGNMENT_ACCEPTED` | The rider accepted (or a dispatcher recorded it) | → `ACCEPTED` | – |
| `ASSIGNMENT_REJECTED` | The rider declined | none (followed by `MOVED_TO_MANUAL_QUEUE`) | `{ reason }` |
| `ASSIGNMENT_EXPIRED` | No answer in time (actor `SYSTEM`) | none (followed by `MOVED_TO_MANUAL_QUEUE`) | `{ assignedAt, expiresAt, timeoutMinutes }` |
| `ASSIGNMENT_WITHDRAWN` | A dispatcher took the job back | none (followed by `MOVED_TO_MANUAL_QUEUE`) | `{ reason }` |
| `ASSIGNMENT_RELEASED` | The rider dropped a job they had accepted | none (followed by `MOVED_TO_MANUAL_QUEUE`) | `{ reason }` |
| `MOVED_TO_MANUAL_QUEUE` | The job needs a dispatcher | → `MANUAL_QUEUE` | `{ code, ... }`: `code` is the manual queue reason; plus `reason`, or `notEligible: [{ name, reasons }]` for `NO_ELIGIBLE_RIDER` |
| `JOB_PICKED_UP` | Pickup recorded | `ACCEPTED` → `PICKED_UP` | – |
| `JOB_DELIVERED` | Delivery recorded | `PICKED_UP` → `DELIVERED` | – |
| `JOB_CANCELLED` | A dispatcher cancelled the job | → `CANCELLED` | `{ reason }` |

**Example request:** `GET /api/jobs/ORD-1001/events` (after Ravi was assigned and accepted)

**Example response:** `200 OK`

```json
{
  "jobId": "6713845c9b1e4c0012a3f301",
  "orderRef": "ORD-1001",
  "status": "ACCEPTED",
  "events": [
    {
      "id": "6713845c9b1e4c0012a3f501",
      "type": "JOB_CREATED",
      "at": "2026-10-19T08:00:01.209Z",
      "actor": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "message": "Priya Raman created job ORD-1001",
      "fromStatus": null,
      "toStatus": "NEW",
      "assignmentId": null,
      "riderId": null,
      "details": {
        "pickupZone": "CENTRAL",
        "dropZone": "NORTH",
        "load": 3,
        "priority": "NORMAL",
        "deadline": "2026-10-19T10:00:00.000Z"
      }
    },
    {
      "id": "6713845c9b1e4c0012a3f502",
      "type": "JOB_READY",
      "at": "2026-10-19T08:00:01.231Z",
      "actor": { "type": "SYSTEM", "id": "system", "name": "System" },
      "message": "Intake checks passed; job is ready for assignment",
      "fromStatus": "NEW",
      "toStatus": "READY_FOR_ASSIGNMENT",
      "assignmentId": null,
      "riderId": null
    },
    {
      "id": "67138bd19b1e4c0012a3f511",
      "type": "RIDER_ASSIGNED",
      "at": "2026-10-19T08:21:05.334Z",
      "actor": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "message": "Priya Raman assigned Ravi Kumar (recommended, 8 min from pickup). Ravi Kumar has 120 min to confirm.",
      "fromStatus": "READY_FOR_ASSIGNMENT",
      "toStatus": "AWAITING_CONFIRMATION",
      "assignmentId": "67138bd19b1e4c0012a3f401",
      "riderId": "6713845b9b1e4c0012a3f201",
      "details": {
        "attempt": 1,
        "isOverride": false,
        "overrideReason": null,
        "expiresAt": "2026-10-19T10:21:05.310Z",
        "timeoutMinutes": 120,
        "rank": 1,
        "score": 96,
        "reasons": [
          "8 min to pickup (closest)",
          "No other jobs right now",
          "7 of 10 units free after this job",
          "Can deliver about 71 min before the deadline"
        ],
        "warnings": [],
        "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 96 },
        "shortlist": [
          { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 96 },
          { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 89 },
          { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 88 }
        ]
      }
    },
    {
      "id": "67138ca89b1e4c0012a3f512",
      "type": "ASSIGNMENT_ACCEPTED",
      "at": "2026-10-19T08:24:40.131Z",
      "actor": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
      "message": "Ravi Kumar accepted the job",
      "fromStatus": "AWAITING_CONFIRMATION",
      "toStatus": "ACCEPTED",
      "assignmentId": "67138bd19b1e4c0012a3f401",
      "riderId": "6713845b9b1e4c0012a3f201"
    }
  ]
}
```

**Errors:** `400 VALIDATION_ERROR`; `404 NOT_FOUND`; `403 FORBIDDEN` ("Riders can only view jobs assigned to them").

---

## 7. Recommendations and assignment

### 7.1 GET /jobs/:jobRef/recommendations

**Who:** dispatcher. **Purpose:** the riders who can take this job, ranked with reasons, and the riders
who cannot, with why. Computed fresh on every call.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Job id or order reference. The job must be `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE`. |

How riders are chosen and ranked (full rules in `server/src/domain/recommendation.js`):

- **Not eligible** if any of these is true: off duty; on break; declined this job earlier; accepted this
  job earlier and then dropped it; does not cover the pickup zone; does not cover the drop zone; not
  enough free capacity for the load; already at their job limit. Deactivated accounts are left out entirely.
- **Score 0–100** from four parts, each 0–100 in `breakdown`: `travel` (minutes from the rider's
  `currentZone` to the pickup), `workload` (free job slots), `deadline` (time to spare after the estimated
  delivery; 60 minutes or more scores full; no deadline scores full), `capacity` (room left after this job).
  Weights for `LOW`/`NORMAL`: travel 0.40, workload 0.25, deadline 0.20, capacity 0.15. For `HIGH`/`URGENT`:
  0.55, 0.10, 0.25, 0.10.
- A rider who let this same job time out earlier stays eligible but loses 20 points and gets the warning
  "Did not respond to this job earlier".
- Ties go to the closer rider, then fewer jobs, then name.

Response fields:

| Field | Meaning |
|---|---|
| `generatedAt` | App clock time of the calculation |
| `confirmationTimeoutMinutes` | How long the chosen rider will have to accept |
| `recommended[]` | Eligible riders, best first |
| `recommended[].rank`, `.score` | Position (1 = recommended) and score |
| `recommended[].travelToPickupMinutes` | Minutes from the rider's current zone to the pickup zone |
| `recommended[].etaMinutes` | To pickup + 5 minutes handling + pickup to drop |
| `recommended[].deadlineSlackMinutes` | Minutes to spare before the deadline (negative = late); `null` when the job has no deadline |
| `recommended[].activeJobs`, `.maxActiveJobs`, `.capacity`, `.spareCapacityAfter`, `.currentZone` | The rider's workload, and units left after this job |
| `recommended[].breakdown` | The four part-scores, 0–100 each |
| `recommended[].reasons` | Readable reasons for the ranking |
| `recommended[].warnings` | E.g. "May miss the deadline by about 10 min", "Did not respond to this job earlier" |
| `recommended[].whyAboveNext` | Why this rider ranks above the next one; `null` for the last |
| `notEligible[]` | `{ riderId, name, reasons }`, sorted by name |

**Example request:** `GET /api/jobs/ORD-1001/recommendations`

**Example response:** `200 OK`

```json
{
  "jobId": "6713845c9b1e4c0012a3f301",
  "orderRef": "ORD-1001",
  "status": "READY_FOR_ASSIGNMENT",
  "generatedAt": "2026-10-19T08:20:00.412Z",
  "confirmationTimeoutMinutes": 120,
  "recommended": [
    {
      "riderId": "6713845b9b1e4c0012a3f201",
      "name": "Ravi Kumar",
      "score": 96,
      "travelToPickupMinutes": 8,
      "etaMinutes": 28,
      "deadlineSlackMinutes": 72,
      "activeJobs": 0,
      "maxActiveJobs": 3,
      "capacity": 10,
      "spareCapacityAfter": 7,
      "currentZone": "CENTRAL",
      "breakdown": { "travel": 100, "workload": 100, "deadline": 100, "capacity": 70 },
      "warnings": [],
      "rank": 1,
      "reasons": [
        "8 min to pickup (closest)",
        "No other jobs right now",
        "7 of 10 units free after this job",
        "Can deliver about 72 min before the deadline"
      ],
      "whyAboveNext": "Ranked above Farhan Ali mainly because they have more room left after this job (7 vs 1 units)"
    },
    {
      "riderId": "6713845b9b1e4c0012a3f207",
      "name": "Farhan Ali",
      "score": 89,
      "travelToPickupMinutes": 8,
      "etaMinutes": 28,
      "deadlineSlackMinutes": 72,
      "activeJobs": 0,
      "maxActiveJobs": 2,
      "capacity": 4,
      "spareCapacityAfter": 1,
      "currentZone": "CENTRAL",
      "breakdown": { "travel": 100, "workload": 100, "deadline": 100, "capacity": 25 },
      "warnings": [],
      "rank": 2,
      "reasons": [
        "8 min to pickup (closest)",
        "No other jobs right now",
        "1 of 4 units free after this job",
        "Can deliver about 72 min before the deadline"
      ],
      "whyAboveNext": "Ranked above Deepa Rajan mainly because they are closer to the pickup (8 vs 12 min)"
    },
    {
      "riderId": "6713845b9b1e4c0012a3f208",
      "name": "Deepa Rajan",
      "score": 88,
      "travelToPickupMinutes": 12,
      "etaMinutes": 32,
      "deadlineSlackMinutes": 68,
      "activeJobs": 0,
      "maxActiveJobs": 3,
      "capacity": 10,
      "spareCapacityAfter": 7,
      "currentZone": "WEST",
      "breakdown": { "travel": 82, "workload": 100, "deadline": 100, "capacity": 70 },
      "warnings": [],
      "rank": 3,
      "reasons": [
        "12 min to pickup",
        "No other jobs right now",
        "7 of 10 units free after this job",
        "Can deliver about 68 min before the deadline"
      ],
      "whyAboveNext": null
    }
  ],
  "notEligible": [
    {
      "riderId": "6713845b9b1e4c0012a3f205",
      "name": "Anitha Devi",
      "reasons": ["On break", "Does not cover Central (pickup)", "Does not cover North (drop)"]
    },
    {
      "riderId": "6713845b9b1e4c0012a3f202",
      "name": "Karthik Srinivasan",
      "reasons": ["Does not cover North (drop)", "Needs 3 units free; has 1"]
    },
    {
      "riderId": "6713845b9b1e4c0012a3f203",
      "name": "Meena Lakshmi",
      "reasons": ["Does not cover Central (pickup)"]
    },
    {
      "riderId": "6713845b9b1e4c0012a3f204",
      "name": "Suresh Babu",
      "reasons": ["Does not cover North (drop)"]
    },
    {
      "riderId": "6713845b9b1e4c0012a3f206",
      "name": "Vijay Anand",
      "reasons": ["Off duty", "Does not cover North (drop)"]
    }
  ]
}
```

`recommended` can be empty. The job then stays where it is; it is moved to the manual queue
automatically only at creation, or by a dispatcher with `POST /jobs/:jobRef/manual-queue`.

**Example error:** `409 Conflict` for `ORD-1002`, which is waiting for Karthik

```json
{
  "error": {
    "code": "JOB_NOT_ASSIGNABLE",
    "message": "ORD-1002 is already assigned to Karthik Srinivasan and waiting for their confirmation.",
    "details": { "status": "AWAITING_CONFIRMATION" }
  }
}
```

Other `JOB_NOT_ASSIGNABLE` messages: "ORD-1005 is already with Suresh Babu." (accepted or picked up),
"ORD-1007 has already been delivered.", "ORD-1008 was cancelled.", "... is not ready for assignment yet." (`NEW`).

**Errors:** `400 VALIDATION_ERROR`; `403 FORBIDDEN` (riders); `404 NOT_FOUND`; `409 JOB_NOT_ASSIGNABLE`.

### 7.2 POST /jobs/:jobRef/assignments

**Who:** dispatcher. **Purpose:** assign a rider to a job that is `READY_FOR_ASSIGNMENT`, or reassign a
job from the `MANUAL_QUEUE`.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Job id or order reference |
| `riderId` | body | string | yes | Rider id (24 hex characters) |
| `overrideReason` | body | string | when not the top rider | 5–300 characters. Required when `riderId` is not rank 1 in the recommendations at this moment. Ignored (stored as `null`) when it is. An empty string counts as missing. |

What happens, in one transaction:

1. The recommendations are computed again with current data. The rider must be eligible now.
2. The rider's capacity is reserved (`reservedLoad` += job load, `activeJobs` += 1), only if they are
   still available, cover both zones, and have free capacity and a free job slot at this exact moment.
3. A new `PENDING` assignment is created. It expires after the current `confirmationTimeoutMinutes`.
4. The job moves to `AWAITING_CONFIRMATION`. History gets `RIDER_ASSIGNED` (first attempt) or
   `RIDER_REASSIGNED` (later attempts), including what the recommendation showed.

**Example request:** `POST /api/jobs/ORD-1001/assignments`

```json
{ "riderId": "6713845b9b1e4c0012a3f201" }
```

**Example response:** `201 Created`

```json
{
  "job": {
    "id": "6713845c9b1e4c0012a3f301",
    "orderRef": "ORD-1001",
    "pickupZone": "CENTRAL",
    "dropZone": "NORTH",
    "load": 3,
    "priority": "NORMAL",
    "deadline": "2026-10-19T10:00:00.000Z",
    "notes": null,
    "status": "AWAITING_CONFIRMATION",
    "statusChangedAt": "2026-10-19T08:21:05.334Z",
    "nextStatuses": ["ACCEPTED", "MANUAL_QUEUE", "CANCELLED"],
    "minutesInStatus": 0,
    "isOverdue": false,
    "riderId": "6713845b9b1e4c0012a3f201",
    "riderName": "Ravi Kumar",
    "currentAssignmentId": "67138bd19b1e4c0012a3f401",
    "confirmationDueAt": "2026-10-19T10:21:05.310Z",
    "attemptCount": 1,
    "manualQueueReason": null,
    "cancelReason": null,
    "version": 2,
    "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "createdAt": "2026-10-19T08:00:01.204Z",
    "updatedAt": "2026-10-19T08:21:05.334Z"
  },
  "assignment": {
    "id": "67138bd19b1e4c0012a3f401",
    "jobId": "6713845c9b1e4c0012a3f301",
    "orderRef": "ORD-1001",
    "riderId": "6713845b9b1e4c0012a3f201",
    "riderName": "Ravi Kumar",
    "load": 3,
    "attempt": 1,
    "status": "PENDING",
    "active": true,
    "assignedAt": "2026-10-19T08:21:05.310Z",
    "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "expiresAt": "2026-10-19T10:21:05.310Z",
    "timeoutMinutes": 120,
    "respondedAt": null,
    "respondedBy": null,
    "endedAt": null,
    "endedBy": null,
    "endReason": null,
    "isOverride": false,
    "overrideReason": null,
    "recommendation": {
      "rank": 1,
      "score": 96,
      "reasons": [
        "8 min to pickup (closest)",
        "No other jobs right now",
        "7 of 10 units free after this job",
        "Can deliver about 71 min before the deadline"
      ],
      "warnings": [],
      "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 96 },
      "shortlist": [
        { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 96 },
        { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 89 },
        { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 88 }
      ]
    }
  }
}
```

**Override.** To choose Deepa (rank 3) instead, send a reason:

```json
{ "riderId": "6713845b9b1e4c0012a3f208", "overrideReason": "Ravi is needed for a bulk pickup at 9" }
```

The attempt then has `"isOverride": true`, the reason, and `recommendation.rank: 3`. Without the reason:

```json
{
  "error": {
    "code": "OVERRIDE_REASON_REQUIRED",
    "message": "Ravi Kumar is the recommended rider. Give a reason for choosing Deepa Rajan instead.",
    "details": { "recommendedRiderId": "6713845b9b1e4c0012a3f201", "recommendedRiderName": "Ravi Kumar" }
  }
}
```

**Errors:**

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad `riderId` ("Invalid id") or `overrideReason` shorter than 5 characters |
| `FORBIDDEN` | 403 | Riders |
| `NOT_FOUND` | 404 | "Job not found", or "Rider not found" (unknown rider, or a rider whose account is deactivated) |
| `JOB_NOT_ASSIGNABLE` | 409 | The job is not `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE` |
| `RIDER_NOT_ELIGIBLE` | 422 | The rider cannot take this job now; `details.reasons` lists why (e.g. `["Off duty", "Does not cover North (drop)"]`) |
| `OVERRIDE_REASON_REQUIRED` | 422 | Not the top rider and no `overrideReason` |
| `RIDER_CAPACITY_CHANGED` | 409 | The reservation failed because the rider's state changed a moment ago: "Deepa Rajan can no longer take this job: their availability or capacity just changed. Refresh the recommendations." |
| `JOB_ALREADY_ASSIGNED` | 409 | "Another dispatcher assigned this job a moment ago. Refresh to see who." |
| `JOB_CHANGED` | 409 | The job changed during the request |

### 7.3 GET /jobs/:jobRef/assignments

**Who:** dispatcher, or the rider linked to the job. **Purpose:** every assignment attempt on the job,
oldest first, including failed ones.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Job id or order reference |

**Example request:** `GET /api/jobs/ORD-2002/assignments`

Here `ORD-2002` (CENTRAL to NORTH, load 2, no deadline) was first assigned to Ravi, who declined. The
dispatcher then reassigned it to Farhan, the new top recommendation (Ravi is no longer eligible for it).

**Example response:** `200 OK`

```json
{
  "jobId": "671390c09b1e4c0012a3f3a2",
  "orderRef": "ORD-2002",
  "items": [
    {
      "id": "671390fe9b1e4c0012a3f403",
      "jobId": "671390c09b1e4c0012a3f3a2",
      "orderRef": "ORD-2002",
      "riderId": "6713845b9b1e4c0012a3f201",
      "riderName": "Ravi Kumar",
      "load": 2,
      "attempt": 1,
      "status": "REJECTED",
      "active": false,
      "assignedAt": "2026-10-19T08:41:10.204Z",
      "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "expiresAt": "2026-10-19T10:41:10.204Z",
      "timeoutMinutes": 120,
      "respondedAt": "2026-10-19T08:43:02.551Z",
      "respondedBy": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
      "endedAt": "2026-10-19T08:43:02.558Z",
      "endedBy": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
      "endReason": { "code": "RIDER_REJECTED", "message": "Ravi Kumar declined the job: Bike has a flat tyre" },
      "isOverride": false,
      "overrideReason": null,
      "recommendation": {
        "rank": 1,
        "score": 97,
        "reasons": ["8 min to pickup (closest)", "No other jobs right now", "8 of 10 units free after this job"],
        "warnings": [],
        "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 97 },
        "shortlist": [
          { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 97 },
          { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 93 },
          { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 90 }
        ]
      }
    },
    {
      "id": "671391b69b1e4c0012a3f404",
      "jobId": "671390c09b1e4c0012a3f3a2",
      "orderRef": "ORD-2002",
      "riderId": "6713845b9b1e4c0012a3f207",
      "riderName": "Farhan Ali",
      "load": 2,
      "attempt": 2,
      "status": "PENDING",
      "active": true,
      "assignedAt": "2026-10-19T08:44:30.090Z",
      "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
      "expiresAt": "2026-10-19T10:44:30.090Z",
      "timeoutMinutes": 120,
      "respondedAt": null,
      "respondedBy": null,
      "endedAt": null,
      "endedBy": null,
      "endReason": null,
      "isOverride": false,
      "overrideReason": null,
      "recommendation": {
        "rank": 1,
        "score": 93,
        "reasons": ["8 min to pickup (closest)", "No other jobs right now", "2 of 4 units free after this job"],
        "warnings": [],
        "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "score": 93 },
        "shortlist": [
          { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 1, "score": 93 },
          { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 2, "score": 90 }
        ]
      }
    }
  ]
}
```

**Errors:** `400 VALIDATION_ERROR`; `404 NOT_FOUND`; `403 FORBIDDEN` ("Riders can only view jobs assigned to them").

---

## 8. Assignments (rider answers)

### 8.1 GET /assignments/mine

**Who:** rider. **Purpose:** the rider's live work and recent history.

No parameters.

| Field | Meaning |
|---|---|
| `live[]` | Attempts that are `PENDING` (offers waiting for an answer) or `ACCEPTED` (jobs in progress), oldest first. Each item is `{ assignment, job }`. |
| `recent[]` | The 10 most recently ended attempts, newest first, in the same `{ assignment, job }` form |
| `serverTime` | App clock now; use it for the countdown to `assignment.expiresAt` |

**Example request:** `GET /api/assignments/mine` (Ravi, just after `ORD-1001` was assigned to him)

**Example response:** `200 OK`

```json
{
  "live": [
    {
      "assignment": {
        "id": "67138bd19b1e4c0012a3f401",
        "jobId": "6713845c9b1e4c0012a3f301",
        "orderRef": "ORD-1001",
        "riderId": "6713845b9b1e4c0012a3f201",
        "riderName": "Ravi Kumar",
        "load": 3,
        "attempt": 1,
        "status": "PENDING",
        "active": true,
        "assignedAt": "2026-10-19T08:21:05.310Z",
        "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
        "expiresAt": "2026-10-19T10:21:05.310Z",
        "timeoutMinutes": 120,
        "respondedAt": null,
        "respondedBy": null,
        "endedAt": null,
        "endedBy": null,
        "endReason": null,
        "isOverride": false,
        "overrideReason": null,
        "recommendation": {
          "rank": 1,
          "score": 96,
          "reasons": [
            "8 min to pickup (closest)",
            "No other jobs right now",
            "7 of 10 units free after this job",
            "Can deliver about 71 min before the deadline"
          ],
          "warnings": [],
          "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 96 },
          "shortlist": [
            { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 96 },
            { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 89 },
            { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 88 }
          ]
        }
      },
      "job": {
        "id": "6713845c9b1e4c0012a3f301",
        "orderRef": "ORD-1001",
        "pickupZone": "CENTRAL",
        "dropZone": "NORTH",
        "load": 3,
        "priority": "NORMAL",
        "deadline": "2026-10-19T10:00:00.000Z",
        "notes": null,
        "status": "AWAITING_CONFIRMATION",
        "statusChangedAt": "2026-10-19T08:21:05.334Z",
        "nextStatuses": ["ACCEPTED", "MANUAL_QUEUE", "CANCELLED"],
        "minutesInStatus": 0,
        "isOverdue": false,
        "riderId": "6713845b9b1e4c0012a3f201",
        "riderName": "Ravi Kumar",
        "currentAssignmentId": "67138bd19b1e4c0012a3f401",
        "confirmationDueAt": "2026-10-19T10:21:05.310Z",
        "attemptCount": 1,
        "manualQueueReason": null,
        "cancelReason": null,
        "version": 2,
        "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
        "createdAt": "2026-10-19T08:00:01.204Z",
        "updatedAt": "2026-10-19T08:21:05.334Z"
      }
    }
  ],
  "recent": [],
  "serverTime": "2026-10-19T08:22:00.530Z"
}
```

**Errors:** `403 FORBIDDEN` ("Only riders can perform this action") for dispatchers.

### 8.2 POST /assignments/:id/accept

**Who:** the assigned rider, or a dispatcher on their behalf (e.g. after a phone call). **Purpose:**
accept a `PENDING` offer. The job moves to `ACCEPTED`.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `id` | path | string | yes | Assignment id |

No body.

If the confirmation time has already run out (even if the timeout check has not run yet), the answer is
refused with `409 ASSIGNMENT_EXPIRED`, and in the same request the attempt is marked `EXPIRED`, the
rider's capacity is released and the job moves to the manual queue.

**Example request:** `POST /api/assignments/67138bd19b1e4c0012a3f401/accept` (Ravi's token)

**Example response:** `200 OK`

```json
{
  "assignment": {
    "id": "67138bd19b1e4c0012a3f401",
    "jobId": "6713845c9b1e4c0012a3f301",
    "orderRef": "ORD-1001",
    "riderId": "6713845b9b1e4c0012a3f201",
    "riderName": "Ravi Kumar",
    "load": 3,
    "attempt": 1,
    "status": "ACCEPTED",
    "active": true,
    "assignedAt": "2026-10-19T08:21:05.310Z",
    "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "expiresAt": "2026-10-19T10:21:05.310Z",
    "timeoutMinutes": 120,
    "respondedAt": "2026-10-19T08:24:40.118Z",
    "respondedBy": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
    "endedAt": null,
    "endedBy": null,
    "endReason": null,
    "isOverride": false,
    "overrideReason": null,
    "recommendation": {
      "rank": 1,
      "score": 96,
      "reasons": [
        "8 min to pickup (closest)",
        "No other jobs right now",
        "7 of 10 units free after this job",
        "Can deliver about 71 min before the deadline"
      ],
      "warnings": [],
      "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 96 },
      "shortlist": [
        { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 96 },
        { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 89 },
        { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 88 }
      ]
    }
  },
  "job": {
    "id": "6713845c9b1e4c0012a3f301",
    "orderRef": "ORD-1001",
    "pickupZone": "CENTRAL",
    "dropZone": "NORTH",
    "load": 3,
    "priority": "NORMAL",
    "deadline": "2026-10-19T10:00:00.000Z",
    "notes": null,
    "status": "ACCEPTED",
    "statusChangedAt": "2026-10-19T08:24:40.131Z",
    "nextStatuses": ["PICKED_UP", "MANUAL_QUEUE", "CANCELLED"],
    "minutesInStatus": 0,
    "isOverdue": false,
    "riderId": "6713845b9b1e4c0012a3f201",
    "riderName": "Ravi Kumar",
    "currentAssignmentId": "67138bd19b1e4c0012a3f401",
    "confirmationDueAt": null,
    "attemptCount": 1,
    "manualQueueReason": null,
    "cancelReason": null,
    "version": 3,
    "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "createdAt": "2026-10-19T08:00:01.204Z",
    "updatedAt": "2026-10-19T08:24:40.131Z"
  }
}
```

**Example error:** `409 Conflict`, accepting after the 120 minutes have passed

```json
{
  "error": {
    "code": "ASSIGNMENT_EXPIRED",
    "message": "Too late: the 120-minute window to confirm has passed. The job has moved to the manual queue."
  }
}
```

**Errors:**

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `id` is not 24 hex characters |
| `NOT_FOUND` | 404 | "Assignment not found" |
| `FORBIDDEN` | 403 | A rider answering another rider's offer: "You can only respond to jobs assigned to you" |
| `ASSIGNMENT_NOT_PENDING` | 409 | The attempt is not `PENDING`. `details.status` is its status. Messages: `ACCEPTED` "This assignment has already been accepted."; `REJECTED` "This assignment was already declined."; `EXPIRED` "This assignment has expired because the rider did not confirm in time."; `WITHDRAWN` "The dispatcher has withdrawn this assignment."; `RELEASED` "The rider has already dropped this job."; `CANCELLED` "The job was cancelled."; `COMPLETED` "This job has already been delivered." |
| `ASSIGNMENT_EXPIRED` | 409 | The time to confirm ran out (see above) |
| `ASSIGNMENT_CHANGED` | 409 | The attempt changed at the same moment (e.g. the timeout check expired it) |
| `JOB_CHANGED` | 409 | The job changed at the same moment |

### 8.3 POST /assignments/:id/reject

**Who:** the assigned rider, or a dispatcher on their behalf. **Purpose:** decline a `PENDING` offer.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `id` | path | string | yes | Assignment id |
| `reason` | body | string | yes | 3–300 characters |

Effects, in one transaction: the attempt becomes `REJECTED`, the rider's capacity is released, the job
moves to `MANUAL_QUEUE` with reason `RIDER_REJECTED`, and this rider is no longer eligible for this job.

**Example request:** `POST /api/assignments/671390fe9b1e4c0012a3f403/reject` (Ravi's token)

```json
{ "reason": "Bike has a flat tyre" }
```

**Example response:** `200 OK`

```json
{
  "assignment": {
    "id": "671390fe9b1e4c0012a3f403",
    "jobId": "671390c09b1e4c0012a3f3a2",
    "orderRef": "ORD-2002",
    "riderId": "6713845b9b1e4c0012a3f201",
    "riderName": "Ravi Kumar",
    "load": 2,
    "attempt": 1,
    "status": "REJECTED",
    "active": false,
    "assignedAt": "2026-10-19T08:41:10.204Z",
    "assignedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "expiresAt": "2026-10-19T10:41:10.204Z",
    "timeoutMinutes": 120,
    "respondedAt": "2026-10-19T08:43:02.551Z",
    "respondedBy": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
    "endedAt": "2026-10-19T08:43:02.558Z",
    "endedBy": { "type": "RIDER", "id": "6713845b9b1e4c0012a3f101", "name": "Ravi Kumar" },
    "endReason": { "code": "RIDER_REJECTED", "message": "Ravi Kumar declined the job: Bike has a flat tyre" },
    "isOverride": false,
    "overrideReason": null,
    "recommendation": {
      "rank": 1,
      "score": 97,
      "reasons": ["8 min to pickup (closest)", "No other jobs right now", "8 of 10 units free after this job"],
      "warnings": [],
      "recommendedRider": { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "score": 97 },
      "shortlist": [
        { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 97 },
        { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 93 },
        { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 90 }
      ]
    }
  },
  "job": {
    "id": "671390c09b1e4c0012a3f3a2",
    "orderRef": "ORD-2002",
    "pickupZone": "CENTRAL",
    "dropZone": "NORTH",
    "load": 2,
    "priority": "NORMAL",
    "deadline": null,
    "notes": null,
    "status": "MANUAL_QUEUE",
    "statusChangedAt": "2026-10-19T08:43:02.571Z",
    "nextStatuses": ["AWAITING_CONFIRMATION", "CANCELLED"],
    "minutesInStatus": 0,
    "isOverdue": false,
    "riderId": null,
    "riderName": null,
    "currentAssignmentId": null,
    "confirmationDueAt": null,
    "attemptCount": 1,
    "manualQueueReason": {
      "code": "RIDER_REJECTED",
      "message": "Ravi Kumar declined the job: Bike has a flat tyre",
      "at": "2026-10-19T08:43:02.571Z"
    },
    "cancelReason": null,
    "version": 3,
    "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
    "createdAt": "2026-10-19T08:40:00.512Z",
    "updatedAt": "2026-10-19T08:43:02.571Z"
  }
}
```

**Errors:** the same as accept (section 8.2), plus `400 VALIDATION_ERROR` for a missing or short
`reason` ("A reason is required", "Give a short reason").

---

## 9. Delivery updates

All five endpoints take `:jobRef` (job id or order reference) and return the updated job (section 3.1).

### 9.1 POST /jobs/:jobRef/pickup

**Who:** the rider holding the job, or a dispatcher on their behalf. **Purpose:** record that the rider
has collected the delivery. `ACCEPTED` → `PICKED_UP`.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | The job must be `ACCEPTED` |

No body. The rider's `currentZone` becomes the job's pickup zone.

**Example request:** `POST /api/jobs/ORD-1001/pickup` (Ravi's token)

**Example response:** `200 OK`

```json
{
  "id": "6713845c9b1e4c0012a3f301",
  "orderRef": "ORD-1001",
  "pickupZone": "CENTRAL",
  "dropZone": "NORTH",
  "load": 3,
  "priority": "NORMAL",
  "deadline": "2026-10-19T10:00:00.000Z",
  "notes": null,
  "status": "PICKED_UP",
  "statusChangedAt": "2026-10-19T08:33:12.019Z",
  "nextStatuses": ["DELIVERED"],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": "6713845b9b1e4c0012a3f201",
  "riderName": "Ravi Kumar",
  "currentAssignmentId": "67138bd19b1e4c0012a3f401",
  "confirmationDueAt": null,
  "attemptCount": 1,
  "manualQueueReason": null,
  "cancelReason": null,
  "version": 4,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.204Z",
  "updatedAt": "2026-10-19T08:33:12.019Z"
}
```

**Example error:** `409 Conflict`, pickup before the rider accepted

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Cannot move job from AWAITING_CONFIRMATION to PICKED_UP: from AWAITING_CONFIRMATION the job can only move to ACCEPTED, MANUAL_QUEUE, CANCELLED",
    "details": { "from": "AWAITING_CONFIRMATION", "to": "PICKED_UP", "allowed": ["ACCEPTED", "MANUAL_QUEUE", "CANCELLED"] }
  }
}
```

**Errors:** `400 VALIDATION_ERROR`; `404 NOT_FOUND`; `403 FORBIDDEN` ("Riders can only update jobs assigned to them");
`409 INVALID_TRANSITION`; `409 JOB_CHANGED`.

### 9.2 POST /jobs/:jobRef/deliver

**Who:** the rider holding the job, or a dispatcher on their behalf. **Purpose:** record that the delivery
is complete. `PICKED_UP` → `DELIVERED`.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | The job must be `PICKED_UP` |

No body. Effects: the attempt becomes `COMPLETED` (end reason `DELIVERED`), the rider's capacity and job
slot are released, and the rider's `currentZone` becomes the drop zone. `riderId` and `riderName` stay on
the job as a record of who delivered it; `currentAssignmentId` is cleared.

**Example request:** `POST /api/jobs/ORD-1001/deliver` (Ravi's token)

**Example response:** `200 OK`

```json
{
  "id": "6713845c9b1e4c0012a3f301",
  "orderRef": "ORD-1001",
  "pickupZone": "CENTRAL",
  "dropZone": "NORTH",
  "load": 3,
  "priority": "NORMAL",
  "deadline": "2026-10-19T10:00:00.000Z",
  "notes": null,
  "status": "DELIVERED",
  "statusChangedAt": "2026-10-19T08:52:47.652Z",
  "nextStatuses": [],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": "6713845b9b1e4c0012a3f201",
  "riderName": "Ravi Kumar",
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 1,
  "manualQueueReason": null,
  "cancelReason": null,
  "version": 5,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.204Z",
  "updatedAt": "2026-10-19T08:52:47.652Z"
}
```

Delivering before pickup returns `409 INVALID_TRANSITION` ("Cannot move job from ACCEPTED to DELIVERED:
from ACCEPTED the job can only move to PICKED_UP, MANUAL_QUEUE, CANCELLED").

**Errors:** `400 VALIDATION_ERROR`; `404 NOT_FOUND`; `403 FORBIDDEN` ("Riders can only update jobs assigned to them");
`409 INVALID_TRANSITION`; `409 JOB_CHANGED`; `409 NO_LIVE_ASSIGNMENT`; `409 ASSIGNMENT_CHANGED`.

### 9.3 POST /jobs/:jobRef/unassign

**Who:** a dispatcher (take the job back from its rider), or the rider holding the job (drop a job they
accepted). **Purpose:** remove the rider before pickup and send the job to the manual queue.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | The job must be `AWAITING_CONFIRMATION` or `ACCEPTED` (riders: `ACCEPTED` only) |
| `reason` | body | string | yes | 3–300 characters |

| Caller | Job status | Attempt becomes | Manual queue reason | History | Can the rider be recommended for this job again? |
|---|---|---|---|---|---|
| Dispatcher | `AWAITING_CONFIRMATION` or `ACCEPTED` | `WITHDRAWN` | `WITHDRAWN` | `ASSIGNMENT_WITHDRAWN`, `MOVED_TO_MANUAL_QUEUE` | Yes |
| Rider | `ACCEPTED` | `RELEASED` | `RIDER_RELEASED` | `ASSIGNMENT_RELEASED`, `MOVED_TO_MANUAL_QUEUE` | No |

In both cases the rider's capacity is released. If the job is `AWAITING_CONFIRMATION` and the rider's
time to confirm has already run out, the request records the timeout instead (attempt `EXPIRED`, job to
the manual queue with `CONFIRMATION_TIMEOUT`) and returns `409 ASSIGNMENT_EXPIRED`.

**Example request:** `POST /api/jobs/ORD-1002/unassign` (dispatcher; the job is waiting for Karthik)

```json
{ "reason": "Customer asked for a later slot" }
```

**Example response:** `200 OK`

```json
{
  "id": "6713845c9b1e4c0012a3f302",
  "orderRef": "ORD-1002",
  "pickupZone": "SOUTH",
  "dropZone": "CENTRAL",
  "load": 5,
  "priority": "HIGH",
  "deadline": "2026-10-19T09:30:00.000Z",
  "notes": null,
  "status": "MANUAL_QUEUE",
  "statusChangedAt": "2026-10-19T08:26:15.431Z",
  "nextStatuses": ["AWAITING_CONFIRMATION", "CANCELLED"],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": null,
  "riderName": null,
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 1,
  "manualQueueReason": {
    "code": "WITHDRAWN",
    "message": "Priya Raman took the job back from Karthik Srinivasan: Customer asked for a later slot",
    "at": "2026-10-19T08:26:15.431Z"
  },
  "cancelReason": null,
  "version": 3,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.287Z",
  "updatedAt": "2026-10-19T08:26:15.431Z"
}
```

When a rider drops an accepted job, the message reads "Ravi Kumar dropped the job: Vehicle broke down".

**Errors:**

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or short `reason` |
| `NOT_FOUND` | 404 | "Job not found" |
| `FORBIDDEN` | 403 | A rider who does not hold the job: "Riders can only release jobs assigned to them" |
| `ASSIGNMENT_EXPIRED` | 409 | "The rider's time to confirm had already run out, so the job has moved to the manual queue." |
| `USE_DECLINE` | 409 | A rider on an offer they have not accepted: "You have not accepted this job yet. Decline it instead." |
| `CANNOT_UNASSIGN` | 409 | `PICKED_UP`: "ORD-1005 has already been picked up, so the rider must deliver it." `DELIVERED`: "ORD-1007 has already been delivered." `CANCELLED`: "ORD-1008 was cancelled." Any other status: "ORD-1001 has no rider to take it back from." |
| `NO_LIVE_ASSIGNMENT` | 409 | Safety check (not expected) |
| `ASSIGNMENT_CHANGED` | 409 | The attempt changed at the same moment (e.g. the rider declined) |
| `JOB_CHANGED` | 409 | The job changed at the same moment |

### 9.4 POST /jobs/:jobRef/manual-queue

**Who:** dispatcher. **Purpose:** park a job that is ready for assignment in the manual queue, with a
reason (for example, nobody suitable right now). `READY_FOR_ASSIGNMENT` → `MANUAL_QUEUE`.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | The job must be `READY_FOR_ASSIGNMENT` |
| `reason` | body | string | yes | 3–300 characters |

The manual queue reason is `DISPATCHER_FLAGGED`, with the message "<dispatcher name>: <reason>". To take
a job back from a rider, use `unassign` instead.

**Example request:** `POST /api/jobs/ORD-1009/manual-queue`

```json
{ "reason": "Waiting for a bigger vehicle" }
```

**Example response:** `200 OK`

```json
{
  "id": "6713845c9b1e4c0012a3f309",
  "orderRef": "ORD-1009",
  "pickupZone": "EAST",
  "dropZone": "CENTRAL",
  "load": 10,
  "priority": "HIGH",
  "deadline": "2026-10-19T10:00:00.000Z",
  "notes": null,
  "status": "MANUAL_QUEUE",
  "statusChangedAt": "2026-10-19T08:27:00.263Z",
  "nextStatuses": ["AWAITING_CONFIRMATION", "CANCELLED"],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": null,
  "riderName": null,
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 0,
  "manualQueueReason": {
    "code": "DISPATCHER_FLAGGED",
    "message": "Priya Raman: Waiting for a bigger vehicle",
    "at": "2026-10-19T08:27:00.263Z"
  },
  "cancelReason": null,
  "version": 2,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.988Z",
  "updatedAt": "2026-10-19T08:27:00.263Z"
}
```

**Errors:** `400 VALIDATION_ERROR`; `403 FORBIDDEN` (riders); `404 NOT_FOUND`;
`409 CANNOT_MOVE_TO_MANUAL_QUEUE` ("ORD-1010 is already in the manual queue.", or "Only jobs that are ready for
assignment can be moved to the manual queue. To take a job back from a rider, withdraw the assignment.");
`409 JOB_CHANGED`.

### 9.5 POST /jobs/:jobRef/cancel

**Who:** dispatcher. **Purpose:** cancel a job before pickup. `CANCELLED` is final.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `jobRef` | path | string | yes | Allowed from `NEW`, `READY_FOR_ASSIGNMENT`, `AWAITING_CONFIRMATION`, `ACCEPTED`, `MANUAL_QUEUE` |
| `reason` | body | string | yes | 3–300 characters |

Effects, in one transaction:

- If a rider holds the job, their attempt becomes `CANCELLED` (end reason `JOB_CANCELLED`) and their capacity is released.
- If the rider's time to confirm had already run out, the timeout is recorded first (`ASSIGNMENT_EXPIRED`
  and `MOVED_TO_MANUAL_QUEUE` events), and then the job is cancelled. No error is returned in this case.
- The job gets `cancelReason`; `riderId`, `riderName`, `currentAssignmentId`, `confirmationDueAt` and
  `manualQueueReason` are cleared.

**Example request:** `POST /api/jobs/ORD-1003/cancel` (the job was accepted by Karthik)

```json
{ "reason": "Customer cancelled the order" }
```

**Example response:** `200 OK`

```json
{
  "id": "6713845c9b1e4c0012a3f303",
  "orderRef": "ORD-1003",
  "pickupZone": "EAST",
  "dropZone": "EAST",
  "load": 2,
  "priority": "LOW",
  "deadline": null,
  "notes": null,
  "status": "CANCELLED",
  "statusChangedAt": "2026-10-19T08:35:20.131Z",
  "nextStatuses": [],
  "minutesInStatus": 0,
  "isOverdue": false,
  "riderId": null,
  "riderName": null,
  "currentAssignmentId": null,
  "confirmationDueAt": null,
  "attemptCount": 1,
  "manualQueueReason": null,
  "cancelReason": "Customer cancelled the order",
  "version": 4,
  "createdBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "createdAt": "2026-10-19T08:00:01.402Z",
  "updatedAt": "2026-10-19T08:35:20.131Z"
}
```

The history entry reads "Priya Raman cancelled the job: Customer cancelled the order. Karthik
Srinivasan's assignment was ended and their capacity released."

**Example error:** `409 Conflict`, cancelling after pickup

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Cannot move job from PICKED_UP to CANCELLED: from PICKED_UP the job can only move to DELIVERED",
    "details": { "from": "PICKED_UP", "to": "CANCELLED", "allowed": ["DELIVERED"] }
  }
}
```

Cancelling a job that is already cancelled: "Cannot move job from CANCELLED to CANCELLED: the job is
already CANCELLED and cannot change any more" (`allowed: []`).

**Errors:** `400 VALIDATION_ERROR` ("A cancellation reason is required", "Give a short reason"); `403 FORBIDDEN` (riders);
`404 NOT_FOUND`; `409 INVALID_TRANSITION`; `409 JOB_CHANGED`; `409 ASSIGNMENT_CHANGED`.

---

## 10. Dashboard

### 10.1 GET /dashboard/summary

**Who:** dispatcher. **Purpose:** counts for the dispatcher's overview.

No parameters.

| Field | Meaning |
|---|---|
| `generatedAt` | App clock time |
| `jobs.total` | All jobs |
| `jobs.open` | Jobs not `DELIVERED` or `CANCELLED` |
| `jobs.overdue` | Open jobs whose deadline has passed |
| `jobs.confirmationsDueSoon` | Jobs `AWAITING_CONFIRMATION` whose confirmation is due within 15 minutes (this includes ones already past due that the timeout check has not processed yet) |
| `jobs.byStatus` | Count per status; every status is always present, 0 when empty |
| `riders.total` | All rider profiles (including deactivated accounts) |
| `riders.byAvailability` | Count per availability; every value always present |

**Example request:** `GET /api/dashboard/summary`

**Example response:** `200 OK` (fresh seed, 08:20 UTC)

```json
{
  "generatedAt": "2026-10-19T08:20:00.412Z",
  "jobs": {
    "total": 10,
    "open": 8,
    "overdue": 0,
    "confirmationsDueSoon": 0,
    "byStatus": {
      "NEW": 0,
      "READY_FOR_ASSIGNMENT": 4,
      "AWAITING_CONFIRMATION": 1,
      "ACCEPTED": 1,
      "PICKED_UP": 1,
      "DELIVERED": 1,
      "MANUAL_QUEUE": 1,
      "CANCELLED": 1
    }
  },
  "riders": {
    "total": 8,
    "byAvailability": { "AVAILABLE": 6, "ON_BREAK": 1, "OFF_DUTY": 1 }
  }
}
```

**Errors:** `403 FORBIDDEN` (riders).

---

## 11. Settings

Settings are stored in the database and shared by all dispatchers. Today there is one setting: the
confirmation timeout.

### 11.1 GET /settings

**Who:** dispatcher. **Purpose:** read the current dispatch settings.

No parameters.

| Field | Meaning |
|---|---|
| `confirmationTimeoutMinutes` | Minutes a rider has to accept new assignments |
| `defaultConfirmationTimeoutMinutes` | The default from `CONFIRMATION_TIMEOUT_MINUTES` (120), used until a dispatcher changes it |
| `sweepIntervalSeconds` | How often the server checks for expired confirmations (`SWEEP_INTERVAL_SECONDS`, default 15) |
| `simulationEnabled` | Whether the demo controls (section 12) are on |
| `updatedBy`, `updatedAt` | Who changed the setting last, and when (real time); `null` if never changed |

**Example request:** `GET /api/settings`

**Example response:** `200 OK`

```json
{
  "confirmationTimeoutMinutes": 120,
  "defaultConfirmationTimeoutMinutes": 120,
  "sweepIntervalSeconds": 15,
  "simulationEnabled": true,
  "updatedBy": null,
  "updatedAt": null
}
```

**Errors:** `403 FORBIDDEN` (riders).

### 11.2 PATCH /settings

**Who:** dispatcher. **Purpose:** change the confirmation timeout.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `confirmationTimeoutMinutes` | body | integer | yes | 1–1440 (24 hours) |

The new value applies to assignments made from now on. Riders who were already asked keep the deadline
they were given.

**Example request:** `PATCH /api/settings`

```json
{ "confirmationTimeoutMinutes": 30 }
```

**Example response:** `200 OK`

```json
{
  "confirmationTimeoutMinutes": 30,
  "defaultConfirmationTimeoutMinutes": 120,
  "sweepIntervalSeconds": 15,
  "simulationEnabled": true,
  "updatedBy": { "type": "DISPATCHER", "id": "6713845a9b1e4c0012a3f001", "name": "Priya Raman" },
  "updatedAt": "2026-10-19T08:16:42.077Z"
}
```

**Errors:** `400 VALIDATION_ERROR` ("At least 1 minute", "At most 24 hours (1440 minutes)", or a string instead
of a number); `403 FORBIDDEN` (riders).

---

## 12. Demo controls (simulation)

These endpoints let a reviewer see the confirmation timeout without waiting two hours: move the app
clock forward and run the timeout check at once.

- They are on by default outside production, and off in production. `ENABLE_SIMULATION=true|false`
  overrides the default. `GET /settings` reports the current state as `simulationEnabled`.
- When off, every `/simulation` path returns `404 SIMULATION_DISABLED` ("Demo controls are turned off on
  this server"), even without a token.
- The clock is server-wide and kept in memory. A restart resets it to real time.
- The timeout check expires every `PENDING` attempt whose `expiresAt` is at or before the app clock's now
  (up to 100 per run): the attempt becomes `EXPIRED`, the rider's capacity is released, and the job moves
  to the manual queue with reason `CONFIRMATION_TIMEOUT`. The server also runs this check on its own
  every `SWEEP_INTERVAL_SECONDS`.

Clock responses share these fields:

| Field | Meaning |
|---|---|
| `now` | The app clock's current time |
| `offsetMinutes` | How far ahead of real time the clock is, in whole minutes |
| `checked` | (advance, sweep) Pending attempts found past their time |
| `expired` | (advance, sweep) Attempts expired by this run. Can be lower than `checked` if another action got there first. |

### 12.1 GET /simulation/clock

**Who:** dispatcher. **Purpose:** read the app clock.

**Example response:** `200 OK`

```json
{ "now": "2026-10-19T08:05:00.120Z", "offsetMinutes": 0 }
```

**Errors:** `404 SIMULATION_DISABLED`; `403 FORBIDDEN` (riders).

### 12.2 POST /simulation/clock/advance

**Who:** dispatcher. **Purpose:** move the app clock forward, then run the timeout check straight away.

| Name | In | Type | Required | Rules / default |
|---|---|---|---|---|
| `minutes` | body | integer | yes | 1–10080 (7 days). The clock only moves forward. |

**Example request:** `POST /api/simulation/clock/advance`

```json
{ "minutes": 120 }
```

**Example response:** `200 OK` (on fresh seed data, the offer to Karthik for `ORD-1002` expires)

```json
{ "now": "2026-10-19T10:05:00.348Z", "offsetMinutes": 120, "checked": 1, "expired": 1 }
```

**Errors:** `400 VALIDATION_ERROR`; `404 SIMULATION_DISABLED`; `403 FORBIDDEN` (riders).

### 12.3 POST /simulation/clock/reset

**Who:** dispatcher. **Purpose:** return the app clock to real time. Deadlines and expiry times already
given keep their values, so history recorded after a reset can show earlier times than entries made
while the clock was ahead.

No body.

**Example response:** `200 OK`

```json
{ "now": "2026-10-19T08:06:12.904Z", "offsetMinutes": 0 }
```

**Errors:** `404 SIMULATION_DISABLED`; `403 FORBIDDEN` (riders).

### 12.4 POST /simulation/sweep

**Who:** dispatcher. **Purpose:** run the timeout check now instead of waiting for the next automatic run.

No body.

**Example response:** `200 OK`

```json
{ "now": "2026-10-19T08:06:30.017Z", "offsetMinutes": 0, "checked": 0, "expired": 0 }
```

**Errors:** `404 SIMULATION_DISABLED`; `403 FORBIDDEN` (riders).

---

## 13. Meta and health

### 13.1 GET /meta

**Who:** any logged-in user. **Purpose:** reference data for forms, filters and the status display, and the server's time.

No parameters.

| Field | Meaning |
|---|---|
| `zones` | `[{ code, label }]` |
| `travelMinutes` | Simulated travel time between zones, in minutes: `travelMinutes[from][to]` |
| `riderAvailability`, `jobStatuses`, `jobPriorities` | Allowed values |
| `jobTransitions` | Allowed status moves: `{ from: [to, ...] }` |
| `serverTime` | App clock now |

**Example response:** `200 OK`

```json
{
  "zones": [
    { "code": "CENTRAL", "label": "Central" },
    { "code": "NORTH", "label": "North" },
    { "code": "SOUTH", "label": "South" },
    { "code": "EAST", "label": "East" },
    { "code": "WEST", "label": "West" }
  ],
  "travelMinutes": {
    "CENTRAL": { "CENTRAL": 8, "NORTH": 15, "SOUTH": 15, "EAST": 12, "WEST": 12 },
    "NORTH": { "CENTRAL": 15, "NORTH": 8, "SOUTH": 30, "EAST": 20, "WEST": 20 },
    "SOUTH": { "CENTRAL": 15, "NORTH": 30, "SOUTH": 8, "EAST": 20, "WEST": 22 },
    "EAST": { "CENTRAL": 12, "NORTH": 20, "SOUTH": 20, "EAST": 8, "WEST": 25 },
    "WEST": { "CENTRAL": 12, "NORTH": 20, "SOUTH": 22, "EAST": 25, "WEST": 8 }
  },
  "riderAvailability": ["AVAILABLE", "ON_BREAK", "OFF_DUTY"],
  "jobStatuses": [
    "NEW",
    "READY_FOR_ASSIGNMENT",
    "AWAITING_CONFIRMATION",
    "ACCEPTED",
    "PICKED_UP",
    "DELIVERED",
    "MANUAL_QUEUE",
    "CANCELLED"
  ],
  "jobPriorities": ["LOW", "NORMAL", "HIGH", "URGENT"],
  "jobTransitions": {
    "NEW": ["READY_FOR_ASSIGNMENT", "CANCELLED"],
    "READY_FOR_ASSIGNMENT": ["AWAITING_CONFIRMATION", "MANUAL_QUEUE", "CANCELLED"],
    "AWAITING_CONFIRMATION": ["ACCEPTED", "MANUAL_QUEUE", "CANCELLED"],
    "ACCEPTED": ["PICKED_UP", "MANUAL_QUEUE", "CANCELLED"],
    "PICKED_UP": ["DELIVERED"],
    "MANUAL_QUEUE": ["AWAITING_CONFIRMATION", "CANCELLED"],
    "DELIVERED": [],
    "CANCELLED": []
  },
  "serverTime": "2026-10-19T08:20:00.412Z"
}
```

**Errors:** only the common authentication errors.

### 13.2 GET /health

**Who:** public. **Purpose:** check that the API is up and whether it is connected to the database.

No parameters. It always returns `200`; check `database` to see the connection state.

**Example response:** `200 OK`

```json
{ "status": "ok", "database": "connected" }
```

`database` is `"connected"` or `"disconnected"`.

---

## 14. Job lifecycle reference

### 14.1 Statuses

| Status | Meaning | Rider holds it? |
|---|---|---|
| `NEW` | Just created. Intake moves it on in the same request, so clients normally never see it. | No |
| `READY_FOR_ASSIGNMENT` | Waiting for a dispatcher to assign a rider | No |
| `AWAITING_CONFIRMATION` | Offered to a rider, who has until `confirmationDueAt` to accept | Yes (capacity reserved) |
| `ACCEPTED` | The rider confirmed and is on the way to the pickup | Yes |
| `PICKED_UP` | The rider has the goods | Yes |
| `DELIVERED` | Done. Final. | No (`riderId` kept as a record) |
| `MANUAL_QUEUE` | Needs a dispatcher's attention; see `manualQueueReason` | No |
| `CANCELLED` | Cancelled before pickup. Final. | No |

### 14.2 Allowed transitions

Any other move returns `409 INVALID_TRANSITION` with `details.allowed`.

| From | To | Caused by |
|---|---|---|
| `NEW` | `READY_FOR_ASSIGNMENT` | `POST /jobs` (intake, automatic) |
| `NEW` | `CANCELLED` | `POST /jobs/:jobRef/cancel` (allowed by the rules; jobs do not stay in `NEW` today) |
| `READY_FOR_ASSIGNMENT` | `AWAITING_CONFIRMATION` | `POST /jobs/:jobRef/assignments` |
| `READY_FOR_ASSIGNMENT` | `MANUAL_QUEUE` | `POST /jobs` when no rider can take the job (`NO_ELIGIBLE_RIDER`), or `POST /jobs/:jobRef/manual-queue` (`DISPATCHER_FLAGGED`) |
| `READY_FOR_ASSIGNMENT` | `CANCELLED` | `POST /jobs/:jobRef/cancel` |
| `AWAITING_CONFIRMATION` | `ACCEPTED` | `POST /assignments/:id/accept` |
| `AWAITING_CONFIRMATION` | `MANUAL_QUEUE` | `POST /assignments/:id/reject` (`RIDER_REJECTED`); dispatcher `POST /jobs/:jobRef/unassign` (`WITHDRAWN`); confirmation timeout (`CONFIRMATION_TIMEOUT`): the automatic check, `POST /simulation/clock/advance`, `POST /simulation/sweep`, or a late accept, reject, unassign or cancel |
| `AWAITING_CONFIRMATION` | `CANCELLED` | `POST /jobs/:jobRef/cancel` |
| `ACCEPTED` | `PICKED_UP` | `POST /jobs/:jobRef/pickup` |
| `ACCEPTED` | `MANUAL_QUEUE` | `POST /jobs/:jobRef/unassign`: dispatcher (`WITHDRAWN`) or rider (`RIDER_RELEASED`) |
| `ACCEPTED` | `CANCELLED` | `POST /jobs/:jobRef/cancel` |
| `PICKED_UP` | `DELIVERED` | `POST /jobs/:jobRef/deliver` |
| `MANUAL_QUEUE` | `AWAITING_CONFIRMATION` | `POST /jobs/:jobRef/assignments` (reassignment) |
| `MANUAL_QUEUE` | `CANCELLED` | `POST /jobs/:jobRef/cancel` |
| `DELIVERED`, `CANCELLED` | – | Final; nothing can change them |

### 14.3 Manual queue reasons (`manualQueueReason.code`)

| Code | Set by |
|---|---|
| `NO_ELIGIBLE_RIDER` | Job creation, when no rider at all could take the job. The message summarises why, e.g. "No rider can take this job right now. 8 checked: 3 do not cover the drop zone, 2 lack free capacity, ..." |
| `RIDER_REJECTED` | The rider declined |
| `CONFIRMATION_TIMEOUT` | The rider did not accept in time, e.g. "Ravi Kumar did not confirm within 120 minutes" |
| `RIDER_RELEASED` | The rider dropped a job they had accepted |
| `WITHDRAWN` | A dispatcher took the job back |
| `DISPATCHER_FLAGGED` | A dispatcher parked a ready job |

### 14.4 Assignment attempt statuses

A job can have several attempts, but only one live attempt (`PENDING` or `ACCEPTED`) at a time.
Every attempt stays on record.

| Status | Meaning | Live? | Capacity | `endReason.code` | Caused by |
|---|---|---|---|---|---|
| `PENDING` | Waiting for the rider to answer | Yes | Reserved | – | `POST /jobs/:jobRef/assignments` |
| `ACCEPTED` | The rider confirmed; the job is in progress (stays `ACCEPTED` through pickup) | Yes | Reserved | – | `POST /assignments/:id/accept` |
| `COMPLETED` | Delivered | No | Released | `DELIVERED` | `POST /jobs/:jobRef/deliver` |
| `REJECTED` | The rider declined | No | Released | `RIDER_REJECTED` | `POST /assignments/:id/reject` |
| `EXPIRED` | No answer within the timeout (ended by `SYSTEM`) | No | Released | `CONFIRMATION_TIMEOUT` | The timeout check, or a late action on the attempt |
| `WITHDRAWN` | A dispatcher took the job back | No | Released | `WITHDRAWN` | Dispatcher `POST /jobs/:jobRef/unassign` |
| `RELEASED` | The rider dropped an accepted job | No | Released | `RIDER_RELEASED` | Rider `POST /jobs/:jobRef/unassign` |
| `CANCELLED` | The job was cancelled | No | Released | `JOB_CANCELLED` | `POST /jobs/:jobRef/cancel` |

Effect on later recommendations for the same job: `REJECTED` and `RELEASED` make the rider not eligible;
`EXPIRED` keeps them eligible with a 20-point penalty; `WITHDRAWN` and `CANCELLED` have no effect.

---

## 15. End-to-end example

A full delivery on freshly seeded data: a dispatcher creates a job and assigns the recommended rider; the
rider accepts, picks up and delivers; then the history is read. The requests are written as plain HTTP so
they work in any client. With curl, each one is:

```
curl -X <METHOD> http://localhost:4000/api/<path> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '<body>'
```

Leave out `-d` for requests without a body, and the `Authorization` header for the two login calls.
Responses below are trimmed to the fields that matter for the next step.

**1. Dispatcher asks for a code**

```http
POST http://localhost:4000/api/auth/otp/request
Content-Type: application/json

{ "mobile": "9000000001" }
```

`200` → `{ "message": "If this mobile number is registered, an OTP has been sent.", "expiresInSeconds": 300, "demoHint": "Demo mode: the OTP is 1234" }`

**2. Dispatcher logs in.** Keep `token` as `DISPATCHER_TOKEN`.

```http
POST http://localhost:4000/api/auth/otp/verify
Content-Type: application/json

{ "mobile": "9000000001", "otp": "1234" }
```

```json
{ "token": "<DISPATCHER_TOKEN>", "tokenType": "Bearer", "expiresIn": "12h", "user": { "name": "Priya Raman", "role": "DISPATCHER" } }
```

**3. Create a job**

```http
POST http://localhost:4000/api/jobs
Authorization: Bearer <DISPATCHER_TOKEN>
Content-Type: application/json

{ "orderRef": "ORD-2001", "pickupZone": "CENTRAL", "dropZone": "NORTH", "load": 3,
  "priority": "HIGH", "deadline": "2026-10-19T18:30:00+05:30", "notes": "Ring the bell" }
```

`201`:

```json
{ "id": "67138e249b1e4c0012a3f3a1", "orderRef": "ORD-2001", "status": "READY_FOR_ASSIGNMENT", "version": 1 }
```

Sending the same request again returns `200` with the same job and `Idempotent-Replayed: true`.

**4. Get recommendations.** Keep `recommended[0].riderId`.

```http
GET http://localhost:4000/api/jobs/ORD-2001/recommendations
Authorization: Bearer <DISPATCHER_TOKEN>
```

```json
{
  "orderRef": "ORD-2001",
  "confirmationTimeoutMinutes": 120,
  "recommended": [
    { "riderId": "6713845b9b1e4c0012a3f201", "name": "Ravi Kumar", "rank": 1, "score": 97,
      "whyAboveNext": "Ranked above Farhan Ali mainly because they have more room left after this job (7 vs 1 units)" },
    { "riderId": "6713845b9b1e4c0012a3f207", "name": "Farhan Ali", "rank": 2, "score": 93 },
    { "riderId": "6713845b9b1e4c0012a3f208", "name": "Deepa Rajan", "rank": 3, "score": 87 }
  ]
}
```

**5. Assign the top rider.** No `overrideReason` is needed for rank 1.

```http
POST http://localhost:4000/api/jobs/ORD-2001/assignments
Authorization: Bearer <DISPATCHER_TOKEN>
Content-Type: application/json

{ "riderId": "6713845b9b1e4c0012a3f201" }
```

`201`:

```json
{
  "job": { "orderRef": "ORD-2001", "status": "AWAITING_CONFIRMATION", "riderName": "Ravi Kumar", "confirmationDueAt": "2026-10-19T10:32:05.118Z" },
  "assignment": { "id": "67138e8c9b1e4c0012a3f405", "status": "PENDING", "expiresAt": "2026-10-19T10:32:05.118Z" }
}
```

**6. Rider logs in.** Same two calls with Ravi's number, `9100000001`. Keep `token` as `RIDER_TOKEN`.

```http
POST http://localhost:4000/api/auth/otp/request
Content-Type: application/json

{ "mobile": "9100000001" }
```

```http
POST http://localhost:4000/api/auth/otp/verify
Content-Type: application/json

{ "mobile": "9100000001", "otp": "1234" }
```

```json
{ "token": "<RIDER_TOKEN>", "user": { "name": "Ravi Kumar", "role": "RIDER", "riderId": "6713845b9b1e4c0012a3f201" } }
```

**7. Rider lists their work.** Keep `live[0].assignment.id`.

```http
GET http://localhost:4000/api/assignments/mine
Authorization: Bearer <RIDER_TOKEN>
```

```json
{
  "live": [
    {
      "assignment": { "id": "67138e8c9b1e4c0012a3f405", "orderRef": "ORD-2001", "status": "PENDING", "expiresAt": "2026-10-19T10:32:05.118Z" },
      "job": { "orderRef": "ORD-2001", "status": "AWAITING_CONFIRMATION", "pickupZone": "CENTRAL", "dropZone": "NORTH", "notes": "Ring the bell" }
    }
  ],
  "recent": [],
  "serverTime": "2026-10-19T08:33:10.402Z"
}
```

**8. Rider accepts**

```http
POST http://localhost:4000/api/assignments/67138e8c9b1e4c0012a3f405/accept
Authorization: Bearer <RIDER_TOKEN>
```

```json
{ "assignment": { "status": "ACCEPTED" }, "job": { "status": "ACCEPTED", "nextStatuses": ["PICKED_UP", "MANUAL_QUEUE", "CANCELLED"] } }
```

**9. Rider picks up**

```http
POST http://localhost:4000/api/jobs/ORD-2001/pickup
Authorization: Bearer <RIDER_TOKEN>
```

```json
{ "orderRef": "ORD-2001", "status": "PICKED_UP", "nextStatuses": ["DELIVERED"] }
```

**10. Rider delivers.** Ravi's capacity is released and his location becomes `NORTH`.

```http
POST http://localhost:4000/api/jobs/ORD-2001/deliver
Authorization: Bearer <RIDER_TOKEN>
```

```json
{ "orderRef": "ORD-2001", "status": "DELIVERED", "nextStatuses": [], "riderName": "Ravi Kumar", "currentAssignmentId": null }
```

**11. Read the history** (dispatcher, or Ravi, who delivered it)

```http
GET http://localhost:4000/api/jobs/ORD-2001/events
Authorization: Bearer <DISPATCHER_TOKEN>
```

```json
{
  "orderRef": "ORD-2001",
  "status": "DELIVERED",
  "events": [
    { "type": "JOB_CREATED", "actor": { "type": "DISPATCHER", "name": "Priya Raman" }, "message": "Priya Raman created job ORD-2001", "toStatus": "NEW" },
    { "type": "JOB_READY", "actor": { "type": "SYSTEM", "name": "System" }, "message": "Intake checks passed; job is ready for assignment", "toStatus": "READY_FOR_ASSIGNMENT" },
    { "type": "RIDER_ASSIGNED", "actor": { "type": "DISPATCHER", "name": "Priya Raman" }, "message": "Priya Raman assigned Ravi Kumar (recommended, 8 min from pickup). Ravi Kumar has 120 min to confirm.", "toStatus": "AWAITING_CONFIRMATION" },
    { "type": "ASSIGNMENT_ACCEPTED", "actor": { "type": "RIDER", "name": "Ravi Kumar" }, "message": "Ravi Kumar accepted the job", "toStatus": "ACCEPTED" },
    { "type": "JOB_PICKED_UP", "actor": { "type": "RIDER", "name": "Ravi Kumar" }, "message": "Ravi Kumar picked up the delivery in Central", "toStatus": "PICKED_UP" },
    { "type": "JOB_DELIVERED", "actor": { "type": "RIDER", "name": "Ravi Kumar" }, "message": "Ravi Kumar delivered the job in North", "toStatus": "DELIVERED" }
  ]
}
```

To see the timeout path instead, stop after step 5 and call `POST /simulation/clock/advance` with
`{ "minutes": 121 }`. The job moves to `MANUAL_QUEUE` with reason `CONFIRMATION_TIMEOUT`, its history
gets `ASSIGNMENT_EXPIRED` and `MOVED_TO_MANUAL_QUEUE` by `System`, and a later accept by the rider returns
`409 ASSIGNMENT_NOT_PENDING` ("This assignment has expired because the rider did not confirm in time.").
Call `POST /simulation/clock/reset` when done.

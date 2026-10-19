# RELAY: Engineering notes

## Assumptions

- **One operation, one city.** Five simulated service zones (Central, North, South, East, West) with a
  fixed, symmetric travel-time table of 8 to 30 minutes. No GPS: a rider's location is a zone. It is set
  when the rider is added, changes on pickup (to the pickup zone) and delivery (to the drop zone), and a
  dispatcher can correct it by editing the rider.
- **Load units are abstract.** A job's load and a rider's capacity use the same unit (think parcels or
  crates). A rider also has a maximum number of jobs held at once.
- **The order reference identifies the order.** It comes from the order system. The same reference with
  the same details is a resubmission and returns the existing job. The same reference with different
  details is refused as a conflict rather than silently overwriting.
- **Riders answer in the app, or by phone.** A dispatcher can record "accepted" or "declined" on the
  rider's behalf. The history says who recorded it.
- **Rejection behaviour.** A decline sends the job to the Manual Queue (no automatic retry), releases
  the rider's capacity and excludes that rider from that job. A rider who gives back a job they had
  accepted is treated the same way. A rider who simply didn't answer stays eligible but ranks 20 points lower.
- **The timeout belongs to the attempt.** It is fixed when the rider is assigned. Changing the setting
  affects new assignments only.
- **Up to 15 seconds late is acceptable.** The timeout check runs every 15 seconds. A rider who answers
  after the deadline is refused, even if the check hasn't run yet.
- **Cancellation stops at pickup.** Once the goods are with the rider, the job must be delivered;
  returns are out of scope.
- **Sign-in is by mobile number and one-time code.** The demo code is always 1234 and no SMS is sent.
  Dispatchers are created by the seed script; dispatchers add riders in the app.
- **Times are stored in UTC** and shown in the browser's local time.
- **A deadline is optional.** Urgency comes from the priority (Low to Urgent) and, when given, the deadline.

## Known limitations

- **Demo clock.** Moving the clock forward is server-wide and kept in memory. A server restart returns to
  real time. Going **back** to real time after moving forward makes later history entries carry earlier
  times than the timeout entry, so the demo controls should be reset only at the end. The controls are
  off in production (`ENABLE_SIMULATION`).
- **Screens refresh every 10 seconds** rather than receiving pushed updates. Changes made by someone
  else can take up to 10 seconds to appear. Conflicting clicks are still resolved safely by the server,
  with a clear message.
- **Retried actions.** Job creation is idempotent. Other actions are protected by the state machine, so a
  repeated "accept" or "pick up" cannot apply twice, but the repeat returns a 409 instead of the original
  success response. There is no `Idempotency-Key` support.
- **No second chance after a decline.** A rider who declined or gave back a job cannot be offered that same
  job again, even if they change their mind.
- **No urgent override.** A dispatcher cannot assign a rider who is on break or off duty without first
  changing that rider's availability.
- **Rider changes are not audited.** Edits to availability, zones or capacity are saved, but they are not
  part of a history the way job events are.
- **Recommendation weights are hand-picked.** They are a reasoned starting point, not tuned on real data.
  Travel time is zone to zone, not street level.
- **Account management is minimal.** There is no screen to add or deactivate dispatchers, and no way to
  remove a rider (setting them Off duty keeps them out of recommendations).
- **The timeout check runs in every API instance.** That is safe, because each expiry is conditional, but
  with several instances it is duplicated work.
- **Lists use page numbers** (offset pagination), which slows down on very large collections.
- **Login hardening is demo-level.** The one-time code is static (`STATIC_OTP`) in every environment,
  production included, so a real deployment must plug in an SMS provider first. Attempts per code are
  limited (5), but requests per number or IP are not rate-limited.
- **Riders see a job's full record.** A rider who holds or delivered a job can read its attempts and history,
  including earlier riders' names and override reasons. A rider view with less detail would be better.
- **No deployment and no CI pipeline.** The app runs locally against MongoDB Atlas. Tests run with
  `npm test`; there are no browser end-to-end tests.

## Incomplete parts

Every capability in the brief is implemented and reachable from the web app and the API:

- the dashboard
- job management with duplicate prevention
- rider management
- recommendations with reasons and logged overrides
- confirmation with automatic timeout to the Manual Queue
- the delivery lifecycle with invalid moves blocked
- the full job history.

Not built, by choice, and listed in the improvements below: a deployed version (optional in the brief),
automatic assignment, pushed live updates and real SMS login.

## Three improvements for next week

1. **Autonomous dispatch with escalation.**
   - Offer each new job automatically to the top-ranked rider, and move on to the next rider when one declines or doesn't answer.
   - Dispatchers then handle only the exceptions in the Manual Queue.
   - Urgent jobs that stay in the queue longer than a set time raise an alert.
   - The ranking, eligibility and assignment rules already sit in one place, so this is a new caller of the same services, not a rewrite.
2. **Live updates and rider notifications.**
   - Replace polling with MongoDB change streams pushed to the browser over WebSockets or Server-Sent Events.
   - Notify riders of new offers by push notification or SMS. Today a rider sees an offer only when they open the app, which makes the confirmation timeout harder to meet.
3. **Safer manual control.**
   - An "urgent override" that lets a dispatcher re-offer a job to a rider who declined, or assign an off-duty rider, with a required reason recorded as an override. Zone and capacity stay hard rules.
   - A history for rider profile changes.
   - `Idempotency-Key` support so every retried request returns its original response.

**Also on the list:**
- tune the scoring weights from delivery data
- real locations with a geospatial index
- cursor pagination
- a single worker for the timeout check
- SMS login with rate limiting
- dispatcher account management
- browser end-to-end tests in CI.

# Enterprise Review And Incremental Modernization Plan

## Current Stack

- Frontend: Vite multi-page app with TypeScript and Tailwind CSS
- Backend: Express + TypeScript runtime via `tsx`
- Persistence: `lowdb` JSON file in `server/data/auctions.json`
- Identity: browser-side Microsoft Entra ID via `@azure/msal-browser`
- File handling: `multer` to local disk

## Current Architecture Summary

- `signin.html` and `src/signin.ts`: sign-in UX and client-side auth state
- `bidding.html` and `src/main.ts`: auction dashboard, admin upload form, bid placement
- `item.html` and `src/item.ts`: item detail and bid entry
- `server/index.ts`: CRUD-style API, uploads, JSON persistence

## Enterprise Gaps Identified

### Identity And Access

- AD integration is browser-driven only. The backend does not validate tokens, groups, or roles.
- LDAP/LDAPS is not implemented. The current design is Entra ID client auth, not enterprise directory-bound server auth.
- Role enforcement is UI-side only; the API does not authorize admin upload or bidding actions.
- Demo and local modes are useful for development, but they currently sit close to production logic.

### Auction Correctness

- Before this pass, bid rules were only partially enforced on the server.
- The API accepted bidder identity from the client, weakening anonymous bidding guarantees.
- Item creation lacked robust validation for start/end times, reserve price, and increment rules.

### Audit And Compliance

- There was no durable audit trail for bid placement, exports, or item creation.
- No request correlation or immutable event ledger existed.
- Export capability was missing for audit/compliance operations.

### Notifications

- No email integration or notification queue/outbox existed.
- Event-driven communication was not modeled, making future SMTP or enterprise messaging integration harder.

### Security

- Minimal security headers
- Upload validation was too permissive
- No request tracing
- No optional admin API protection for operational endpoints

### Scalability And Maintainability

- `lowdb` JSON persistence is not suitable for concurrency, high-volume bidding, or strong transactional integrity.
- Frontend state, role logic, and auth flow are spread across multiple files without a shared auth service.
- README and operational docs are effectively absent.

## Improvements Implemented In This Pass

### Backend Hardening

- Added security-focused response headers and per-request request IDs
- Added stricter JSON body limits
- Added upload MIME allowlists and file size limits
- Added server-side validation for item creation and bid placement
- Enforced anonymous bidding on the server by ignoring client-supplied bidder names
- Added health endpoint: `/api/health`

### Audit And Notification Foundations

- Added persistent `audits` collection to the database
- Added persistent `notificationQueue` outbox to the database
- Audit events now capture:
  - system seed
  - item creation
  - bid placement
  - data export

### Export Capability

- Added CSV export endpoints:
  - `/api/exports/items.csv`
  - `/api/exports/audits.csv`
- Added optional `ADMIN_API_TOKEN` protection for exports without breaking existing flows when unset

## Recommended Target Architecture

### Application Layers

1. Web UI
   - TypeScript frontend
   - shared auth/session module
   - route-level guards

2. API Layer
   - Express or NestJS service
   - token validation middleware
   - centralized authorization policy layer
   - request validation layer

3. Domain Services
   - auction lifecycle service
   - bidding rules service
   - admin catalog service
   - notification orchestration service
   - audit service

4. Data Layer
   - PostgreSQL for transactional data
   - object storage for uploads
   - Redis for caching, throttling, and live bid fan-out
   - message queue for notifications and exports

### Identity And AD Strategy

- For Entra ID:
  - move token validation to the backend
  - validate JWT issuer, audience, expiration, tenant, and group claims
  - map roles server-side from groups

- For LDAP/LDAPS:
  - add a dedicated directory adapter service
  - keep LDAP/LDAPS behind the server, never from the browser
  - cache group lookups with expiry and failure fallbacks

## Proposed Enterprise Data Model

### Core Tables

- `users`
  - id
  - external_directory_id
  - display_name
  - email
  - status
  - created_at

- `roles`
  - id
  - name

- `user_roles`
  - user_id
  - role_id
  - source (`group`, `manual`, `system`)

- `auction_items`
  - id
  - title
  - category
  - lot
  - sku
  - condition
  - location
  - start_bid
  - reserve
  - increment
  - current_bid
  - status
  - start_time
  - end_time
  - created_by
  - created_at

- `bids`
  - id
  - item_id
  - bidder_user_id
  - bidder_alias
  - amount
  - accepted
  - rejection_reason
  - created_at

- `bid_events`
  - id
  - bid_id
  - event_type
  - payload
  - created_at

- `audit_log`
  - id
  - request_id
  - actor_id
  - actor_type
  - action
  - entity_type
  - entity_id
  - before_state
  - after_state
  - created_at

- `notification_outbox`
  - id
  - channel
  - recipient
  - template
  - payload
  - status
  - retry_count
  - created_at

## Recommended API Shape

- `POST /api/auth/session`
- `GET /api/me`
- `GET /api/items`
- `GET /api/items/:id`
- `POST /api/items`
- `PATCH /api/items/:id`
- `POST /api/items/:id/bids`
- `GET /api/items/:id/bids`
- `GET /api/audit`
- `GET /api/exports/items.csv`
- `GET /api/exports/audits.csv`
- `GET /api/notifications/outbox`

## Frontend Refactoring Plan

### Immediate

- Extract shared auth state into one module used by sign-in, bidding, and item pages
- Centralize API calls in a typed client
- Move role and permission checks out of view templates into helper functions

### Next

- Introduce a component-based frontend shell
- Add live update channel for bid changes
- Add admin export and notification monitoring UI

## Testing Strategy

### Unit Tests

- bid validation rules
- role resolution
- auction state transitions
- item validation
- notification queue creation

### Integration Tests

- sign-in to bidding flow
- admin item creation
- bid acceptance and rejection paths
- anonymous bidder visibility rules
- audit event generation
- export endpoint correctness

### Security Tests

- file upload validation bypass attempts
- auth bypass on admin endpoints
- malformed payload tests
- XSS and stored content checks
- rate limit and abuse tests

## Vulnerability Scan Plan

- `npm audit`
- static analysis on frontend and API
- dependency review in CI
- OWASP ZAP against staging
- upload fuzzing and content-type spoof tests

## CI/CD Recommendations

- frontend build
- server type-check
- unit and integration tests
- dependency vulnerability scanning
- artifact versioning
- staging deployment gate
- production approval gate

## Recommended Next Increment

1. Move all auth and role enforcement to the backend
2. Replace `lowdb` with PostgreSQL
3. Introduce repository and service layers in the API
4. Add real email delivery via SMTP or enterprise relay
5. Add immutable audit storage and export filtering

# Self-hosted support backend — Phase 1

Separate Express/PostgreSQL backend for the existing support frontend. It uses no hosted backend service.

## Start with Docker
```bash
cd backend
cp .env.example .env
# Set POSTGRES_PASSWORD and a random SESSION_SECRET (32+ characters).
docker compose up --build -d
curl http://localhost:8080/api/health
```
PostgreSQL is private to Docker. Named `postgres_data` and `upload_data` volumes survive `docker compose down`; `docker compose down -v` deletes them.

Required configuration is `DATABASE_URL`, comma-separated `FRONTEND_URL`, and `SESSION_SECRET`. Cookie names, durations, Argon2id costs, upload settings, retention interval, port, and proxy trust are documented in `.env.example`. Never place secrets in frontend `VITE_*` values.

## Migrations, seed, and development
```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run dev
```
Production uses `npx prisma migrate deploy` (the API container runs it before startup). Seed data includes permissions, settings, and quick actions only—never passwords.

Development reset (destructive): `npx prisma migrate reset`.

## First Super Admin
After migration, run `docker compose exec api npm run create-super-admin` or `npm run create-super-admin`. The interactive script hides the password, hashes with Argon2id, and rejects duplicate usernames. No registration endpoint exists.

## Frontend connection
`VITE_API_URL=` keeps browser mock mode unchanged. Set `VITE_API_URL=http://localhost:8080` to use this API. Ensure `FRONTEND_URL` contains the exact frontend origin. Authentication uses separate HttpOnly management/customer cookies.

## Health
`curl http://localhost:8080/api/health` returns `{"ok":true,"service":"support-backend","database":"connected"}`.

## Tests
```bash
docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL=postgresql://support_user:test_password@127.0.0.1:55432/support_test npm test
docker compose -f docker-compose.test.yml down
```
Tests migrate and clear the disposable database between cases.

## Security and VPS notes
Opaque random session tokens are SHA-256 hashed in PostgreSQL. Cookies are HttpOnly and Secure in production. Helmet, explicit credentialed CORS, strict validation, payload/rate limits, Argon2id, permission/queue checks, server-derived identities, idempotent messages, and safe errors are enabled. Deploy behind Caddy HTTPS, retain `TRUST_PROXY=1`, use a least-privilege database account, back up PostgreSQL and uploads, and never expose PostgreSQL publicly.

Phase 1 implements health, auth/session flows, customer list/detail/update/convert/assign/status/notes/history, conversation list/detail, message pagination/send/read, settings, public quick actions, permission reads, audit reads, authenticated Socket.IO room join/leave, and retention. Phase 2 intentionally retains advanced realtime broadcasts, upload processing, password-reset delivery, complete staff/admin and management CRUD, full conversation mutations, session administration, and hard-deletion policy.

## Phase 2 — realtime, conversion, sessions

Socket.IO is attached to the same HTTP server at `/socket.io`. Identity comes
only from the existing HttpOnly session cookies (`authenticateSocket`); nothing
is trusted from the client payload.

Rooms: `user:{id}`, `customer:{id}`, `conversation:{id}`,
`queue:NEW_CLIENTS`, `queue:RECURRING_CLIENTS`.

Client → server: `conversation:join`, `conversation:leave`, `message:send`,
`message:read`, `typing:start`, `typing:stop`. Join/send/read are acknowledged
with `{ ok, success, data }` or `{ ok:false, success:false, error:{code,message} }`.

Server → client: `message:new`, `message:delivered`, `message:read`,
`typing:start`/`typing:stop`, `customer:online`/`offline`,
`staff:online`/`offline`, `conversation:assigned`, `conversation:transferred`,
`customer:converted`, `customer:blocked`, `session:expired`.

REST and sockets share `src/services/message.service.ts` for persistence, so
message ids, `clientMessageId` de-duplication and read receipts are identical
either way. REST stays authoritative for history and reconciliation after a
reconnect (the client re-joins rooms and re-fetches recent messages).

Conversion (`POST /api/customers/:id/convert`) runs in one transaction: same
customer id, same conversation id, all messages/attachments/notes kept,
`clientType` NEW → RECURRING, Argon2id password hash, assignment transfer with
history, status history, audit entry, and live temporary sessions upgraded to
`AUTHENTICATED` (silent upgrade, no login screen). `customer:converted` is
broadcast to the customer and staff queues.

Multi-device: `GET /api/customers/sessions` and
`POST /api/customers/sessions/:id/revoke` (owning customer or management).
Blocking revokes all customer sessions and emits `session:expired`.

Tests: `tests/phase2.test.ts` (requires the disposable test database from
`docker-compose.test.yml`).

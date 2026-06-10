# JobEase Backend

The backend connects to MySQL using `mysql2`.

## Start

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@jobease.com` | `customer123` |
| Worker | `worker@jobease.com` | `worker123` |
| Admin | `admin@jobease.com` | `admin123` |

## API Foundation

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/workers/register`
- `GET /api/workers` - admin only
- `DELETE /api/workers/:id` - admin only
- `POST /api/jobs` - customer only
- `GET /api/jobs` - customer, worker, or admin
- `POST /api/quick-bookings` - customer only
- `POST /api/quick-bookings/:id/verify-otp`

Copy `.env.example` to `.env` and update the MySQL credentials before starting:

```powershell
Copy-Item .env.example .env
```

Create or update the MySQL tables:

```powershell
mysql -u root -p < database/schema.sql
```

Test the database connection:

```powershell
npm run test:db
```

Passwords are hashed with Node.js `scrypt`.

The server uses MySQL as the single source of truth for users, worker profiles, jobs, quick bookings, reviews, and admin worker management.

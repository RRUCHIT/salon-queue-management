**Live demo:** <to be added after deploy>

# Salon Queue Management

Premium bilingual salon queue management for customers, reception, barbers,
waiting-area TV, and owners.

## Test PINs

- Staff and owner PIN: `1234` by default
- Set a deployment PIN with `STAFF_PIN`

## Run locally

```powershell
cd "D:\Salon Queue Management"
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Health: http://localhost:4000/api/health

Copy `.env.example` to `.env` for local configuration.

## Production build

```powershell
npm test
npm run build
```

## Feature list

- Live customer join, duplicate protection, status, countdown, cancellation
- Reception waiting list, walk-ins, call-next, no-shows, and re-add
- Barber Start/Done, timers, availability, and break state
- 1920x1080 waiting-area display with Socket.IO updates and optional sound
- Owner PIN access, service CRUD, barber duty, opening state, and stats
- English/Gujarati labels and responsive layouts

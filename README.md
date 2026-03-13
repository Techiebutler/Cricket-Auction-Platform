# Cricket Auction App

An IPL-style cricket player auction platform with real-time bidding via WebSockets.

## Stack

- **Backend**: FastAPI + SQLAlchemy (async) + PostgreSQL + Redis (Caching & WebSockets) + ARQ (Background Tasks)
- **Frontend**: Next.js 14 (App Router) + TailwindCSS + Zustand
- **Storage & Email**: AWS S3 (Profile Photos) + AWS SES (Invitations)
- **Infra**: Docker Compose + Nginx

## Getting Started (Development)

1. Copy the environment variables:
```bash
cp .env.example .env
```

2. Fill out the `.env` file with your credentials (S3, SES, DB, etc.).

3. Start the application in development mode:
```bash
docker compose up --build
```
*Note: The development setup automatically mounts your local source code into the containers and enables hot-reloading for both the frontend (Next.js) and backend (FastAPI).*

4. Run Database Migrations (if running for the first time or after pulling new changes):
```bash
docker compose exec backend alembic upgrade head
```

5. (Optional) Seed 40 Test Players to populate the database:
```bash
docker compose exec backend python seed_players.py
```

Open [http://localhost](http://localhost) in your browser.

The API docs are available at [http://localhost/api/docs](http://localhost/api/docs).

## Production Deployment

For production, use the optimized Dockerfiles and Compose file (`docker-compose.prod.yml`). This uses Next.js standalone builds, multi-worker Uvicorn configurations, and strips out hot-reloading overhead.

1. Ensure your `.env` is configured for production. **Crucially**, set the WebSockets URL to match your domain:
```bash
# In .env
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/api/auction/ws
```

2. Build and start the production containers in detached mode:
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

3. Run the database migrations against the production database:
```bash
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

### God Mode (Testing)
You can instantly log in as any user in non-production environments using the `GODMODE_SECRET` configured in your `.env`.
To do this, use the following URL format: `http://localhost/auth/login?godmode=<YOUR_SECRET>&email=<USER_EMAIL>`

## User Roles

| Role | Access |
|------|--------|
| `admin` | Create auction events, assign organizer/auctioneer, set allowed domains |
| `organizer` | Manage event settings (date, budget, max players), add players, create teams, assign captains, mark event ready |
| `auctioneer` | Start/pause auction, randomly pick next player, handle unsold players, finish auction |
| `captain` | Place bids, view team budget & roster, bookmark upcoming players |
| `player` | Onboard profile (ratings, photo), view personal dashboard |
| `spectator` | Watch live auction (projector-ready full-screen view), see standings, rosters, and bid history |

## Auction Flow

1. **Admin** creates an event and assigns an organizer.
2. **Organizer** sets up the event in the `draft` stage:
   - Configures global settings (auction date, total budget, max players per team).
   - Adds players (filtered by email domain).
   - Creates teams and assigns captains.
   - Publishes the event by marking it as `ready`.
3. Background tasks (ARQ worker) automatically send email invitations to all assigned participants (Auctioneer, Captains, Players).
4. At the scheduled time, the **Auctioneer** starts the auction, picks players, and manages the timer.
5. **Captains** bid in real-time; the timer resets on each bid.
6. On timer expiry (or manual hammer): the player is sold to the highest bidder or goes unsold.
7. Unsold players can be re-auctioned by the Auctioneer later in the event.
8. The Auctioneer completes the event via the "Finish Auction" action.
9. **Spectators** can watch the entire event live on `/auction/{eventId}/spectate`.

## WebSocket Events

All clients connect to `ws://localhost/api/auction/ws/{eventId}?token=<jwt>`

| Event | Description |
|-------|-------------|
| `auction_state` | Full state snapshot on connect |
| `player_up` | New player put up for auction |
| `new_bid` | A captain placed a bid |
| `timer_tick` | Timer countdown (every second) |
| `player_sold` | Player sold to a captain |
| `player_unsold` | Player went unsold |
| `auction_paused` | Auctioneer paused the auction |
| `auction_resumed` | Auctioneer resumed the auction |
| `auction_completed` | The auction has officially finished |

## Development

```bash
# Backend only
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend only
cd frontend
npm install
npm run dev
```

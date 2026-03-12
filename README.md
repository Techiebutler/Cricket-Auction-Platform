# Cricket Auction App

An IPL-style cricket player auction platform with real-time bidding via WebSockets.

## Stack

- **Backend**: FastAPI + SQLAlchemy (async) + PostgreSQL + Redis
- **Frontend**: Next.js 14 (App Router) + TailwindCSS + Zustand
- **Infra**: Docker Compose + Nginx

## Getting Started

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost](http://localhost) in your browser.

The API docs are available at [http://localhost/api/docs](http://localhost/api/docs).

## User Roles

| Role | Access |
|------|--------|
| `admin` | Create auction events, assign organizer/auctioneer, set allowed domains |
| `organizer` | Add players, create teams, assign captains, set budgets |
| `auctioneer` | Start/pause auction, pick next player, hammer bids |
| `captain` | Place bids, view team budget & roster |
| `player` | Onboard profile (ratings, photo), spectate |
| `spectator` | Watch live auction (projector view) |

## Auction Flow

1. Admin creates an event and assigns an organizer
2. Organizer adds players (filtered by email domain), creates teams, assigns captains, marks event as ready
3. Auctioneer starts the auction, picks players (or random), manages the 60s timer
4. Captains bid in real-time; timer resets on each bid
5. On timer expiry: auto-hammer to highest bidder (or unsold if no bids)
6. Spectators watch on `/auction/{eventId}/spectate` (projector-ready full-screen view)

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

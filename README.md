# Table Clicker

Table Clicker is a browser-based clicker + casino game designed for local multiplayer sessions on a shared LAN server.

Players connect to the same server, join the same table automatically, chat together, see each other's activity, and share selected game systems such as the slot machine jackpot.

## Run

```powershell
python server.py
```

Then open:

```text
http://localhost:8000
```

To play with other people on the same local network, share this machine's LAN address with port `8000`, for example:

```text
http://192.168.1.42:8000
```

The server listens on `0.0.0.0:8000`, which makes it reachable from this PC's network interfaces. It is not exposed to the public Internet unless you explicitly publish it through port forwarding, a tunnel, VPN, reverse proxy, or similar tooling.

## Core Idea

There is a single shared network table per server.

There are no rooms, invites, or matchmaking flows. Any player opening the site from the same server joins the same live table automatically.

That shared table includes:

- a live player list
- a table-wide chat
- a shared event log
- multiplayer poker and race events
- a shared, persistent slot machine jackpot

## Gameplay

Players build chips by clicking, buying upgrades, and playing several casino-style games.

Current game systems include:

- Clicker progression with passive income upgrades
- Roulette
- Blackjack
- Texas Hold'em style multiplayer poker
- A race mode with participants and spectators
- A 3x3 slot machine with 8 paylines, cross-line bonuses, scatter diamonds, and a shared jackpot

## Shared Slot Jackpot

The slot machine jackpot is shared by all players connected to the same server.

How it works:

- Every slot spin contributes to the same jackpot pool
- A qualifying diamond line can trigger the jackpot
- When one player wins it, the jackpot resets for everyone
- A global jackpot announcement is shown to all connected players
- The event log highlights jackpot wins
- The player list shows the latest jackpot won by each player

Unlike earlier versions, slot resolution is handled by the server, not by each client.

## Ghost Roulette

The `Ghost Dealer` upgrade is a late-game upgrade that unlocks roulette automation.

Its current design:

- base cost: `250,000` chips
- cost multiplier: `x2.35` per level
- passive bonus: `+750 chips/s` per level
- unlocks the `Ghost Roulette` control panel in roulette

Once unlocked, the player can automate bets on red or black.

- Minimum automated bet: `100`
- Automation never uses the `All in` action
- Level 1 spins every 60 seconds
- Each additional level reduces the delay by 7.5 seconds
- Minimum delay is 30 seconds

## Multiplayer Poker

Poker is table-based and requires multiple players.

Flow:

- Each player clicks `Ready for poker` with a chosen stake
- The hand starts automatically when at least 2 players are ready
- The game progresses through preflop, flop, turn, and river
- Active players choose whether to stay in or fold
- If only one player remains, that player wins immediately
- Otherwise the server evaluates the final hands and awards the pot

## Race Mode

The race mode allows players to compete in a timed all-in event while other players can bet on the result.

Highlights:

- the host opens a race lobby
- participants join before the start
- when the race starts, participating players are reset to a clean run for that race
- spectators can place wagers during the betting window
- the server settles the race and spectator payouts at the end

## Persistence

There are two layers of persistence:

- Client persistence: each player's local progression is stored in the browser with `localStorage`
- Server persistence: shared multiplayer state is stored in `shared_state.sqlite3`

What survives a browser refresh:

- local player progression
- name, upgrades, chips, and related local state

What survives a server restart:

- shared slot jackpot amount
- shared slot spin count

What does not fully persist across a server restart:

- connected players
- in-memory chat history
- recent event log entries
- live poker hands
- live race state

## Tech Notes

- Frontend: plain HTML, CSS, and JavaScript
- Backend: Python standard library HTTP server
- No external dependencies are required

## Project Structure

- `index.html`: UI markup
- `styles.css`: visual design and animations
- `app.js`: client logic, rendering, and interactions
- `server.py`: shared multiplayer state and server-side game resolution
- `shared_state.sqlite3`: persisted shared multiplayer state, created automatically

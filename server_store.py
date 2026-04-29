from contextlib import closing
import datetime
import sqlite3
import threading

from server_models import bounded_int, normalize_slots


class SharedStateStore:
    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def initialize(self):
        with self._lock, closing(self.connect()) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS room_slots (
                    room_name TEXT PRIMARY KEY,
                    jackpot INTEGER NOT NULL,
                    spins INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS player_profiles (
                    player_id TEXT PRIMARY KEY,
                    last_name TEXT,
                    last_jackpot_amount INTEGER,
                    last_jackpot_at REAL
                );

                CREATE TABLE IF NOT EXISTS race_leaderboard (
                    room_name TEXT NOT NULL,
                    player_id TEXT NOT NULL,
                    player_name TEXT NOT NULL,
                    races INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    best_score REAL NOT NULL DEFAULT 0,
                    total_score REAL NOT NULL DEFAULT 0,
                    best_payout INTEGER NOT NULL DEFAULT 0,
                    total_payout INTEGER NOT NULL DEFAULT 0,
                    last_race_at REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (room_name, player_id)
                );

                CREATE TABLE IF NOT EXISTS daily_tickets (
                    player_id TEXT NOT NULL,
                    ticket_date TEXT NOT NULL,
                    reward_id TEXT NOT NULL,
                    reward_payload TEXT NOT NULL,
                    claimed_at REAL NOT NULL,
                    PRIMARY KEY (player_id, ticket_date)
                );
                """
            )
            conn.commit()

    def load_rooms(self):
        with self._lock, closing(self.connect()) as conn:
            rows = conn.execute("SELECT room_name, jackpot, spins FROM room_slots").fetchall()
        return {
            row["room_name"]: {"slots": normalize_slots({"jackpot": row["jackpot"], "spins": row["spins"]})}
            for row in rows
        }

    def save_room_slots(self, room_name, slots):
        slots = normalize_slots(slots)
        with self._lock, closing(self.connect()) as conn:
            conn.execute(
                """
                INSERT INTO room_slots (room_name, jackpot, spins)
                VALUES (?, ?, ?)
                ON CONFLICT(room_name) DO UPDATE SET
                    jackpot = excluded.jackpot,
                    spins = excluded.spins
                """,
                (room_name, slots["jackpot"], slots["spins"]),
            )
            conn.commit()

    def record_race_result(self, room_name, result):
        race_at = float(result.get("at", 0) or 0)
        winner_id = result.get("winnerId")
        payout = bounded_int(result.get("payout", 0), 0, 0)
        rows = []
        for player in result.get("players", []):
            player_id = str(player.get("id", "") or "")
            if not player_id:
                continue
            score = max(0.0, float(player.get("score", 0) or 0))
            won = 1 if player_id == winner_id else 0
            player_payout = payout if won else 0
            rows.append((
                room_name,
                player_id,
                str(player.get("name", "Joueur") or "Joueur")[:18],
                1,
                won,
                score,
                score,
                player_payout,
                player_payout,
                race_at,
            ))
        if not rows:
            return
        with self._lock, closing(self.connect()) as conn:
            conn.executemany(
                """
                INSERT INTO race_leaderboard (
                    room_name, player_id, player_name, races, wins,
                    best_score, total_score, best_payout, total_payout, last_race_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(room_name, player_id) DO UPDATE SET
                    player_name = excluded.player_name,
                    races = race_leaderboard.races + excluded.races,
                    wins = race_leaderboard.wins + excluded.wins,
                    best_score = MAX(race_leaderboard.best_score, excluded.best_score),
                    total_score = race_leaderboard.total_score + excluded.total_score,
                    best_payout = MAX(race_leaderboard.best_payout, excluded.best_payout),
                    total_payout = race_leaderboard.total_payout + excluded.total_payout,
                    last_race_at = MAX(race_leaderboard.last_race_at, excluded.last_race_at)
                """,
                rows,
            )
            conn.commit()

    def load_race_leaderboard(self, room_name, limit=20):
        with self._lock, closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT player_id, player_name, races, wins, best_score, total_score,
                       best_payout, total_payout, last_race_at
                FROM race_leaderboard
                WHERE room_name = ?
                ORDER BY wins DESC, best_score DESC, total_score DESC, last_race_at DESC
                LIMIT ?
                """,
                (room_name, max(1, int(limit or 20))),
            ).fetchall()
        return [
            {
                "id": row["player_id"],
                "name": row["player_name"],
                "races": max(0, int(row["races"] or 0)),
                "wins": max(0, int(row["wins"] or 0)),
                "bestScore": max(0, float(row["best_score"] or 0)),
                "totalScore": max(0, float(row["total_score"] or 0)),
                "bestPayout": max(0, int(row["best_payout"] or 0)),
                "totalPayout": max(0, int(row["total_payout"] or 0)),
                "lastRaceAt": float(row["last_race_at"] or 0),
            }
            for row in rows
        ]

    def load_player_profiles(self):
        with self._lock, closing(self.connect()) as conn:
            rows = conn.execute(
                "SELECT player_id, last_name, last_jackpot_amount, last_jackpot_at FROM player_profiles"
            ).fetchall()
        profiles = {}
        for row in rows:
            jackpot = None
            if row["last_jackpot_amount"] is not None and row["last_jackpot_at"] is not None:
                jackpot = {
                    "amount": bounded_int(row["last_jackpot_amount"], 0, 0),
                    "at": float(row["last_jackpot_at"]),
                }
            profiles[row["player_id"]] = {
                "name": row["last_name"] or "Joueur",
                "lastJackpot": jackpot,
            }
        return profiles

    def save_player_profile(self, player_id, name, last_jackpot=None):
        jackpot_amount = None
        jackpot_at = None
        if last_jackpot:
            jackpot_amount = bounded_int(last_jackpot.get("amount", 0), 0, 0)
            jackpot_at = float(last_jackpot.get("at", 0) or 0)
        with self._lock, closing(self.connect()) as conn:
            conn.execute(
                """
                INSERT INTO player_profiles (player_id, last_name, last_jackpot_amount, last_jackpot_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(player_id) DO UPDATE SET
                    last_name = excluded.last_name,
                    last_jackpot_amount = excluded.last_jackpot_amount,
                    last_jackpot_at = excluded.last_jackpot_at
                """,
                (player_id, name, jackpot_amount, jackpot_at),
            )
            conn.commit()

    def load_daily_ticket_status(self, player_id, today, yesterday):
        with self._lock, closing(self.connect()) as conn:
            today_row = conn.execute(
                """
                SELECT reward_id, reward_payload, claimed_at
                FROM daily_tickets
                WHERE player_id = ? AND ticket_date = ?
                """,
                (player_id, today),
            ).fetchone()
            dates = conn.execute(
                """
                SELECT ticket_date
                FROM daily_tickets
                WHERE player_id = ?
                ORDER BY ticket_date DESC
                LIMIT 60
                """,
                (player_id,),
            ).fetchall()
        claimed_dates = {row["ticket_date"] for row in dates}
        streak = 0
        cursor = today if today in claimed_dates else yesterday
        while cursor in claimed_dates:
            streak += 1
            year, month, day = [int(part) for part in cursor.split("-")]
            cursor = (datetime.date(year, month, day) - datetime.timedelta(days=1)).isoformat()
        return {
            "available": today_row is None,
            "date": today,
            "claimed": today_row is not None,
            "streak": streak,
            "lastClaimDate": max(claimed_dates) if claimed_dates else "",
        }

    def claim_daily_ticket(self, player_id, today, reward_id, reward_payload, claimed_at):
        with self._lock, closing(self.connect()) as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO daily_tickets (player_id, ticket_date, reward_id, reward_payload, claimed_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (player_id, today, reward_id, reward_payload, float(claimed_at)),
                )
                conn.commit()
                inserted = True
            except sqlite3.IntegrityError:
                inserted = False
            row = conn.execute(
                """
                SELECT reward_id, reward_payload, claimed_at
                FROM daily_tickets
                WHERE player_id = ? AND ticket_date = ?
                """,
                (player_id, today),
            ).fetchone()
        if not row:
            return inserted, None
        return inserted, {
            "id": row["reward_id"],
            "payload": row["reward_payload"],
            "claimedAt": float(row["claimed_at"] or 0),
        }

from contextlib import closing
import sqlite3
import threading

from server_models import SLOT_JACKPOT_SEED, normalize_slots


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
                    "amount": max(0, int(row["last_jackpot_amount"] or 0)),
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
            jackpot_amount = max(0, int(last_jackpot.get("amount", 0) or 0))
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

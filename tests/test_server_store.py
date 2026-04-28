import os
import tempfile
import unittest

from server_store import SharedStateStore
from server_models import SQLITE_MAX_INTEGER, bounded_int


class SharedStateStoreTests(unittest.TestCase):
    def test_room_slots_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "state.sqlite3")
            store = SharedStateStore(path)
            store.initialize()

            store.save_room_slots("table-reseau", {"jackpot": 3456, "spins": 42})
            rooms = store.load_rooms()

            self.assertEqual(rooms["table-reseau"]["slots"]["jackpot"], 3456)
            self.assertEqual(rooms["table-reseau"]["slots"]["spins"], 42)

    def test_player_profile_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "state.sqlite3")
            store = SharedStateStore(path)
            store.initialize()

            store.save_player_profile("player-1", "Alice", {"amount": 9000, "at": 1234.5})
            profiles = store.load_player_profiles()

            self.assertEqual(profiles["player-1"]["name"], "Alice")
            self.assertEqual(profiles["player-1"]["lastJackpot"]["amount"], 9000)
            self.assertEqual(profiles["player-1"]["lastJackpot"]["at"], 1234.5)

    def test_player_profile_clamps_oversized_jackpot_for_sqlite(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "state.sqlite3")
            store = SharedStateStore(path)
            store.initialize()

            store.save_player_profile("player-1", "Alice", {"amount": 10 ** 100, "at": 1234.5})
            profiles = store.load_player_profiles()

            self.assertEqual(profiles["player-1"]["lastJackpot"]["amount"], SQLITE_MAX_INTEGER)

    def test_race_leaderboard_aggregates_results(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "state.sqlite3")
            store = SharedStateStore(path)
            store.initialize()

            store.record_race_result("table-reseau", {
                "at": 1000,
                "winnerId": "player-2",
                "payout": 300,
                "players": [
                    {"id": "player-1", "name": "Alice", "score": 120},
                    {"id": "player-2", "name": "Bob", "score": 180},
                ],
            })
            store.record_race_result("table-reseau", {
                "at": 1100,
                "winnerId": "player-1",
                "payout": 500,
                "players": [
                    {"id": "player-1", "name": "Alice", "score": 220},
                    {"id": "player-2", "name": "Bob", "score": 140},
                ],
            })

            leaderboard = store.load_race_leaderboard("table-reseau")

            self.assertEqual(leaderboard[0]["id"], "player-1")
            self.assertEqual(leaderboard[0]["races"], 2)
            self.assertEqual(leaderboard[0]["wins"], 1)
            self.assertEqual(leaderboard[0]["bestScore"], 220)
            self.assertEqual(leaderboard[0]["bestPayout"], 500)

    def test_bounded_int_rejects_non_finite_values(self):
        self.assertEqual(bounded_int("Infinity", 12, 0), 12)
        self.assertEqual(bounded_int("NaN", 12, 0), 12)


if __name__ == "__main__":
    unittest.main()

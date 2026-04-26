import os
import tempfile
import unittest

from server_store import SharedStateStore


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


if __name__ == "__main__":
    unittest.main()

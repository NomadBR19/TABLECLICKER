import unittest

from server import create_race
from server_models import new_room_state


class ServerActionTests(unittest.TestCase):
    def test_create_race_builds_lobby_race(self):
        room = new_room_state()

        race, error = create_race(room, "player-1", "Alice", 60, amount=100, chips=1000)

        self.assertEqual(error, "")
        self.assertIsNotNone(race)
        self.assertTrue(race["id"].startswith("race-"))
        self.assertEqual(room["race"]["players"]["player-1"]["bet"], 100)


if __name__ == "__main__":
    unittest.main()

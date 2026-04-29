import unittest

from server import add_event, create_race, join_race, safe_game_kind, safe_player_id, safe_text, start_race
from server_models import new_room_state


class ServerActionTests(unittest.TestCase):
    def test_safe_text_removes_control_characters(self):
        self.assertEqual(safe_text(" Alice\n<script> ", "Joueur", 18), "Alice <script>")

    def test_safe_player_id_replaces_injection_characters(self):
        self.assertEqual(safe_player_id("player-1\"><img src=x>"), "player-1---img-src-x")

    def test_safe_game_kind_rejects_unknown_event_classes(self):
        self.assertEqual(safe_game_kind("jackpot hacked"), "game")

    def test_add_event_sanitizes_kind_and_text(self):
        room = new_room_state()

        add_event(room, "hello\nworld", "x\" onclick=\"boom")

        self.assertEqual(room["events"][0]["text"], "hello world")
        self.assertEqual(room["events"][0]["kind"], "event")

    def test_create_race_builds_lobby_race(self):
        room = new_room_state()

        race, error = create_race(room, "player-1", "Alice", 60, amount=100, chips=1000)

        self.assertEqual(error, "")
        self.assertIsNotNone(race)
        self.assertTrue(race["id"].startswith("race-"))
        self.assertEqual(room["race"]["players"]["player-1"]["bet"], 100)

    def test_start_race_keeps_chosen_bets(self):
        room = new_room_state()
        room["players"]["player-1"] = {"name": "Alice", "chips": 1000}
        room["players"]["player-2"] = {"name": "Bob", "chips": 800}
        create_race(room, "player-1", "Alice", 60, amount=100, chips=1000)
        join_race(room, "player-2", "Bob", amount=250, chips=800)

        race, error = start_race(room, "player-1")

        self.assertEqual(error, "")
        self.assertEqual(race["players"]["player-1"]["bet"], 100)
        self.assertEqual(race["players"]["player-2"]["bet"], 250)

    def test_start_race_rejects_bet_player_can_no_longer_pay(self):
        room = new_room_state()
        room["players"]["player-1"] = {"name": "Alice", "chips": 1000}
        room["players"]["player-2"] = {"name": "Bob", "chips": 80}
        create_race(room, "player-1", "Alice", 60, amount=100, chips=1000)
        join_race(room, "player-2", "Bob", amount=250, chips=800)

        race, error = start_race(room, "player-1")

        self.assertIsNone(race)
        self.assertIn("plus assez de jetons", error)


if __name__ == "__main__":
    unittest.main()

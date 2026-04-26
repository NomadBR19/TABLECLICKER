import unittest

from server_games import (
    SLOT_JACKPOT_SEED,
    SLOT_SYMBOLS,
    evaluate_holdem,
    resolve_slot_spin,
    score_slots,
)


class FakeRng:
    def __init__(self, values):
        self.values = list(values)
        self.index = 0

    def random(self):
        value = self.values[self.index]
        self.index += 1
        return value


def symbol(symbol_id):
    return next(item for item in SLOT_SYMBOLS if item["id"] == symbol_id)


class ServerGamesTests(unittest.TestCase):
    def test_score_slots_awards_shared_jackpot_on_gem_line(self):
        grid = [
            symbol("gem"), symbol("gem"), symbol("gem"),
            symbol("cherry"), symbol("lemon"), symbol("orange"),
            symbol("bell"), symbol("seven"), symbol("star"),
        ]

        result = score_slots(grid, bet=25, jackpot_value=1200)

        self.assertEqual(result["jackpotPayout"], 1200)
        self.assertGreater(result["payout"], 1200)
        self.assertTrue(any(win["symbolId"] == "gem" for win in result["wins"]))

    def test_resolve_slot_spin_resets_jackpot_after_win(self):
        # Values close to 1 pick the last rare symbols in weighted_slot_symbol.
        rng = FakeRng([0.98, 0.98, 0.98, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06])

        outcome = resolve_slot_spin({"jackpot": 1000, "spins": 4}, bet=25, rng=rng)

        self.assertEqual(outcome["slots"]["jackpot"], SLOT_JACKPOT_SEED)
        self.assertEqual(outcome["slots"]["spins"], 5)
        self.assertGreater(outcome["result"]["jackpotPayout"], 0)
        self.assertEqual(outcome["grid"][:3], ["gem", "gem", "gem"])

    def test_evaluate_holdem_prefers_straight_flush(self):
        cards = [
            {"rank": "A", "suit": "S"},
            {"rank": "K", "suit": "S"},
            {"rank": "Q", "suit": "S"},
            {"rank": "J", "suit": "S"},
            {"rank": "10", "suit": "S"},
            {"rank": "2", "suit": "D"},
            {"rank": "3", "suit": "C"},
        ]

        score = evaluate_holdem(cards)

        self.assertEqual(score[0], 9)
        self.assertEqual(score[2], "Royal flush")


if __name__ == "__main__":
    unittest.main()

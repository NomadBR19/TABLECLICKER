import itertools
import random

SLOT_SYMBOLS = [
    {"id": "cherry", "label": "Cerise", "weight": 31, "mult": 1},
    {"id": "lemon", "label": "Citron", "weight": 25, "mult": 2},
    {"id": "orange", "label": "Orange", "weight": 20, "mult": 2},
    {"id": "bell", "label": "Cloche", "weight": 13, "mult": 4},
    {"id": "seven", "label": "Sept", "weight": 7, "mult": 8},
    {"id": "gem", "label": "Diamant", "weight": 3, "mult": 18},
    {"id": "star", "label": "Wild", "weight": 1, "mult": 5, "wild": True},
]
SLOT_LINES = [
    {"id": "top", "name": "Haut", "cells": [0, 1, 2]},
    {"id": "middle", "name": "Milieu", "cells": [3, 4, 5]},
    {"id": "bottom", "name": "Bas", "cells": [6, 7, 8]},
    {"id": "left", "name": "Gauche", "cells": [0, 3, 6]},
    {"id": "center", "name": "Centre", "cells": [1, 4, 7]},
    {"id": "right", "name": "Droite", "cells": [2, 5, 8]},
    {"id": "diag-a", "name": "Diagonale", "cells": [0, 4, 8]},
    {"id": "diag-b", "name": "Diagonale", "cells": [2, 4, 6]},
]
SLOT_JACKPOT_SEED = 250
SLOT_SCATTER_MULT = 3
SLOT_CROSS_BONUS_RATE = 0.05
SLOT_JACKPOT_CONTRIBUTION = 0.02
SUITS = ["S", "H", "D", "C"]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


def weighted_slot_symbol(rng=None):
    rng = rng or random
    total = sum(symbol["weight"] for symbol in SLOT_SYMBOLS)
    roll = rng.random() * total
    for symbol in SLOT_SYMBOLS:
        roll -= symbol["weight"]
        if roll <= 0:
            return symbol
    return SLOT_SYMBOLS[-1]


def winning_line_symbol(symbols):
    natural = next((symbol for symbol in symbols if not symbol.get("wild")), None)
    if not natural:
        return symbols[0]
    if all(symbol.get("wild") or symbol["id"] == natural["id"] for symbol in symbols):
        return natural
    return None


def near_miss_slots(grid, wins):
    if wins:
        return None
    best_symbols = {"seven", "gem", "star"}
    for line in SLOT_LINES:
        symbols = [grid[index] for index in line["cells"]]
        counts = {}
        for symbol in symbols:
            if not symbol.get("wild"):
                counts[symbol["id"]] = counts.get(symbol["id"], 0) + 1
        for symbol_id, count in counts.items():
            if count == 2 and symbol_id in best_symbols:
                return {**line, "symbolId": symbol_id}
    return None


def score_slots(grid, bet, jackpot_value):
    wins = []
    for line in SLOT_LINES:
        symbols = [grid[index] for index in line["cells"]]
        symbol = winning_line_symbol(symbols)
        if symbol:
            wins.append({
                **line,
                "label": symbol["label"],
                "symbolId": symbol["id"],
                "payout": bet * symbol["mult"],
            })

    counts = {}
    for symbol in grid:
        counts[symbol["id"]] = counts.get(symbol["id"], 0) + 1

    scatter_payout = bet * SLOT_SCATTER_MULT if counts.get("gem", 0) >= 3 else 0
    jackpot_win = next((win for win in wins if win["symbolId"] == "gem"), None)
    jackpot_payout = max(0, int(jackpot_value or 0)) if jackpot_win else 0
    line_total = sum(win["payout"] for win in wins)
    cross_bonus = int(line_total * (len(wins) - 1) * SLOT_CROSS_BONUS_RATE) if len(wins) > 1 else 0
    payout = line_total + scatter_payout + cross_bonus + jackpot_payout
    near_miss = near_miss_slots(grid, wins)
    if not payout:
        text = f"Presque {near_miss['name']}. Perdu {bet}" if near_miss else f"Aucune ligne. Perdu {bet}"
        return {
            "payout": 0,
            "wins": wins,
            "scatterPayout": scatter_payout,
            "crossBonus": cross_bonus,
            "jackpotPayout": jackpot_payout,
            "nearMiss": near_miss,
            "text": text,
        }

    parts = []
    if wins:
        parts.append(f"{len(wins)} ligne{'s' if len(wins) > 1 else ''}")
    if scatter_payout:
        parts.append("bonus diamants")
    if cross_bonus:
        parts.append("bonus croise")
    if jackpot_payout:
        parts.append("jackpot")
    return {
        "payout": payout,
        "wins": wins,
        "scatterPayout": scatter_payout,
        "crossBonus": cross_bonus,
        "jackpotPayout": jackpot_payout,
        "nearMiss": near_miss,
        "text": f"{', '.join(parts)}. Gain {payout}",
    }


def resolve_slot_spin(slots_state, bet, rng=None):
    slots = dict(slots_state)
    slots["spins"] = int(slots.get("spins", 0) or 0) + 1
    slots["jackpot"] = int(slots.get("jackpot", 0) or 0) + max(1, int(bet * SLOT_JACKPOT_CONTRIBUTION))
    grid = [weighted_slot_symbol(rng) for _ in range(9)]
    result = score_slots(grid, bet, slots["jackpot"])
    if result["jackpotPayout"]:
        slots["jackpot"] = SLOT_JACKPOT_SEED
    return {
        "slots": slots,
        "grid": [symbol["id"] for symbol in grid],
        "result": result,
    }


def deck(rng=None):
    rng = rng or random
    cards = [{"rank": rank, "suit": suit} for suit in SUITS for rank in RANKS]
    rng.shuffle(cards)
    return cards


def card_rank_value(card):
    if card["rank"] == "A":
        return 14
    if card["rank"] == "K":
        return 13
    if card["rank"] == "Q":
        return 12
    if card["rank"] == "J":
        return 11
    return int(card["rank"])


def evaluate_five(hand):
    values = sorted([card_rank_value(card) for card in hand], reverse=True)
    unique = sorted(set(values), reverse=True)
    low_straight = all(v in unique for v in [14, 5, 4, 3, 2])
    straight_high = 5 if low_straight else 0
    for i in range(0, len(unique) - 4):
        if not straight_high and all(unique[i + j] == unique[i] - j for j in range(5)):
            straight_high = unique[i]

    flush = all(card["suit"] == hand[0]["suit"] for card in hand)
    counts = sorted(((values.count(value), value) for value in set(values)), reverse=True)
    count_shape = sorted([count for count, _ in counts], reverse=True)

    if flush and straight_high == 14:
        return (9, [14], "Royal flush")
    if flush and straight_high:
        return (8, [straight_high], "Quinte flush")
    if count_shape[0] == 4:
        four = next(value for count, value in counts if count == 4)
        return (7, [four], "Carre")
    if count_shape[0] == 3 and count_shape[1] == 2:
        three = next(value for count, value in counts if count == 3)
        return (6, [three], "Full")
    if flush:
        return (5, values, "Couleur")
    if straight_high:
        return (4, [straight_high], "Quinte")
    if count_shape[0] == 3:
        three = next(value for count, value in counts if count == 3)
        return (3, [three], "Brelan")
    if count_shape[0] == 2 and count_shape[1] == 2:
        pairs = [value for count, value in counts if count == 2]
        return (2, pairs, "Deux paires")
    if count_shape[0] == 2:
        pair = next(value for count, value in counts if count == 2)
        return (1, [pair], "Paire")
    return (0, values, "Carte haute")


def evaluate_holdem(cards):
    best = None
    for hand in itertools.combinations(cards, 5):
        score = evaluate_five(list(hand))
        if best is None or score[:2] > best[:2]:
            best = score
    return best or (0, [], "Carte haute")


def format_cards(cards):
    suit_names = {"S": "pique", "H": "coeur", "D": "carreau", "C": "trefle"}
    return ", ".join(f"{card['rank']} {suit_names.get(card['suit'], card['suit'])}" for card in cards)

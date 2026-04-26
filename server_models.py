ROOM_NAME = "table-reseau"
SLOT_JACKPOT_SEED = 250


def normalize_slots(slots=None):
    slots = slots or {}
    return {
        "jackpot": max(SLOT_JACKPOT_SEED, int(slots.get("jackpot", SLOT_JACKPOT_SEED) or SLOT_JACKPOT_SEED)),
        "spins": max(0, int(slots.get("spins", 0) or 0)),
    }


def new_room_state():
    return {
        "players": {},
        "events": [],
        "chat": [],
        "last_game": None,
        "poker_ready": {},
        "poker_ready_deadline": 0,
        "poker_hand": None,
        "race": None,
        "last_race": None,
        "slots": normalize_slots(),
    }


def public_slots(room):
    return normalize_slots(room.get("slots", {}))

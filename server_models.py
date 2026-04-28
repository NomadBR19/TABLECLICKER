ROOM_NAME = "table-reseau"
SLOT_JACKPOT_SEED = 250
SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807


def bounded_int(value, default=0, minimum=None, maximum=SQLITE_MAX_INTEGER):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        number = default
    if number != number or number in (float("inf"), float("-inf")):
        number = default
    integer = int(number)
    if minimum is not None:
        integer = max(minimum, integer)
    if maximum is not None:
        integer = min(maximum, integer)
    return integer


def bounded_float(value, default=0.0, minimum=None, maximum=None):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        number = default
    if number != number or number in (float("inf"), float("-inf")):
        number = default
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def normalize_slots(slots=None):
    slots = slots or {}
    return {
        "jackpot": bounded_int(slots.get("jackpot", SLOT_JACKPOT_SEED), SLOT_JACKPOT_SEED, SLOT_JACKPOT_SEED),
        "spins": bounded_int(slots.get("spins", 0), 0, 0),
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

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import json
import os
import random
import re
import socket
import threading
import time
import traceback

from server_games import (
    deck,
    evaluate_holdem,
    format_cards,
    resolve_slot_spin,
)
from server_models import ROOM_NAME, bounded_float, bounded_int, new_room_state, normalize_slots, public_slots
from server_store import SharedStateStore

ROOMS = {}
PLAYERS = {}
HOST_CACHE = {}
STALE_AFTER = 18
POKER_TURN_TIMEOUT = 75
POKER_READY_DELAY = 5
MAX_EVENTS = 70
BIG_WIN_THRESHOLD = 100000
MAX_JSON_BODY = 4096
PLAYER_ID_RE = re.compile(r"[^A-Za-z0-9_.:-]")
ALLOWED_ACTIONS = {
    "join",
    "chat",
    "game",
    "poker_ready",
    "poker_action",
    "poker",
    "race_create",
    "race_join",
    "race_start",
    "race_score",
    "race_wager",
    "slots_spin",
}
ALLOWED_EVENT_KINDS = {
    "event",
    "join",
    "chat",
    "game",
    "roulette",
    "blackjack",
    "machine",
    "slots",
    "poker",
    "race",
    "course",
    "announce",
    "bigwin",
    "jackpot",
}
ALLOWED_GAME_KINDS = {"roulette", "blackjack", "machine", "poker", "course"}
STATE_LOCK = threading.Lock()
STORE = SharedStateStore(os.path.join(os.path.dirname(__file__), "shared_state.sqlite3"))
STORE.initialize()


def safe_text(value, fallback, limit):
    text = str(value if value is not None else fallback)
    text = "".join(char if char.isprintable() else " " for char in text)
    text = " ".join(text.strip().split())[:limit]
    return text or fallback


def safe_player_id(value):
    text = safe_text(value, "anonymous", 80)
    text = PLAYER_ID_RE.sub("-", text)[:80].strip(".:-_")
    return text or "anonymous"


def safe_event_kind(value, fallback="event"):
    kind = safe_text(value, fallback, 18).lower()
    return kind if kind in ALLOWED_EVENT_KINDS else fallback


def safe_game_kind(value):
    game = safe_text(value, "game", 18).lower()
    return game if game in ALLOWED_GAME_KINDS else "game"


def host_name(ip):
    if ip in HOST_CACHE:
        return HOST_CACHE[ip]
    try:
        name = socket.gethostbyaddr(ip)[0]
    except OSError:
        name = ip
    HOST_CACHE[ip] = safe_text(name, ip, 80)
    return HOST_CACHE[ip]


def room_state(name=ROOM_NAME):
    name = ROOM_NAME if not name else name
    if name not in ROOMS:
        ROOMS[name] = new_room_state()
    room = ROOMS[name]
    room["slots"] = normalize_slots(room.get("slots", {}))
    return room


def load_persisted_state():
    for room_name, room_payload in STORE.load_rooms().items():
        room = ROOMS.setdefault(room_name, new_room_state())
        room["slots"] = normalize_slots(room_payload.get("slots", {}))
    for player_id, profile in STORE.load_player_profiles().items():
        PLAYERS.setdefault(player_id, {
            "id": player_id,
            "name": profile.get("name", "Joueur"),
            "chips": 0,
            "ip": "",
            "host": "",
            "room": ROOM_NAME,
            "seen": 0,
            "lastJackpot": profile.get("lastJackpot"),
        })


def record_player_jackpot(player, amount):
    player["lastJackpot"] = {
        "amount": bounded_int(amount, 0, 0),
        "at": time.time(),
    }


def resolve_slots_spin(room, player_id, player_name, amount):
    amount = bounded_int(amount, 0, 0)
    spin = resolve_slot_spin(normalize_slots(room.get("slots", {})), amount)
    room["slots"] = normalize_slots(spin["slots"])
    result = spin["result"]
    if result["jackpotPayout"]:
        player = room.get("players", {}).get(player_id)
        if player is not None:
            record_player_jackpot(player, result["jackpotPayout"])
        if player_id in PLAYERS:
            record_player_jackpot(PLAYERS[player_id], result["jackpotPayout"])
        add_event(room, f"{player_name} decroche le JACKPOT Golden Grid: {result['jackpotPayout']} jetons.", "jackpot")
        add_big_win(room, player_name, "machine", result["jackpotPayout"])
    STORE.save_room_slots(ROOM_NAME, room["slots"])
    STORE.save_player_profile(player_id, player_name, PLAYERS.get(player_id, {}).get("lastJackpot"))
    return {
        "grid": spin["grid"],
        "result": result,
        "slots": public_slots(room),
    }


def touch_player(player_id, name, chips, ip="", room=ROOM_NAME):
    ip = safe_text(ip, "local", 45)
    previous = PLAYERS.get(player_id, {})
    PLAYERS[player_id] = {
        "id": player_id,
        "name": name,
        "chips": chips,
        "ip": ip,
        "host": host_name(ip),
        "room": ROOM_NAME,
        "seen": time.time(),
        "lastJackpot": previous.get("lastJackpot"),
    }


def clean():
    now = time.time()
    stale_players = {pid for pid, p in PLAYERS.items() if now - p.get("seen", 0) >= STALE_AFTER}
    for pid in stale_players:
        PLAYERS.pop(pid, None)

    for room in ROOMS.values():
        room["players"] = {
            pid: p for pid, p in room["players"].items()
            if pid in PLAYERS and now - p.get("seen", 0) < STALE_AFTER
        }
        room["poker_ready"] = {
            pid: ready for pid, ready in room.get("poker_ready", {}).items()
            if pid in room["players"]
        }
        if len(room["poker_ready"]) < 2:
            room["poker_ready_deadline"] = 0
        elif not room.get("poker_hand") and room.get("poker_ready_deadline", 0) and now >= room["poker_ready_deadline"]:
            start_room_poker(room, do_clean=False)
        hand = room.get("poker_hand")
        if hand:
            dropped = [
                p for p in hand.get("players", [])
                if p.get("status") == "active" and p.get("id") not in room["players"]
            ]
            for player in dropped:
                player["status"] = "folded"
                player["acted"] = True
                add_event(room, f"{player['name']} est sorti de la main poker.", "poker")

            hand["players"] = [
                p for p in hand.get("players", [])
                if p.get("id") in room["players"] or p.get("status") == "folded"
            ]

            timed_out = [
                p for p in hand.get("players", [])
                if p.get("status") == "active"
                and not p.get("acted")
                and now - hand.get("phase_at", hand.get("at", now)) >= POKER_TURN_TIMEOUT
            ]
            for player in timed_out:
                player["status"] = "folded"
                player["acted"] = True
                add_event(room, f"{player['name']} se couche automatiquement apres inactivite.", "poker")

            active = [p for p in hand["players"] if p.get("status") == "active"]
            if not active:
                room["poker_hand"] = None
            elif dropped or timed_out:
                advance_poker_hand(room)
        race = room.get("race")
        if race:
            if race.get("status") == "lobby":
                race["players"] = {
                    pid: p for pid, p in race.get("players", {}).items()
                    if pid in room["players"]
                }
                if not race["players"]:
                    room["race"] = None
            elif race.get("status") == "running" and now >= race.get("ends_at", now):
                finish_race(room)
        room["events"] = room["events"][-MAX_EVENTS:]
        room["chat"] = room["chat"][-MAX_EVENTS:]


def public_players(current_id=""):
    clean()
    return sorted(
        [
            {
                "id": pid,
                "name": p["name"],
                "chips": p["chips"],
                "ip": p.get("ip", ""),
                "host": p.get("host", ""),
                "lastJackpot": p.get("lastJackpot"),
                "room": ROOM_NAME,
                "self": pid == current_id,
            }
            for pid, p in PLAYERS.items()
        ],
        key=lambda p: (not p["self"], p["name"].lower()),
    )


def add_event(room, text, kind="event"):
    room["events"].append({
        "at": time.time(),
        "text": safe_text(text, "", 220),
        "kind": safe_event_kind(kind),
    })
    room["events"] = room["events"][-MAX_EVENTS:]


def add_big_win(room, name, game, amount):
    if amount < BIG_WIN_THRESHOLD:
        return
    label = safe_game_kind(game)
    add_event(room, f"{name} gagne {amount} jetons sur {label}.", "bigwin")


def add_announcement(room, text):
    add_event(room, text, "announce")


def add_chat(room, player_id, name, text):
    room["chat"].append({
        "at": time.time(),
        "playerId": safe_player_id(player_id),
        "name": safe_text(name, "Joueur", 18),
        "text": safe_text(text, "", 180),
    })
    room["chat"] = room["chat"][-MAX_EVENTS:]


def start_room_poker(room, do_clean=True):
    if do_clean:
        clean()
    if room.get("poker_hand"):
        return None, "Une main de poker est deja en cours."
    ready = room.get("poker_ready", {})
    players = [(pid, room["players"][pid]) for pid in ready if pid in room["players"]]
    if len(players) < 2:
        return None, "Il faut au moins 2 joueurs prets pour lancer le poker."

    cards = deck()
    community = [cards.pop() for _ in range(5)]
    hand_players = []
    for pid, player in players:
        hand_players.append({
            "id": pid,
            "name": player["name"],
            "hand": [cards.pop(), cards.pop()],
            "bet": max(0, int(ready.get(pid, {}).get("amount", 0))),
            "status": "active",
            "acted": False,
        })

    hand = {
        "type": "poker_hand",
        "at": time.time(),
        "phase_at": time.time(),
        "phase": "preflop",
        "revealed": 0,
        "community": community,
        "players": hand_players,
    }
    room["poker_hand"] = hand
    room["poker_ready"] = {}
    room["poker_ready_deadline"] = 0
    add_announcement(room, f"Main de poker lancee avec {len(hand_players)} joueurs.")
    return hand, ""


def finish_poker_hand(room, reason="showdown"):
    hand = room.get("poker_hand")
    if not hand:
        return None, "Aucune main de poker en cours."

    active = [p for p in hand.get("players", []) if p.get("status") == "active"]
    if not active:
        room["poker_hand"] = None
        add_event(room, "Main de poker annulee: plus aucun joueur actif.", "poker")
        return None, ""
    if len(active) == 1:
        winner = active[0]
        winner_label = "dernier joueur en jeu"
        winner_detail = "Victoire: tous les autres joueurs se sont couches."
    else:
        scored = []
        for player in active:
            score = evaluate_holdem(player["hand"] + hand["community"])
            scored.append({**player, "score": score, "label": score[2]})
        scored.sort(key=lambda r: (r["score"][0], r["score"][1]), reverse=True)
        winner = scored[0]
        winner_label = winner["label"]
        winner_detail = f"Main montree: {winner_label}, cartes {format_cards(winner['hand'])}."

    payout = sum(max(0, int(player.get("bet", 0))) for player in hand.get("players", []))
    game = {
        "type": "poker",
        "at": time.time(),
        "startedAt": hand.get("at"),
        "community": hand["community"],
        "winnerId": winner["id"],
        "winnerName": winner["name"],
        "winnerLabel": winner_label,
        "winnerDetail": winner_detail,
        "payout": payout,
        "players": [
            {
                "id": player["id"],
                "name": player["name"],
                "hand": player["hand"],
                "bet": player["bet"],
                "status": player.get("status", "active"),
                "label": "Couche" if player.get("status") == "folded" else evaluate_holdem(player["hand"] + hand["community"])[2],
            }
            for player in hand.get("players", [])
        ],
        "reason": reason,
    }
    room["last_game"] = game
    room["poker_hand"] = None
    room["poker_ready"] = {}
    room["poker_ready_deadline"] = 0
    add_event(room, f"{winner['name']} remporte le poker: {winner_detail} ({payout} jetons).", "poker")
    add_big_win(room, winner["name"], "poker", payout)
    return game, ""


def advance_poker_hand(room):
    hand = room.get("poker_hand")
    if not hand:
        return None, "Aucune main de poker en cours."

    active = [p for p in hand.get("players", []) if p.get("status") == "active"]
    if len(active) <= 1:
        return finish_poker_hand(room, "fold")
    if not all(p.get("acted") for p in active):
        return None, ""

    phase = hand.get("phase", "preflop")
    if phase == "preflop":
        hand["phase"] = "flop"
        hand["phase_at"] = time.time()
        hand["revealed"] = 3
        add_event(room, "Poker: le flop est revele.", "poker")
    elif phase == "flop":
        hand["phase"] = "turn"
        hand["phase_at"] = time.time()
        hand["revealed"] = 4
        add_event(room, "Poker: la turn est revelee.", "poker")
    elif phase == "turn":
        hand["phase"] = "river"
        hand["phase_at"] = time.time()
        hand["revealed"] = 5
        add_event(room, "Poker: la river est revelee.", "poker")
    else:
        return finish_poker_hand(room, "showdown")

    for player in hand.get("players", []):
        if player.get("status") == "active":
            player["acted"] = False
    return None, ""


def poker_action(room, player_id, decision):
    hand = room.get("poker_hand")
    if not hand:
        return None, "Aucune main de poker en cours."
    player = next((p for p in hand.get("players", []) if p.get("id") == player_id), None)
    if not player or player.get("status") != "active":
        return None, "Tu ne participes pas a cette main."
    if decision == "fold":
        player["status"] = "folded"
        player["acted"] = True
        add_event(room, f"{player['name']} se couche.", "poker")
    elif decision == "stay":
        player["acted"] = True
        add_event(room, f"{player['name']} reste dans la main.", "poker")
    else:
        return None, "Action poker inconnue."
    return advance_poker_hand(room)


def public_poker_hand(room, current_id=""):
    hand = room.get("poker_hand")
    if not hand:
        return None
    return {
        "type": "poker_hand",
        "at": hand.get("at"),
        "phase": hand.get("phase", "preflop"),
        "revealed": hand.get("revealed", 0),
        "community": hand.get("community", [])[:hand.get("revealed", 0)],
        "pot": sum(max(0, int(p.get("bet", 0))) for p in hand.get("players", [])),
        "players": [
            {
                "id": player["id"],
                "name": player["name"],
                "bet": player.get("bet", 0),
                "status": player.get("status", "active"),
                "acted": player.get("acted", False),
                "self": player["id"] == current_id,
                "hand": player.get("hand", []) if player["id"] == current_id else [],
            }
            for player in hand.get("players", [])
        ],
    }


def create_race(room, player_id, name, duration, amount=0, chips=0):
    clean()
    if room.get("race"):
        return None, "Une course est deja ouverte."
    duration = max(60, min(3600, int(duration or 60)))
    duration = max(60, min(3600, round(duration / 60) * 60))
    amount = bounded_int(amount, 0, 0)
    if amount > chips:
        return None, "Mise course impossible."
    race = {
        "id": f"race-{int(time.time() * 1000)}-{random.randint(1000, 9999)}",
        "hostId": player_id,
        "hostName": name,
        "duration": duration,
        "status": "lobby",
        "createdAt": time.time(),
        "startedAt": 0,
        "ends_at": 0,
        "players": {},
        "wagers": {},
    }
    room["race"] = race
    add_announcement(room, f"{name} ouvre une course de {max(1, duration // 60)} min.")
    if amount > 0:
        race["players"][player_id] = {
            "id": player_id,
            "name": name,
            "bet": amount,
            "score": 0,
            "seen": time.time(),
        }
        add_event(room, f"{name} rejoint la course ({amount} jetons).", "race")
    return race, ""


def join_race(room, player_id, name, amount, chips):
    race = room.get("race")
    if not race:
        return None, "Aucune course ouverte."
    if race.get("status") != "lobby":
        return None, "La course a deja commence."
    if amount <= 0:
        race.get("players", {}).pop(player_id, None)
        add_event(room, f"{name} quitte la course.", "race")
        return race, ""
    if amount > chips:
        return None, "Mise course impossible."
    race.setdefault("players", {})[player_id] = {
        "id": player_id,
        "name": name,
        "bet": amount,
        "score": 0,
        "seen": time.time(),
    }
    add_event(room, f"{name} rejoint la course ({amount} jetons).", "race")
    return race, ""


def start_race(room, player_id):
    race = room.get("race")
    if not race:
        return None, "Aucune course ouverte."
    if race.get("hostId") != player_id:
        return None, "Seul l'initiateur peut lancer la course."
    if race.get("status") != "lobby":
        return None, "La course a deja commence."
    if len(race.get("players", {})) < 2:
        return None, "Il faut au moins 2 joueurs pour lancer la course."
    now = time.time()
    for pid, race_player in race.get("players", {}).items():
        current_chips = bounded_int(room.get("players", {}).get(pid, {}).get("chips", race_player.get("bet", 0)), 0, 0)
        bet = bounded_int(race_player.get("bet", 0), 0, 0)
        if bet <= 0:
            return None, f"{race_player.get('name', 'Un joueur')} n'a pas de mise valide."
        if bet > current_chips:
            return None, f"{race_player.get('name', 'Un joueur')} n'a plus assez de jetons pour sa mise."
    race["status"] = "running"
    race["startedAt"] = now
    race["ends_at"] = now + race.get("duration", 60)
    for player in race.get("players", {}).values():
        player["score"] = 0
        player["seen"] = now
    add_event(room, f"La course demarre pour {max(1, int(race.get('duration', 60)) // 60)} min.", "race")
    return race, ""


def update_race_score(room, player_id, score):
    race = room.get("race")
    if not race or race.get("status") != "running":
        return None, ""
    player = race.get("players", {}).get(player_id)
    if not player:
        return race, ""
    player["score"] = max(player.get("score", 0), bounded_float(score, 0, 0))
    player["seen"] = time.time()
    if time.time() >= race.get("ends_at", time.time()):
        finish_race(room)
    return room.get("race"), ""


def race_betting_deadline(race):
    return race.get("startedAt", 0) + max(15, race.get("duration", 60) / 4)


def place_race_wager(room, player_id, name, target_id, amount, chips):
    race = room.get("race")
    if not race:
        return None, "Aucune course ouverte."
    if race.get("status") != "running":
        return None, "Les paris ouvrent au depart de la course."
    if player_id in race.get("players", {}):
        return None, "Les coureurs ne peuvent pas parier."
    if player_id in race.get("wagers", {}):
        return None, "Tu as deja parie sur cette course."
    now = time.time()
    if now > race_betting_deadline(race):
        return None, "Les paris sont fermes."
    amount = bounded_int(amount, 0, 0)
    if amount <= 0 or amount > chips:
        return None, "Mise pari impossible."
    target = race.get("players", {}).get(target_id)
    if not target:
        return None, "Coureur introuvable."
    race.setdefault("wagers", {})[player_id] = {
        "id": player_id,
        "name": name,
        "targetId": target_id,
        "targetName": target.get("name", "Joueur"),
        "amount": amount,
        "seen": now,
    }
    add_event(room, f"{name} parie {amount} jetons sur {target.get('name', 'Joueur')}.", "race")
    return race, ""


def finish_race(room):
    race = room.get("race")
    if not race or race.get("status") != "running":
        return None, ""
    players = list(race.get("players", {}).values())
    if not players:
        room["race"] = None
        add_event(room, "Course annulee: aucun participant.", "race")
        return None, ""
    players.sort(key=lambda p: (p.get("score", 0), p.get("bet", 0)), reverse=True)
    winner = players[0]
    payout = sum(max(0, int(p.get("bet", 0))) for p in players)
    wagers = list(race.get("wagers", {}).values())
    wager_pot = sum(max(0, int(w.get("amount", 0))) for w in wagers)
    winning_wagers = [w for w in wagers if w.get("targetId") == winner["id"]]
    winning_wager_total = sum(max(0, int(w.get("amount", 0))) for w in winning_wagers)
    wager_payouts = []
    for wager in wagers:
        amount = max(0, int(wager.get("amount", 0)))
        won = wager.get("targetId") == winner["id"] and winning_wager_total > 0
        wager_payouts.append({
            "id": wager["id"],
            "name": wager.get("name", "Joueur"),
            "targetId": wager.get("targetId"),
            "targetName": wager.get("targetName", "Joueur"),
            "amount": amount,
            "payout": int(wager_pot * amount / winning_wager_total) if won else 0,
        })
    result = {
        "type": "race",
        "id": race["id"],
        "at": time.time(),
        "winnerId": winner["id"],
        "winnerName": winner["name"],
        "payout": payout,
        "wagerPot": wager_pot,
        "wagerPayouts": wager_payouts,
        "duration": race.get("duration", 60),
        "players": [
            {
                "id": p["id"],
                "name": p["name"],
                "bet": p.get("bet", 0),
                "score": p.get("score", 0),
            }
            for p in players
        ],
    }
    room["last_race"] = result
    room["race"] = None
    STORE.record_race_result(ROOM_NAME, result)
    add_event(room, f"{winner['name']} gagne la course avec {int(winner.get('score', 0))} points ({payout} jetons).", "race")
    if wager_pot and winning_wager_total > 0:
        add_event(room, f"Paris course: {wager_pot} jetons repartis sur les bons pronostics.", "race")
    elif wager_pot:
        add_event(room, f"Paris course: aucun bon pronostic sur {winner['name']}.", "race")
    add_big_win(room, winner["name"], "course", payout)
    return result, ""


def public_race(room, current_id=""):
    race = room.get("race")
    if not race:
        return None
    now = time.time()
    betting_deadline = race_betting_deadline(race) if race.get("status") == "running" else 0
    wagers = list(race.get("wagers", {}).values())
    return {
        "id": race["id"],
        "hostId": race.get("hostId"),
        "hostName": race.get("hostName"),
        "duration": race.get("duration", 60),
        "status": race.get("status", "lobby"),
        "remaining": max(0, race.get("ends_at", now) - now) if race.get("status") == "running" else race.get("duration", 60),
        "bettingOpen": race.get("status") == "running" and now <= betting_deadline,
        "bettingRemaining": max(0, betting_deadline - now) if race.get("status") == "running" else 0,
        "wagerPot": sum(max(0, int(w.get("amount", 0))) for w in wagers),
        "myWager": next(({
            "targetId": w.get("targetId"),
            "targetName": w.get("targetName", "Joueur"),
            "amount": w.get("amount", 0),
        } for w in wagers if w.get("id") == current_id), None),
        "wagersByTarget": [
            {
                "targetId": pid,
                "targetName": player.get("name", "Joueur"),
                "amount": sum(max(0, int(w.get("amount", 0))) for w in wagers if w.get("targetId") == pid),
            }
            for pid, player in race.get("players", {}).items()
        ],
        "players": [
            {
                "id": pid,
                "name": player.get("name", "Joueur"),
                "bet": player.get("bet", 0),
                "score": player.get("score", 0),
                "self": pid == current_id,
                "participant": True,
                "host": pid == race.get("hostId"),
            }
            for pid, player in race.get("players", {}).items()
        ],
    }


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        try:
            super().log_message(format, *args)
        except OSError:
            pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_JSON_BODY:
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/state", "/api/lobby"}:
            return super().do_GET()

        query = parse_qs(parsed.query)
        room_name = ROOM_NAME
        client_ip = self.client_address[0]
        player_id = safe_player_id(query.get("playerId", ["anonymous"])[0])
        player_name = safe_text(query.get("name", ["Joueur"])[0], "Joueur", 18)
        chips = bounded_int(query.get("chips", ["0"])[0], 0, 0)
        touch_player(player_id, player_name, chips, client_ip, ROOM_NAME)

        if parsed.path == "/api/lobby":
            clean()
            return self.send_json({
                "players": public_players(player_id),
            })

        room = room_state()
        room["players"][player_id] = {
            "name": player_name,
            "chips": chips,
            "seen": time.time(),
            "lastJackpot": PLAYERS.get(player_id, {}).get("lastJackpot"),
        }
        clean()
        ready_players = room.get("poker_ready", {})
        poker_deadline = room.get("poker_ready_deadline", 0)
        self.send_json({
            "room": ROOM_NAME,
            "players": sorted(
                [
                    {
                        "id": pid,
                        "name": p["name"],
                        "chips": p["chips"],
                        "self": pid == player_id,
                        "pokerReady": pid in ready_players,
                        "lastJackpot": p.get("lastJackpot"),
                    }
                    for pid, p in room["players"].items()
                ],
                key=lambda p: p["chips"],
                reverse=True,
            ),
            "events": room["events"][-25:],
            "chat": room["chat"][-35:],
            "lastGame": room.get("last_game"),
            "pokerHand": public_poker_hand(room, player_id),
            "race": public_race(room, player_id),
            "raceLeaderboard": [
                {**entry, "self": entry["id"] == player_id}
                for entry in STORE.load_race_leaderboard(ROOM_NAME)
            ],
            "slots": public_slots(room),
            "lastRace": room.get("last_race"),
            "pokerReady": [
                {
                    "id": pid,
                    "name": ready.get("name", "Joueur"),
                    "amount": ready.get("amount", 0),
                    "self": pid == player_id,
                }
                for pid, ready in ready_players.items()
            ],
            "pokerReadyDeadline": poker_deadline,
            "lobby": public_players(player_id),
        })

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/action":
            return self.send_json({"error": "not found"}, 404)

        payload = self.read_json()
        if payload is None:
            return self.send_json({"error": "bad json"}, 400)

        room_name = ROOM_NAME
        player_id = safe_player_id(payload.get("playerId", "anonymous"))
        name = safe_text(payload.get("name", "Joueur"), "Joueur", 18)
        chips = bounded_int(payload.get("chips", 0), 0, 0)
        action = payload.get("action", {})
        if not isinstance(action, dict):
            return self.send_json({"ok": False, "error": "Action invalide."}, 400)
        action_type = action.get("type")
        if action_type not in ALLOWED_ACTIONS:
            return self.send_json({"ok": False, "error": "Action inconnue."}, 400)

        touch_player(player_id, name, chips, self.client_address[0], ROOM_NAME)
        room = room_state()
        player = room["players"].setdefault(
            player_id,
            {"name": name, "chips": chips, "seen": time.time(), "lastJackpot": PLAYERS.get(player_id, {}).get("lastJackpot")},
        )
        player.update({"name": name, "chips": chips, "seen": time.time(), "lastJackpot": player.get("lastJackpot") or PLAYERS.get(player_id, {}).get("lastJackpot")})

        amount = bounded_int(action.get("amount", 0), 0, 0)
        if action_type == "join":
            add_event(room, f"{name} rejoint la table.", "join")
        elif action_type == "chat":
            text = safe_text(action.get("text", ""), "", 180)
            if text:
                add_chat(room, player_id, name, text)
        elif action_type == "game":
            game = safe_game_kind(action.get("game", "game"))
            result = safe_text(action.get("result", ""), "", 120)
            win_amount = bounded_int(action.get("amount", 0), 0, 0)
            if result:
                add_event(room, f"{name} joue {game}: {result}", game)
                add_big_win(room, name, game, win_amount)
        elif action_type == "poker_ready":
            if amount <= 0:
                room["poker_ready"].pop(player_id, None)
                if len(room["poker_ready"]) < 2:
                    room["poker_ready_deadline"] = 0
                add_event(room, f"{name} quitte la liste poker.", "poker")
            elif amount > chips:
                return self.send_json({"ok": False, "error": "Mise poker impossible."}, 409)
            else:
                first_poker_ready = not room["poker_ready"]
                room["poker_ready"][player_id] = {"name": name, "amount": amount, "at": time.time()}
                if first_poker_ready:
                    add_announcement(room, f"{name} ouvre un poker ({amount} jetons).")
                else:
                    add_event(room, f"{name} est pret pour le poker ({amount} jetons).", "poker")
                if len(room["poker_ready"]) >= 2 and not room.get("poker_ready_deadline", 0):
                    room["poker_ready_deadline"] = time.time() + POKER_READY_DELAY
                    add_announcement(room, "Poker: depart dans 5 secondes.")
            clean()
            return self.send_json({
                "ok": True,
                "pokerHand": public_poker_hand(room, player_id),
                "pokerReadyDeadline": room.get("poker_ready_deadline", 0),
            })
        elif action_type == "poker_action":
            game, error = poker_action(room, player_id, safe_text(action.get("decision", ""), "", 12))
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            clean()
            return self.send_json({
                "ok": True,
                "game": game,
                "pokerHand": public_poker_hand(room, player_id),
            })
        elif action_type == "poker":
            hand, error = start_room_poker(room)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            clean()
            return self.send_json({"ok": True, "pokerHand": public_poker_hand(room, player_id)})
        elif action_type == "race_create":
            try:
                duration = bounded_int(action.get("duration", 60), 60, 60, 3600)
                race, error = create_race(room, player_id, name, duration, amount, chips)
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Course indisponible: {exc}"}, 500)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_join":
            try:
                race, error = join_race(room, player_id, name, amount, chips)
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Course indisponible: {exc}"}, 500)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_start":
            try:
                race, error = start_race(room, player_id)
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Course indisponible: {exc}"}, 500)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_score":
            try:
                race, error = update_race_score(room, player_id, bounded_float(action.get("score", 0), 0, 0))
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Course indisponible: {exc}"}, 500)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id), "lastRace": room.get("last_race")})
        elif action_type == "race_wager":
            target_id = safe_player_id(action.get("targetId", ""))
            try:
                race, error = place_race_wager(room, player_id, name, target_id, amount, chips)
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Course indisponible: {exc}"}, 500)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "slots_spin":
            if amount <= 0 or amount > chips:
                return self.send_json({"ok": False, "error": "Mise machine impossible."}, 409)
            try:
                with STATE_LOCK:
                    result = resolve_slots_spin(room, player_id, name, amount)
            except Exception as exc:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": f"Machine indisponible: {exc}"}, 500)
            return self.send_json({"ok": True, **result})

        clean()
        self.send_json({"ok": True})


if __name__ == "__main__":
    host = "0.0.0.0"
    port = 8000
    load_persisted_state()
    print(f"Table Clicker disponible sur http://localhost:{port}")
    print("Depuis le reseau local: http://ADRESSE_IP_DE_CE_PC:8000")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

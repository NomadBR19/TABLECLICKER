from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import itertools
import json
import random
import socket
import time

ROOM_NAME = "table-reseau"
ROOMS = {}
PLAYERS = {}
HOST_CACHE = {}
STALE_AFTER = 18
POKER_TURN_TIMEOUT = 75
POKER_READY_DELAY = 5
MAX_EVENTS = 70
BIG_WIN_THRESHOLD = 100000
SUITS = ["S", "H", "D", "C"]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


def safe_text(value, fallback, limit):
    text = str(value or fallback).strip()[:limit]
    return text or fallback


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
    name = ROOM_NAME
    if name not in ROOMS:
        ROOMS[name] = {"players": {}, "events": [], "chat": [], "last_game": None, "poker_ready": {}, "poker_ready_deadline": 0, "poker_hand": None, "race": None, "last_race": None}
    return ROOMS[name]


def touch_player(player_id, name, chips, ip="", room=ROOM_NAME):
    ip = safe_text(ip, "local", 45)
    PLAYERS[player_id] = {
        "id": player_id,
        "name": name,
        "chips": chips,
        "ip": ip,
        "host": host_name(ip),
        "room": ROOM_NAME,
        "seen": time.time(),
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
                "room": ROOM_NAME,
                "self": pid == current_id,
            }
            for pid, p in PLAYERS.items()
        ],
        key=lambda p: (not p["self"], p["name"].lower()),
    )


def add_event(room, text, kind="event"):
    room["events"].append({"at": time.time(), "text": text, "kind": kind})
    room["events"] = room["events"][-MAX_EVENTS:]


def add_big_win(room, name, game, amount):
    if amount < BIG_WIN_THRESHOLD:
        return
    label = safe_text(game, "jeu", 18)
    add_event(room, f"{name} gagne {amount} jetons sur {label}.", "bigwin")


def add_announcement(room, text):
    add_event(room, text, "announce")


def add_chat(room, player_id, name, text):
    room["chat"].append({
        "at": time.time(),
        "playerId": player_id,
        "name": name,
        "text": safe_text(text, "", 180),
    })
    room["chat"] = room["chat"][-MAX_EVENTS:]


def deck():
    cards = [{"rank": rank, "suit": suit} for suit in SUITS for rank in RANKS]
    random.shuffle(cards)
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
    counts = sorted(
        ((values.count(value), value) for value in set(values)),
        reverse=True,
    )
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
    amount = max(0, int(amount or 0))
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
        add_event(room, f"{name} rejoint la course (all-in au depart).", "race")
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
    add_event(room, f"{name} rejoint la course (all-in au depart).", "race")
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
        current_chips = max(0, int(room.get("players", {}).get(pid, {}).get("chips", race_player.get("bet", 0)) or 0))
        if current_chips <= 0:
            return None, f"{race_player.get('name', 'Un joueur')} n'a pas de jetons a miser."
        race_player["bet"] = current_chips
    race["status"] = "running"
    race["startedAt"] = now
    race["ends_at"] = now + race.get("duration", 60)
    for player in race.get("players", {}).values():
        player["score"] = 0
        player["seen"] = now
    add_event(room, f"La course demarre pour {max(1, int(race.get('duration', 60)) // 60)} min. Tout le monde est all-in.", "race")
    return race, ""


def update_race_score(room, player_id, score):
    race = room.get("race")
    if not race or race.get("status") != "running":
        return None, ""
    player = race.get("players", {}).get(player_id)
    if not player:
        return race, ""
    player["score"] = max(player.get("score", 0), float(score or 0))
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
    amount = max(0, int(amount or 0))
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
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/state", "/api/lobby"}:
            return super().do_GET()

        query = parse_qs(parsed.query)
        room_name = ROOM_NAME
        client_ip = self.client_address[0]
        player_id = safe_text(query.get("playerId", ["anonymous"])[0], "anonymous", 80)
        player_name = safe_text(query.get("name", ["Joueur"])[0], "Joueur", 18)
        chips = int(float(query.get("chips", ["0"])[0] or 0))
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
        player_id = safe_text(payload.get("playerId", "anonymous"), "anonymous", 80)
        name = safe_text(payload.get("name", "Joueur"), "Joueur", 18)
        chips = int(float(payload.get("chips", 0) or 0))
        action = payload.get("action", {})
        action_type = action.get("type")

        touch_player(player_id, name, chips, self.client_address[0], ROOM_NAME)
        room = room_state()
        player = room["players"].setdefault(
            player_id,
            {"name": name, "chips": chips, "seen": time.time()},
        )
        player.update({"name": name, "chips": chips, "seen": time.time()})

        amount = max(0, int(float(action.get("amount", 0) or 0)))
        if action_type == "join":
            add_event(room, f"{name} rejoint la table.", "join")
        elif action_type == "chat":
            text = safe_text(action.get("text", ""), "", 180)
            if text:
                add_chat(room, player_id, name, text)
        elif action_type == "game":
            game = safe_text(action.get("game", "jeu"), "jeu", 18)
            result = safe_text(action.get("result", ""), "", 120)
            win_amount = max(0, int(float(action.get("amount", 0) or 0)))
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
            race, error = create_race(room, player_id, name, int(float(action.get("duration", 60) or 60)), amount, chips)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_join":
            race, error = join_race(room, player_id, name, amount, chips)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_start":
            race, error = start_race(room, player_id)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})
        elif action_type == "race_score":
            race, error = update_race_score(room, player_id, float(action.get("score", 0) or 0))
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id), "lastRace": room.get("last_race")})
        elif action_type == "race_wager":
            target_id = safe_text(action.get("targetId", ""), "", 100)
            race, error = place_race_wager(room, player_id, name, target_id, amount, chips)
            if error:
                return self.send_json({"ok": False, "error": error}, 409)
            return self.send_json({"ok": True, "race": public_race(room, player_id)})

        clean()
        self.send_json({"ok": True})


if __name__ == "__main__":
    host = "0.0.0.0"
    port = 8000
    print(f"Table Clicker disponible sur http://localhost:{port}")
    print("Depuis le reseau local: http://ADRESSE_IP_DE_CE_PC:8000")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

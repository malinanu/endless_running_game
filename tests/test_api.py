import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def register(client, username="SantaClaus", password="hohoho123"):
    return client.post("/api/auth/register", json={"username": username, "password": password})


def test_register_logs_in(client):
    r = register(client)
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "SantaClaus"
    assert client.get("/api/auth/me").json() == {"authenticated": True, "id": 1, "username": "SantaClaus"}


def test_register_duplicate_is_case_insensitive(client):
    register(client)
    assert register(client, username="santaclaus").status_code == 409


@pytest.mark.parametrize("username,password", [("ab", "hohoho123"), ("bad name!", "hohoho123"), ("Rudolph", "123")])
def test_register_validation(client, username, password):
    assert register(client, username, password).status_code == 422


def test_login_logout(client):
    register(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json() == {"authenticated": False}

    assert client.post("/api/auth/login", json={"username": "SantaClaus", "password": "wrong!!"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "nobody", "password": "wrong!!"}).status_code == 401

    r = client.post("/api/auth/login", json={"username": "santaclaus", "password": "hohoho123"})
    assert r.status_code == 200
    assert r.json()["user"] == {"id": 1, "username": "SantaClaus"}
    assert client.get("/api/auth/me").json()["authenticated"] is True


def test_scores_require_session(client):
    assert client.post("/api/scores", json={"score": 100}).status_code == 401


@pytest.mark.parametrize("score", [0, -5, 1.5, "100", 10_000_001])
def test_scores_validation(client, score):
    register(client)
    assert client.post("/api/scores", json={"score": score}).status_code == 422


def test_personal_best(client):
    register(client)
    assert client.post("/api/scores", json={"score": 1850}).json() == {"success": True, "personalBest": 1850}
    assert client.post("/api/scores", json={"score": 1420}).json() == {"success": True, "personalBest": 1850}


def test_leaderboard(client):
    players = {"Frosty": [5200, 100], "Rudolph": [4890], "Blitzen": [4120, 4000], "ElfOnShelf": [3800]}
    for name, scores in players.items():
        register(client, name)
        for s in scores:
            client.post("/api/scores", json={"score": s})
        client.post("/api/auth/logout")

    board = client.get("/api/leaderboard").json()
    assert board == [
        {"rank": 1, "username": "Frosty", "score": 5200},
        {"rank": 2, "username": "Rudolph", "score": 4890},
        {"rank": 3, "username": "Blitzen", "score": 4120},
        {"rank": 4, "username": "ElfOnShelf", "score": 3800},
    ]
    assert len(client.get("/api/leaderboard?limit=2").json()) == 2
    assert client.get("/api/leaderboard?limit=0").status_code == 422


def test_index_and_static(client):
    assert "Christmas" in client.get("/").text
    assert client.get("/js/game.js").status_code == 200

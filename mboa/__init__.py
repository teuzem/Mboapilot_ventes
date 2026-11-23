# -*- coding: utf-8 -*-
"""MboaPilot V2 — application Flask (fabrique, sécurité globale, serving SPA)."""
import hmac
import os
import secrets
import time
from datetime import timedelta

from flask import Flask, abort, jsonify, request, send_from_directory, session

from .core import (DIST, DEMO, LOGOS_DIR, MAX_UPLOAD, SESSION_MAX_HEURES,
                   SESSION_MINUTES, db, init_app, migrate)


def _secret_key():
    p = DIST.parent.parent / ".mboa_secret"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    s = secrets.token_hex(32)
    try:
        p.write_text(s, encoding="utf-8")
    except Exception:
        pass
    return s


def create_app():
    app = Flask(__name__, static_folder=None)
    app.secret_key = os.environ.get("MBOA_SECRET") or _secret_key()
    app.config.update(
        SESSION_COOKIE_NAME="mboa_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("MBOA_COOKIE_SECURE", "0") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=SESSION_MINUTES),
        MAX_CONTENT_LENGTH=MAX_UPLOAD,
    )
    try:
        app.json.ensure_ascii = False
    except Exception:
        pass
    init_app(app)
    migrate()

    from .auth import bp as auth_bp
    from .dashboard import bp as dashboard_bp
    from .imports_studio import bp as imports_bp
    from .operations import bp as operations_bp
    from .partners import bp as partners_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(imports_bp)
    app.register_blueprint(operations_bp)
    app.register_blueprint(partners_bp)

    @app.before_request
    def garde_session_csrf():
        # 1) Expiration de session (inactivité + absolue + version).
        if request.path.startswith("/api/") and session.get("user"):
            maintenant = time.time()
            demarree = session.get("started", maintenant)
            derniere = session.get("last_seen", maintenant)
            expiree = (maintenant - derniere > SESSION_MINUTES * 60
                       or maintenant - demarree > SESSION_MAX_HEURES * 3600)
            if expiree:
                session.clear()
                return jsonify({"message": "Session expirée pour inactivité. Reconnectez-vous.",
                                "code": "session"}), 401
            try:
                u = db().execute("SELECT actif, session_version, role FROM users WHERE login=?",
                                 (session["user"],)).fetchone()
                if (not u or not u["actif"]
                        or int(u["session_version"] or 1) != int(session.get("sv", 1))):
                    session.clear()
                    return jsonify({"message": "Session invalidée. Reconnectez-vous.",
                                    "code": "session"}), 401
            except Exception:
                pass
            session["last_seen"] = maintenant
            session.modified = True

        # 2) Protection CSRF sur toutes les écritures API.
        if (request.path.startswith("/api/")
                and request.method in ("POST", "PUT", "PATCH", "DELETE")):
            if request.path.rstrip("/") == "/api/auth/csrf":
                return None
            jeton = request.headers.get("X-CSRF-Token", "")
            attendu = session.get("csrf", "")
            if not jeton or not attendu or not hmac.compare_digest(jeton, attendu):
                return jsonify({"message": "Jeton CSRF invalide ou expiré. Rechargez la page.",
                                "code": "csrf"}), 400
        return None

    @app.after_request
    def entetes_securite(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; "
            "connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; "
            "frame-ancestors 'none'; form-action 'self'")
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store, max-age=0"
        if request.is_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return resp

    @app.errorhandler(413)
    def trop_gros(_e):
        return jsonify({"message": "Fichier trop volumineux (limite 24 Mo).", "code": "too_large"}), 413

    @app.errorhandler(404)
    def pas_trouve(_e):
        if request.path.startswith("/api/"):
            return jsonify({"message": "Ressource introuvable.", "code": "not_found"}), 404
        return _spa("")

    @app.errorhandler(500)
    def erreur(_e):
        if request.path.startswith("/api/"):
            return jsonify({"message": "Erreur interne. L'incident est journalisé.", "code": "server"}), 500
        return "Erreur serveur", 500

    @app.route("/api/health")
    def health():
        try:
            n = db().execute("SELECT COUNT(*) c FROM sales").fetchone()["c"]
        except Exception:
            n = 0
        return jsonify({"ok": True, "service": "mboapilot", "version": "2.0",
                        "lignes": n, "demo": DEMO})

    @app.route("/media/logos/<path:filename>")
    def media_logo(filename):
        return send_from_directory(LOGOS_DIR, filename, max_age=600)

    @app.route("/assets/<path:filename>")
    def spa_assets(filename):
        return send_from_directory(DIST / "assets", filename)

    @app.route("/img/<path:filename>")
    def spa_img(filename):
        return send_from_directory(DIST / "img", filename)

    @app.route("/logo.svg")
    def spa_logo():
        return send_from_directory(DIST, "logo.svg")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def _spa(path):
        if path.startswith("api/"):
            abort(404)
        if path and (DIST / path).is_file():
            return send_from_directory(DIST, path)
        index = DIST / "index.html"
        if index.is_file():
            return send_from_directory(DIST, "index.html")
        return ("Frontend non construit. Exécutez BUILD_FRONT.bat.", 503)

    return app

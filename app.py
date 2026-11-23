# -*- coding: utf-8 -*-
"""MboaPilot V2 — point d'entrée Flask.

L'application est assemblée par la fabrique `mboa.create_app()` (package mboa/).
Lancement : python app.py -> http://127.0.0.1:5000
Frontend : frontend/dist (build via BUILD_FRONT.bat).
"""
import os

from mboa import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("MBOA_PORT", "5000"))
    debug = os.environ.get("MBOA_DEBUG", "0") == "1"
    print(f"MboaPilot V2 : http://127.0.0.1:{port}")
    app.run(debug=debug, port=port, threaded=True)

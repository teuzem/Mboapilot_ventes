# -*- coding: utf-8 -*-
"""MboaPilot V2 — point d'entrée Flask.

L'application est assemblée par la fabrique `mboa.create_app()` (package mboa/).
Lancement : python app.py -> http://127.0.0.1:5000
Frontend : frontend/dist (build via BUILD_FRONT.bat).
"""
from mboa import create_app
from mboa.config import DEBUG, PORT

app = create_app()

if __name__ == "__main__":
    print(f"MboaPilot V2 : http://127.0.0.1:{PORT}")
    app.run(debug=DEBUG, port=PORT, threaded=True)

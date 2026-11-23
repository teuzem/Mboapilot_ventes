@echo off
REM MboaPilot V2 - lancement (le frontend React est pre-construit dans frontend\dist)
cd /d "%~dp0"
python -c "import flask, pyotp, qrcode, openpyxl, xlrd" 2>nul || pip install -r requirements.txt
python app.py
pause

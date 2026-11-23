# -*- coding: utf-8 -*-
"""Connexion réelle à Microsoft Excel installé sur le poste, via COM Automation.

Ce module parle à EXCEL.EXE au travers de win32com. Si une instance d'Excel est
déjà ouverte, on s'y rattache. Sinon on en lance une visible. Toutes les feuilles
ouvertes sont énumérées et lisibles.
"""
import threading
import time

from .config import BASE

_VERROU = threading.RLock()
_APP = None
_DERNIERE_ERREUR = ""


def _com():
    import pythoncom
    pythoncom.CoInitialize()


def _liberer():
    import pythoncom
    pythoncom.CoUninitialize()


def _application(visible=True):
    """Retourne l'instance Excel, en s'attachant à une instance existante."""
    global _APP, _DERNIERE_ERREUR
    import win32com.client as win32
    if _APP is not None:
        try:
            _APP.Version
            return _APP
        except Exception:
            _APP = None
    try:
        _APP = win32.GetActiveObject("Excel.Application")
    except Exception:
        _APP = win32.DispatchEx("Excel.Application")
    _APP.Visible = bool(visible)
    _APP.DisplayAlerts = False
    _APP.ScreenUpdating = True
    _DERNIERE_ERREUR = ""
    return _APP


def _instance_active():
    """S'attache à une instance déjà ouverte, sans jamais en lancer une."""
    global _APP
    import win32com.client as win32
    if _APP is not None:
        try:
            _APP.Version
            return _APP
        except Exception:
            _APP = None
    try:
        _APP = win32.GetActiveObject("Excel.Application")
        return _APP
    except Exception:
        return None


def connecter():
    """Ouvre Microsoft Excel de façon visible et s'y attache."""
    global _APP, _DERNIERE_ERREUR
    with _VERROU:
        _com()
        try:
            app = _instance_active()
            if app is None:
                _APP = _application(visible=True)
            else:
                app.Visible = True
            version = str(_APP.Version)
            return {"ok": True, "installe": True, "version": version,
                    "message": "Microsoft Excel est ouvert."}
        except Exception as exc:
            _DERNIERE_ERREUR = str(exc)[:400]
            return {"ok": False, "message": _DERNIERE_ERREUR}
        finally:
            _liberer()


def statut():
    global _DERNIERE_ERREUR
    with _VERROU:
        _com()
        try:
            app = _instance_active()
            if app is None:
                return {"installe": True, "version": "", "connecte": False,
                        "classeurs": [], "erreur": ""}
            version = str(app.Version)
            classeurs = []
            for i in range(1, app.Workbooks.Count + 1):
                wb = app.Workbooks.Item(i)
                classeurs.append({"nom": wb.Name, "chemin": wb.FullName})
            return {"installe": True, "version": version,
                    "connecte": True, "classeurs": classeurs,
                    "erreur": ""}
        except Exception as exc:
            _DERNIERE_ERREUR = str(exc)[:400]
            return {"installe": True, "version": "", "connecte": False,
                    "classeurs": [], "erreur": _DERNIERE_ERREUR}
        finally:
            _liberer()


def classeurs_ouverts():
    with _VERROU:
        _com()
        try:
            app = _instance_active()
            if app is None:
                return {"classeurs": [], "actif": None, "erreur": ""}
            sortie = []
            actif = None
            try:
                actif = app.ActiveWorkbook.Name
            except Exception:
                pass
            for i in range(1, app.Workbooks.Count + 1):
                wb = app.Workbooks.Item(i)
                feuilles = []
                for j in range(1, wb.Worksheets.Count + 1):
                    ws = wb.Worksheets.Item(j)
                    feuilles.append({"nom": ws.Name, "visible": bool(ws.Visible)})
                sortie.append({"nom": wb.Name, "chemin": wb.FullName,
                               "feuilles": feuilles, "actif": wb.Name == actif})
            return {"classeurs": sortie, "actif": actif, "erreur": ""}
        except Exception as exc:
            return {"classeurs": [], "actif": None, "erreur": str(exc)[:400]}
        finally:
            _liberer()


def ouvrir_classeur(chemin):
    import os
    with _VERROU:
        _com()
        try:
            chemin = os.path.abspath(str(chemin))
            if not os.path.isfile(chemin):
                return {"ok": False, "message": "Fichier introuvable."}
            app = _application(visible=True)
            for i in range(1, app.Workbooks.Count + 1):
                if os.path.normcase(app.Workbooks.Item(i).FullName) == os.path.normcase(chemin):
                    wb = app.Workbooks.Item(i)
                    break
            else:
                wb = app.Workbooks.Open(chemin)
            feuilles = [wb.Worksheets.Item(j).Name for j in range(1, wb.Worksheets.Count + 1)]
            return {"ok": True, "nom": wb.Name, "chemin": wb.FullName, "feuilles": feuilles}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:500]}
        finally:
            _liberer()


def _normale(valeur):
    if valeur is None:
        return ""
    if isinstance(valeur, float) and valeur.is_integer():
        return int(valeur)
    if hasattr(valeur, "strftime"):
        try:
            return valeur.strftime("%Y-%m-%d")
        except Exception:
            return str(valeur)
    return valeur if isinstance(valeur, (int, float, str, bool)) else str(valeur)


def lire_feuille(nom_classeur, nom_feuille, max_lignes=20000):
    with _VERROU:
        _com()
        try:
            app = _application(visible=True)
            wb = None
            for i in range(1, app.Workbooks.Count + 1):
                candidat = app.Workbooks.Item(i)
                if candidat.Name == nom_classeur or candidat.FullName == nom_classeur:
                    wb = candidat
                    break
            if wb is None:
                return {"ok": False, "message": "Classeur non ouvert dans Excel."}
            ws = None
            for j in range(1, wb.Worksheets.Count + 1):
                if wb.Worksheets.Item(j).Name == nom_feuille:
                    ws = wb.Worksheets.Item(j)
                    break
            if ws is None:
                return {"ok": False, "message": "Feuille introuvable."}
            utilisee = ws.UsedRange
            valeurs = utilisee.Value
            if valeurs is None:
                return {"ok": True, "en_tetes": [], "lignes": [], "total": 0}
            if not isinstance(valeurs, tuple):
                valeurs = ((valeurs,),)
            entetes = [_normale(v) for v in valeurs[0]]
            lignes = []
            for ligne in valeurs[1:max_lignes + 1]:
                if not isinstance(ligne, tuple):
                    ligne = (ligne,)
                if not any(v not in (None, "") for v in ligne):
                    continue
                lignes.append({str(entetes[i] or ("Col" + str(i + 1))): _normale(ligne[i])
                               if i < len(ligne) else "" for i in range(len(entetes))})
            return {"ok": True, "classeur": wb.Name, "feuille": ws.Name,
                    "en_tetes": [str(x) for x in entetes], "lignes": lignes,
                    "total": len(lignes), "plage": utilisee.Address}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:500]}
        finally:
            _liberer()


def fermer():
    global _APP
    with _VERROU:
        if _APP is not None:
            try:
                _APP.Quit()
            except Exception:
                pass
            _APP = None
    return {"ok": True}

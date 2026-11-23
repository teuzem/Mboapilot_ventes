# -*- coding: utf-8 -*-
"""Extraction de tableaux depuis un PDF.

Deux stratégies sont appliquées : les tableaux détectés par pypdf quand ils
existent, sinon une reconstruction à partir des lignes de texte alignées. Le
résultat est une liste de tableaux avec en-têtes et lignes, directement
exploitable par le studio d'import.
"""
import io
import re

from pypdf import PdfReader


def _nettoyage(valeur):
    return re.sub(r"\s+", " ", str(valeur or "")).strip()


def _lignes_en_tableau(texte, ecart=2):
    lignes = [l.rstrip() for l in texte.splitlines() if _nettoyage(l)]
    if len(lignes) < 2:
        return []
    blocs, courant = [], []
    for l in lignes:
        if not courant or len(l) >= len(courant[-1]) - 4:
            courant.append(l)
        else:
            if len(courant) >= 2:
                blocs.append(courant)
            courant = [l]
    if len(courant) >= 2:
        blocs.append(courant)
    resultats = []
    for bloc in blocs:
        separateur = re.split(r"\s{2,}", _nettoyage(bloc[0]))
        if len(separateur) < 2:
            continue
        nb = len(separateur)
        lignes_out = []
        for l in bloc[1:]:
            cellules = re.split(r"\s{2,}", _nettoyage(l))
            if len(cellules) < nb:
                cellules += [""] * (nb - len(cellules))
            lignes_out.append({_nettoyage(separateur[i]): _nettoyage(cellules[i])
                               for i in range(nb)})
        if lignes_out:
            resultats.append({"page": 0, "en_tetes": separateur, "lignes": lignes_out})
    return resultats


def extraire_bytes(donnees):
    reader = PdfReader(io.BytesIO(donnees))
    tableaux = []
    for numero, page in enumerate(reader.pages):
        try:
            extrait = page.extract_text(extraction_mode="layout") or ""
        except TypeError:
            extrait = page.extract_text() or ""
        for t in _lignes_en_tableau(extrait):
            t["page"] = numero + 1
            tableaux.append(t)
        try:
            for tbl in page.extract_tables() or []:
                if not tbl or len(tbl) < 2:
                    continue
                entetes = [_nettoyage(x) for x in tbl[0]]
                lignes = [{entetes[i]: _nettoyage(row[i]) if i < len(row) else ""
                           for i in range(len(entetes))} for row in tbl[1:]]
                tableaux.append({"page": numero + 1, "en_tetes": entetes, "lignes": lignes})
        except Exception:
            pass
    return tableaux


def extraire_pdf(chemin):
    with open(chemin, "rb") as fh:
        return extraire_bytes(fh.read())

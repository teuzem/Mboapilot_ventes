import { useCallback, useEffect, useMemo, useState } from "react";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import GppBadIcon from "@mui/icons-material/GppBad";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import HistoryIcon from "@mui/icons-material/History";
import ShieldIcon from "@mui/icons-material/Shield";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { api, dateFR } from "../api";
import { Badge, Empty, Modal, PageHead, Spinner, Toast } from "../components";

const RESULTATS = [
  ["", "Tous les résultats"],
  ["OK", "Succès (OK)"],
  ["KO", "Échecs / refus (KO)"],
  ["autre", "Autres"],
];

function toneResultat(r) {
  if (r === "OK") return "OK";
  if (String(r || "").startsWith("KO")) return "KO";
  return "autre";
}

export default function Audit() {
  const [logs, setLogs] = useState(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [resFiltre, setResFiltre] = useState("");
  const [actionFiltre, setActionFiltre] = useState("");
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [verif, setVerif] = useState(null);
  const [verifEnCours, setVerifEnCours] = useState(false);
  const [detail, setDetail] = useState(null);

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await api.get("/api/audit?q=" + encodeURIComponent(q));
      setLogs(r.logs || []);
      setTotal(r.total || 0);
    } catch (ex) {
      message(ex.message, "error");
      setLogs([]);
    } finally {
      setChargement(false);
    }
  }, [q]);

  useEffect(() => { charger(); }, [charger]);

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      const r = await api.get("/api/audit/verifier");
      setVerif(r);
      if (r.valide) message(`Chaîne vérifiée : ${r.verifiees} entrées scellées, aucune altération.`);
      else message(`Rupture de chaîne détectée à l'entrée #${r.premiere_erreur}.`, "error");
    } catch (ex) {
      message(ex.message, "error");
    }
    setVerifEnCours(false);
  };

  const actions = useMemo(() => {
    const set = new Set((logs || []).map((l) => l.action).filter(Boolean));
    return Array.from(set).sort();
  }, [logs]);

  const liste = useMemo(() => {
    return (logs || []).filter((l) => {
      if (resFiltre && toneResultat(l.resultat) !== resFiltre) return false;
      if (actionFiltre && l.action !== actionFiltre) return false;
      return true;
    });
  }, [logs, resFiltre, actionFiltre]);

  const stats = useMemo(() => {
    const base = logs || [];
    return {
      affichees: base.length,
      ok: base.filter((l) => toneResultat(l.resultat) === "OK").length,
      ko: base.filter((l) => toneResultat(l.resultat) === "KO").length,
      acteurs: new Set(base.map((l) => l.acteur).filter(Boolean)).size,
    };
  }, [logs]);

  const chaineOk = verif?.valide !== false;

  return (
    <>
      <PageHead
        eyebrow="Traçabilité & conformité"
        title="Journal d'audit"
        sub="Chaque action sensible est scellée dans une chaîne SHA-256 append-only. Toute altération d'une ligne rompt la vérification."
        actions={
          <button className="btn btn-brand" onClick={verifier} disabled={verifEnCours}>
            {verifEnCours ? <><Spinner inline label="" /> Vérification…</> : <><FingerprintIcon /> Vérifier la chaîne</>}
          </button>
        }
      />

      <div className="audit-page">
        <div className="audit-stats">
          <div className="audit-stat">
            <small>Entrées totales</small>
            <b>{total}</b>
            <span>depuis l'ouverture du journal</span>
          </div>
          <div className="audit-stat">
            <small>Affichées</small>
            <b>{stats.affichees}</b>
            <span>200 dernières entrées maximum</span>
          </div>
          <div className="audit-stat">
            <small>Succès / échecs</small>
            <b style={{ fontSize: 17 }}><span style={{ color: "#0A7B4E" }}>{stats.ok}</span> <span className="faint">/</span> <span style={{ color: "var(--red)" }}>{stats.ko}</span></b>
            <span>sur le jeu affiché</span>
          </div>
          <div className="audit-stat">
            <small>Acteurs distincts</small>
            <b>{stats.acteurs}</b>
            <span>comptes et services trace(s)</span>
          </div>
        </div>

        <div className={"chain-verdict" + (chaineOk ? "" : " bad")}>
          {chaineOk ? <VerifiedUserIcon /> : <GppBadIcon />}
          <div>
            <b>
              {verif === null
                ? "Intégrité non vérifiée sur cette session"
                : chaineOk
                  ? "Chaîne d'audit intègre"
                  : "Rupture de chaîne détectée"}
            </b>
            <span>
              {verif === null
                ? "Lancez la vérification pour recalculer chaque empreinte depuis l'origine (GENESIS)."
                : chaineOk
                  ? `${verif.verifiees} entrée(s) recalculée(s) avec succès · SHA-256 chaîné · aucune modification.`
                  : `Première incohérence à l'entrée #${verif.premiere_erreur} après ${verif.verifiees} entrée(s) valides.`}
            </span>
          </div>
          <button className="btn btn-outline" onClick={verifier} disabled={verifEnCours}>
            <FingerprintIcon /> {verif === null ? "Vérifier" : "Revérifier"}
          </button>
        </div>

        <div className="audit-toolbar">
          <div className="audit-search">
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Acteur, action, ressource, détail…" aria-label="Rechercher dans le journal" />
          </div>
          <select value={actionFiltre} onChange={(e) => setActionFiltre(e.target.value)} aria-label="Filtrer par action">
            <option value="">Toutes les actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={resFiltre} onChange={(e) => setResFiltre(e.target.value)} aria-label="Filtrer par résultat">
            {RESULTATS.map(([v, l]) => <option key={v || "all"} value={v}>{l}</option>)}
          </select>
          <Badge tone="brand">{liste.length} entrée(s)</Badge>
          <button className="btn btn-ghost" onClick={charger} disabled={chargement}><RefreshIcon /> Actualiser</button>
        </div>

        <div className="audit-table-wrap">
          {chargement && !logs ? (
            <div style={{ padding: 46, textAlign: "center" }}><Spinner label="Lecture du journal…" /></div>
          ) : liste.length === 0 ? (
            <div style={{ padding: 34 }}><Empty icon={<HistoryIcon />} title="Aucune entrée" text="Aucun événement ne correspond à ces critères." /></div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Horodatage UTC</th><th>Acteur</th><th>Action</th><th>Ressource</th>
                      <th>Résultat</th><th>Détails</th><th>Empreinte</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map((l) => {
                      const tone = toneResultat(l.resultat);
                      return (
                        <tr key={l.id}>
                          <td className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>{l.id}</td>
                          <td className="audit-date">{dateFR(l.horo, true)}</td>
                          <td className="audit-actor">{l.acteur}</td>
                          <td><span className="audit-action">{l.action}</span></td>
                          <td className="audit-resource">{l.ressource || "-"}</td>
                          <td><span className={"audit-result " + tone}>{l.resultat || "-"}</span></td>
                          <td className="audit-details">{l.details || "-"}</td>
                          <td className="audit-details" style={{ fontFamily: "Consolas, monospace" }}>{String(l.empreinte || "").slice(0, 12)}…</td>
                          <td>
                            <button className="icon-btn" title="Voir le détail" onClick={() => setDetail(l)}><VisibilityIcon /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="audit-foot">
                <span>{liste.length} ligne(s) affichée(s) · {total} au total · recherche serveur sur 200 entrées récentes</span>
                <span className="audit-note" style={{ margin: 0 }}>
                  <ShieldIcon /> Journal append-only · aucune suppression possible via l'interface
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Entrée #${detail.id}` : "Détail de l'événement"}
        subtitle={detail ? `${detail.action} · ${detail.resultat}` : ""}
        footer={<button className="btn btn-brand" onClick={() => setDetail(null)}>Fermer</button>}
      >
        {detail && (
          <div className="stack">
            <div className="detail-dl">
              <div><small>Horodatage UTC</small><b>{detail.horo} · {dateFR(detail.horo, true)}</b></div>
              <div><small>Acteur</small><b>{detail.acteur}</b></div>
              <div><small>Action</small><b><span className="audit-action">{detail.action}</span></b></div>
              <div><small>Résultat</small><b><span className={"audit-result " + toneResultat(detail.resultat)}>{detail.resultat}</span></b></div>
              <div><small>Ressource</small><b>{detail.ressource || "-"}</b></div>
              <div><small>Adresse IP</small><b className="mono">{detail.ip || "-"}</b></div>
              <div><small>Version du schéma</small><b>v{detail.version || 1}</b></div>
              <div><small>Entrée</small><b>#{detail.id}</b></div>
            </div>
            <div className="detail-block"><b>Détails</b>{detail.details || "Aucun détail complémentaire."}</div>
            <div className="detail-block"><b>Empreinte SHA-256</b><span className="mono" style={{ fontSize: 10.5, overflowWrap: "anywhere" }}>{detail.empreinte || "-"}</span></div>
            <div className="audit-note"><ShieldIcon /> L'empreinte couvre l'entrée précédente, l'horodatage, l'acteur, l'IP, l'action, la ressource, le résultat et les détails. Modifier un seul caractère invalide la chaîne.</div>
          </div>
        )}
      </Modal>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}

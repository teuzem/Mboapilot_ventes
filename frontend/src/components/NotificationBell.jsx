import { useEffect, useRef, useState } from "react";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { api, dateFR } from "../api";

export default function NotificationBell() {
  const [liste, setListe] = useState([]);
  const [nonlues, setNonlues] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);

  const charger = async () => {
    try {
      const r = await api.get("/api/notifications/inapp");
      setListe(r.notifications || []);
      setNonlues(r.nonlues || 0);
    } catch (e) {
      /* session expirée */
    }
  };

  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const clic = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOuvert(false);
    };
    document.addEventListener("mousedown", clic);
    return () => document.removeEventListener("mousedown", clic);
  }, []);

  const marquer = async (id) => {
    await api.post("/api/notifications/inapp/" + id + "/lu");
    charger();
  };

  const toutMarquer = async () => {
    await api.post("/api/notifications/inapp/tout-lu");
    charger();
  };

  return (
    <div className="notif-bell" ref={ref}>
      <button className="notif-btn" onClick={() => setOuvert(!ouvert)} aria-label="Notifications">
        <NotificationsIcon />
        {nonlues > 0 && <span className="notif-badge">{nonlues}</span>}
      </button>
      {ouvert && (
        <div className="notif-panel">
          <div className="notif-head">
            <b>Notifications</b>
            {nonlues > 0 && <button onClick={toutMarquer}>Tout marquer comme lu</button>}
          </div>
          <div className="notif-list">
            {liste.length === 0 && <p className="notif-vide">Aucune notification.</p>}
            {liste.map((n) => (
              <button
                key={n.id}
                className={"notif-item" + (n.lue ? "" : " neuve")}
                onClick={() => marquer(n.id)}
              >
                <b>{n.titre}</b>
                <span>{n.message}</span>
                <small>{dateFR(n.cree_le, true)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import {
  declencherInstallation, doitAfficher, enregistrerFermeture,
  texteBanniere, typeAppareil,
} from "../pwa";

export default function InstallBanner() {
  const appareil = useMemo(() => typeAppareil(), []);
  const texte = useMemo(() => texteBanniere(appareil), [appareil]);
  const [visible, setVisible] = useState(false);
  const [sansPrompt, setSansPrompt] = useState(false);

  useEffect(() => {
    setVisible(doitAfficher());
    const avant = (e) => {
      e.preventDefault();
      window.__mboaPrompt = e;
      setSansPrompt(false);
    };
    window.addEventListener("beforeinstallprompt", avant);
    return () => window.removeEventListener("beforeinstallprompt", avant);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.paddingTop;
    document.body.style.paddingTop = "40px";
    return () => { document.body.style.paddingTop = previous; };
  }, [visible]);

  if (!visible) return null;

  const fermer = () => {
    enregistrerFermeture();
    setVisible(false);
  };

  const agir = async () => {
    if (appareil.ios) {
      fermer();
      return;
    }
    const ok = await declencherInstallation();
    if (!ok) {
      setSansPrompt(true);
    } else {
      fermer();
    }
  };

  return (
    <div className="install-bande" role="region" aria-label="Installer MboaPilot">
      <div className="install-contenu">
        <span className="install-texte">
          {texte.message}
          {texte.etapes && <span className="install-etapes">{texte.etapes}</span>}
          {sansPrompt && <span className="install-repli">Utilisez le menu de votre navigateur pour installer l'application.</span>}
        </span>
        <button className="install-action" onClick={agir}>
          {!appareil.ios && <DownloadIcon fontSize="small" />}
          {sansPrompt ? "Voir le menu" : texte.action}
        </button>
        <button className="install-fermer" onClick={fermer} aria-label="Fermer la bande">
          <CloseIcon fontSize="small" />
        </button>
      </div>
    </div>
  );
}

// Préférences d'affichage retenues d'une visite à l'autre.
//
// Le premier — et pour l'instant le seul — usage de `localStorage` de
// l'application. Tout le reste de l'état d'écran passe par les paramètres d'URL
// (`?kq=`, `?kf=`, `?ks=`), qui survivent au rafraîchissement et se partagent par
// lien. Ce module ne les remplace pas : il les complète pour le cas qu'ils ne
// couvrent pas, celui du retour sur un écran avec une adresse nue.
//
// Rien de ce qui s'écrit ici ne doit être nécessaire à la lecture d'un écran : un
// navigateur qui refuse le stockage doit donner l'application entière, juste sans
// la commodité. D'où les `try/catch` — Safari en navigation privée lève sur
// `setItem`, et une préférence d'affichage ne justifie pas de faire tomber la page.

const PREFIX = 'gestia.';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Écrit une préférence. La chaîne vide est une valeur comme une autre, pas un
 * effacement : sur un filtre, « aucun » est un choix délibéré qu'un retour ne doit
 * pas réécraser par le dernier choix actif. Passer `null` efface réellement.
 */
export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* stockage refusé : la préférence ne survivra pas, l'écran fonctionne quand même */
  }
}

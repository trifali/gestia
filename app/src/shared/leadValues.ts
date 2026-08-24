// Reconnaissance du type d'une information libre, pour l'afficher utilement.
//
// Le problème : `Lead.extras` ne porte que du texte. Un formulaire y met aussi
// bien « 5 000 $ – 10 000 $ » qu'une adresse de site, un courriel de contact, un
// numéro à rappeler ou une date de rendez-vous au format `2026-04-13T14:00:00Z`.
// Affiché tel quel, tout cela est du texte mort : on recopie l'adresse à la main
// dans la barre du navigateur, on retape le numéro dans le téléphone, et on
// déchiffre la date.
//
// D'où ce module : une seule fonction qui devine, et deux écrans — la carte et la
// fiche — qui s'y fient. Les avoir tous deux passer par ici est ce qui garantit
// qu'un champ cliquable dans la fiche l'est aussi sur la carte.
//
// ── Prudence délibérée ───────────────────────────────────────────────────────
//
// Ces valeurs viennent d'un tiers : un formulaire public, un Zapier, n'importe
// quelle charge utile qu'on nous poste. Deux règles en découlent.
//
// 1. **Aucun schéma d'adresse autre que http(s).** Une valeur `javascript:…`
//    transformée en lien serait une faille exploitable par quiconque peut poster
//    sur le point d'entrée — c'est-à-dire, pour un formulaire public, tout le
//    monde. La liste blanche est donc fermée, et vérifiée après normalisation.
//
// 2. **Dans le doute, du texte.** Un faux positif est bien pire qu'un faux
//    négatif : un montant transformé en numéro de téléphone donne un lien qui
//    compose n'importe quoi, alors qu'un numéro laissé en texte reste lisible et
//    se copie. Chaque motif ci-dessous est donc ancré et strict.

import { formatMontrealTime } from './format';
import { toE164 } from './phone';

export type LeadValue =
  | { kind: 'url'; href: string; display: string }
  | { kind: 'email'; href: string; display: string }
  | { kind: 'phone'; href: string; display: string }
  | { kind: 'date'; display: string }
  | { kind: 'text'; display: string };

/** Les seuls schémas qu'on accepte de rendre cliquables. */
const SAFE_SCHEMES = new Set(['http:', 'https:']);

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Un nom de domaine complet, et rien d'autre autour.
 *
 * Ancré des deux côtés et sans espace : c'est ce qui empêche une phrase contenant
 * « rendez-vous sur example.com » de devenir un lien entier, cas où l'on
 * masquerait la phrase derrière son seul domaine.
 */
const BARE_DOMAIN =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;

const EMAIL = /^[^\s@<>()[\],;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/i;

/**
 * Les deux seules formes de numéro reconnues : E.164, et la forme nord-américaine
 * avec ou sans séparateurs.
 *
 * Volontairement pas « une suite de chiffres d'une longueur plausible » : « 5 000
 * 10 000 » en est une, et un budget transformé en lien d'appel est exactement le
 * faux positif qu'on refuse.
 */
const E164 = /^\+[1-9]\d{7,14}$/;
const NANP = /^(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

/** ISO 8601 avec une heure : la forme qu'aucun humain ne lit de lui-même. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** L'adresse rendue lisible : sans le schéma, sans la barre oblique finale. */
function prettyUrl(href: string): string {
  return href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Ce qu'est une valeur d'information libre, et comment l'afficher.
 *
 * Ne lève jamais et retombe toujours sur `text` : cette fonction est appelée à
 * chaque rendu de chaque carte, et une valeur biscornue doit produire du texte,
 * pas une page blanche.
 */
export function detectLeadValue(raw: string): LeadValue {
  const value = (raw ?? '').trim();
  if (!value) return { kind: 'text', display: '' };

  // ── Adresse avec schéma ──
  if (HAS_SCHEME.test(value)) {
    try {
      const url = new URL(value);
      // La liste blanche s'applique ici, après que `URL` a normalisé le schéma :
      // `JaVaScRiPt:` et `java\nscript:` arrivent tous deux à `javascript:`.
      if (SAFE_SCHEMES.has(url.protocol)) {
        return { kind: 'url', href: url.href, display: prettyUrl(url.href) };
      }
      // `mailto:` reconnu explicitement plutôt que laissé au fourre-tout : c'est
      // une adresse légitime, mais qui se rend en courriel et non en lien web.
      if (url.protocol === 'mailto:' && EMAIL.test(url.pathname)) {
        return { kind: 'email', href: `mailto:${url.pathname}`, display: url.pathname };
      }
    } catch {
      // Adresse illisible : elle finira en texte, ce qui est le bon repli.
    }
    return { kind: 'text', display: value };
  }

  // ── Courriel ──
  // Avant le domaine nu : `jean@exemple.com` contient un domaine valide, et
  // l'ordre inverse en ferait un lien web vers « exemple.com ».
  if (EMAIL.test(value)) {
    return { kind: 'email', href: `mailto:${value}`, display: value };
  }

  // ── Téléphone ──
  if (E164.test(value) || NANP.test(value)) {
    const e164 = toE164(value);
    if (e164) return { kind: 'phone', href: `tel:${e164}`, display: value };
  }

  // ── Date ──
  if (ISO_DATETIME.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { kind: 'date', display: formatMontrealTime(parsed) };
    }
  }

  // ── Domaine nu ──
  // En dernier, une fois écartés courriels et numéros : c'est le motif le plus
  // permissif des cinq, donc celui qui doit avoir le moins d'occasions de servir.
  if (BARE_DOMAIN.test(value)) {
    try {
      const url = new URL(`https://${value}`);
      if (SAFE_SCHEMES.has(url.protocol)) {
        return { kind: 'url', href: url.href, display: prettyUrl(value) };
      }
    } catch {
      // idem : repli en texte.
    }
  }

  return { kind: 'text', display: value };
}

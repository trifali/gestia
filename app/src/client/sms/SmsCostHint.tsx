// Compteur de coût partagé par les trois zones de rédaction SMS : messagerie
// flottante, composeur de prospection, éditeur de modèles.
//
// Il ne se contente pas d'avertir. Un « — » ou une apostrophe courbe fait
// basculer le message en UCS-2 et tombe la limite de 160 à 70 caractères — un
// texte de 150 caractères passe alors de 1 à 3 segments facturés. Le bouton
// propose la conversion et chiffre ce qu'elle rapporte.
//
// Proposé, jamais imposé : le texte part au nom de l'utilisateur, et remplacer
// ses apostrophes dans son dos n'est pas à nous de le décider. Nos propres
// messages (alerte de réponse, SMS de test), eux, sont convertis d'office côté
// serveur — voir `buildReplyAlertText`.

import { smsSegments, toGsm7 } from './smsText';

export function SmsCostHint({
  text,
  onSimplify,
  compact,
}: {
  /** Le texte dont on affiche le coût. */
  text: string;
  /** Applique la conversion GSM-7. Absent : le compteur reste informatif. */
  onSimplify?: () => void;
  /** Formulation courte, pour l'aperçu de modèle. */
  compact?: boolean;
}) {
  const counts = smsSegments(text);
  // Ce que la conversion ferait gagner, en segments facturés. Zéro quand le
  // texte est déjà court : inutile de proposer d'abîmer une apostrophe pour rien.
  const saved = counts.unicode ? counts.segments - smsSegments(toGsm7(text)).segments : 0;

  return (
    <>
      <span>
        {compact ? 'Aperçu avec données fictives : ' : ''}
        {counts.chars} caractère(s) · {counts.segments} SMS
      </span>
      {counts.unicode && (
        <span className='text-amber-600'>caractères spéciaux · limite 70 par SMS</span>
      )}
      {counts.unicode && onSimplify && saved > 0 && (
        <button
          type='button'
          onClick={onSimplify}
          className='underline underline-offset-2 hover:text-ink text-amber-700'
          title={
            'Remplace tirets longs, apostrophes courbes, emoji et accents hors GSM-7 ' +
            'par leurs équivalents simples. Le texte reste lisible et repasse à 160 ' +
            'caractères par SMS.'
          }
        >
          simplifier (−{saved} SMS)
        </button>
      )}
    </>
  );
}

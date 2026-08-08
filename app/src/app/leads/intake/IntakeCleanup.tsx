// L'éditeur de nettoyage d'un champ : la suite d'opérations qui sépare ce qu'on a
// reçu de ce qui sera écrit.
//
// Il occupe **toute la largeur** du panneau, jamais une colonne de tableau. Une
// première version le logeait dans la cellule « Nettoyage » : à 672 px de modale,
// la liste déroulante affichait « full_n∨ » et l'assistant écrivait un mot par
// ligne. Un éditeur ne tient pas dans une cellule — c'est la ligne du tableau qui
// s'ouvre pour lui faire de la place (voir `IntakeMappingPanel`).
//
// L'expression régulière a son propre éditeur, et il est délibérément direct :
// deux champs en police fixe, les correspondances surlignées sur la valeur réelle,
// les groupes capturés listés avec leur contenu. Pas de formulation prudente
// autour — quand on vient ici, c'est qu'on veut une expression, et le retour utile
// n'est pas une explication mais de voir ce que le motif attrape. L'assistant
// l'écrit à partir d'une phrase en français ; le surlignage dit s'il a eu raison.

import { useMemo, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  LuArrowRight,
  LuChevronLeft,
  LuChevronRight,
  LuLoader,
  LuPlus,
  LuRegex,
  LuSparkles,
  LuTrash2,
  LuTriangleAlert,
  LuWandSparkles,
  LuX,
} from 'react-icons/lu';
import { suggestFieldCleanup } from 'wasp/client/operations';
import {
  blankTransform,
  describeTransform,
  isValidPattern,
  MAX_TRANSFORMS,
  TRANSFORM_LABELS,
  type Transform,
  type TransformOp,
  type TransformStep,
} from '../../../shared/leadIntakeTransforms';

/**
 * Les deux opérations qui portent une expression régulière. Séparées du reste dans
 * le menu comme dans l'éditeur : ce sont les seules dont le réglage demande de la
 * place, un surlignage et l'assistant.
 */
const REGEX_OPS: TransformOp[] = ['replace', 'extract'];

type RegexTransform = Extract<Transform, { op: 'replace' } | { op: 'extract' }>;

/** `Array.includes` ne restreint pas le type ; ce prédicat, oui. */
function isRegexTransform(transform: Transform): transform is RegexTransform {
  return transform.op === 'replace' || transform.op === 'extract';
}

/** Les formats, du plus courant au plus spécialisé. Un clic, aucun paramètre à deviner. */
const FORMAT_OPS: TransformOp[] = ['phone', 'date', 'strip', 'case', 'keep', 'remove', 'trim', 'truncate', 'fallback'];

// ─── Résumé, pour la ligne fermée ─────────────────────────────────────────────

/**
 * Le nettoyage en un coup d'œil, sans interaction.
 *
 * Une pastille barrée n'a rien changé sur l'échantillon : c'est le signal le plus
 * utile du tableau, parce qu'une expression régulière qui ne mord pas est autrement
 * indistinguable d'une expression qui fait son travail.
 */
export function CleanupSummary({
  transforms,
  steps,
}: {
  transforms: Transform[];
  steps: TransformStep[];
}) {
  if (!transforms.length) {
    return <span className='text-xs italic text-muted'>tel quel</span>;
  }
  return (
    <span className='flex flex-wrap items-center gap-1'>
      {transforms.map((transform, i) => {
        const step = steps[i];
        const tone = step?.invalid
          ? 'bg-amber-50 text-amber-800 ring-amber-200'
          : step?.noop
            ? 'bg-canvas-200 text-muted ring-line line-through'
            : 'bg-sky-50 text-sky-700 ring-sky-200';
        return (
          <span
            key={i}
            title={step?.invalid ?? step?.value}
            className={`inline-flex max-w-[11rem] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${tone}`}
          >
            {step?.invalid && <LuTriangleAlert size={9} className='shrink-0' />}
            <span className='truncate'>{describeTransform(transform)}</span>
          </span>
        );
      })}
    </span>
  );
}

// ─── L'éditeur, en pleine largeur ─────────────────────────────────────────────

export function CleanupEditor({
  fieldLabel,
  path,
  raw,
  transforms,
  steps,
  disabled,
  onChange,
}: {
  /** Nom du champ visé, pour la consigne envoyée à l'assistant. */
  fieldLabel: string;
  /** Chemin d'origine, pour la consigne envoyée à l'assistant. */
  path: string;
  /** La valeur avant nettoyage. */
  raw: string;
  transforms: Transform[];
  /** Le détail étape par étape, calculé par le parent avec le vrai moteur. */
  steps: TransformStep[];
  disabled: boolean;
  onChange: (transforms: Transform[]) => void;
}) {
  // La dernière opération est sélectionnée d'office : c'est celle qu'on vient
  // d'ajouter neuf fois sur dix, et celle qu'on veut régler.
  const [selected, setSelected] = useState<number>(Math.max(0, transforms.length - 1));
  const [menuOpen, setMenuOpen] = useState(false);

  const index = Math.min(selected, transforms.length - 1);
  const current = transforms[index];
  const full = transforms.length >= MAX_TRANSFORMS;

  function update(at: number, transform: Transform) {
    onChange(transforms.map((t, i) => (i === at ? transform : t)));
  }

  function add(op: TransformOp) {
    onChange([...transforms, blankTransform(op)]);
    setSelected(transforms.length);
    setMenuOpen(false);
  }

  function remove(at: number) {
    onChange(transforms.filter((_, i) => i !== at));
    setSelected(Math.max(0, at - 1));
  }

  function move(at: number, delta: number) {
    const target = at + delta;
    if (target < 0 || target >= transforms.length) return;
    const next = [...transforms];
    [next[at], next[target]] = [next[target], next[at]];
    onChange(next);
    setSelected(target);
  }

  return (
    <div className='space-y-3'>
      {/* ── La chaîne : « reçu » puis chaque étape, comme un fil ── */}
      <div className='flex flex-wrap items-center gap-1.5'>
        <span className='rounded bg-canvas-200 px-2 py-1 font-mono text-xs text-muted'>
          {raw || 'vide'}
        </span>

        {transforms.map((transform, i) => {
          const step = steps[i];
          const active = i === index;
          const tone = step?.invalid
            ? 'bg-amber-50 text-amber-900 ring-amber-300'
            : active
              ? 'bg-ink text-white ring-ink'
              : step?.noop
                ? 'bg-canvas-200 text-muted ring-line'
                : 'bg-white text-ink ring-line hover:ring-ink/40';
          return (
            <span key={i} className='flex items-center gap-1.5'>
              <LuArrowRight size={12} className='shrink-0 text-muted' />
              <button
                type='button'
                onClick={() => setSelected(i)}
                className={`inline-flex max-w-[16rem] items-center gap-1 truncate rounded px-2 py-1 text-xs font-medium ring-1 transition-colors ${tone}`}
              >
                {step?.invalid && <LuTriangleAlert size={10} className='shrink-0' />}
                {REGEX_OPS.includes(transform.op) && <LuRegex size={11} className='shrink-0 opacity-70' />}
                <span className='truncate'>{describeTransform(transform)}</span>
              </button>
            </span>
          );
        })}

        {transforms.length > 0 && (
          <>
            <LuArrowRight size={12} className='shrink-0 text-muted' />
            <span className='rounded bg-emerald-50 px-2 py-1 font-mono text-xs font-medium text-emerald-800 ring-1 ring-emerald-200'>
              {steps[steps.length - 1]?.value || 'vide'}
            </span>
          </>
        )}
      </div>

      {/* ── Ajouter ── */}
      {!disabled && !full && (
        <div className='flex flex-wrap items-center gap-1.5'>
          <button
            type='button'
            onClick={() => add('replace')}
            className='inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200 transition-colors hover:bg-violet-100'
          >
            <LuRegex size={13} />
            Expression régulière
          </button>
          <div className='relative'>
            <button
              type='button'
              onClick={() => setMenuOpen(o => !o)}
              className='inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-ink/40 hover:text-ink'
            >
              <LuPlus size={12} />
              Format
            </button>
            {menuOpen && (
              <div className='absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-white shadow-lg'>
                {FORMAT_OPS.map(op => (
                  <button
                    key={op}
                    type='button'
                    onClick={() => add(op)}
                    className='block w-full px-3 py-1.5 text-left text-xs text-ink transition-colors hover:bg-canvas-200'
                  >
                    {TRANSFORM_LABELS[op]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {full && !disabled && (
        <p className='text-xs text-muted'>
          {MAX_TRANSFORMS} opérations au maximum. Au-delà, un nettoyage ne se relit plus.
        </p>
      )}

      {/* ── Le réglage de l'opération sélectionnée ── */}
      {current && (
        <div className='rounded-lg border border-line bg-canvas-100 p-3'>
          <div className='mb-2.5 flex items-center justify-between gap-2'>
            <span className='text-xs font-semibold uppercase tracking-wide text-muted'>
              Étape {index + 1} — {TRANSFORM_LABELS[current.op]}
            </span>
            {!disabled && (
              <div className='flex items-center gap-0.5'>
                {/* L'ordre compte : « retirer p: » puis « format téléphone »
                    marche, l'inverse non. */}
                <IconButton title='Déplacer avant' disabled={index === 0} onClick={() => move(index, -1)}>
                  <LuChevronLeft size={13} />
                </IconButton>
                <IconButton title='Déplacer après' disabled={index === transforms.length - 1} onClick={() => move(index, 1)}>
                  <LuChevronRight size={13} />
                </IconButton>
                <IconButton title='Supprimer cette étape' onClick={() => remove(index)}>
                  <LuTrash2 size={13} />
                </IconButton>
              </div>
            )}
          </div>

          {isRegexTransform(current) ? (
            <RegexParams
              transform={current}
              // Le motif s'applique à ce qui sort de l'étape précédente, pas à la
              // valeur d'origine : surligner sur `raw` mentirait dès qu'un
              // « retirer p: » le précède.
              input={index === 0 ? raw : (steps[index - 1]?.value ?? raw)}
              fieldLabel={fieldLabel}
              path={path}
              disabled={disabled}
              onChange={t => update(index, t)}
            />
          ) : (
            <FormatParams transform={current} disabled={disabled} onChange={t => update(index, t)} />
          )}

          <div className='mt-2.5 border-t border-line pt-2 text-xs'>
            {steps[index]?.invalid ? (
              <p className='flex items-start gap-1.5 text-amber-800'>
                <LuTriangleAlert size={12} className='mt-0.5 shrink-0' />
                {steps[index]?.invalid} Cette étape est ignorée.
              </p>
            ) : (
              <p className='text-muted'>
                Après cette étape :{' '}
                <span className='font-mono text-ink'>
                  {steps[index]?.value || <span className='italic text-muted'>vide</span>}
                </span>
                {steps[index]?.noop && <span className='ml-1'>— inchangé</span>}
              </p>
            )}
          </div>
        </div>
      )}

      {transforms.length === 0 && (
        <p className='text-xs text-muted'>
          Aucun nettoyage : la valeur est reprise telle quelle.
        </p>
      )}
    </div>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      title={title}
      disabled={disabled}
      onClick={onClick}
      className='rounded p-1 text-muted transition-colors hover:bg-canvas-200 hover:text-ink disabled:cursor-default disabled:opacity-30'
    >
      {children}
    </button>
  );
}

// ─── L'éditeur d'expression régulière ─────────────────────────────────────────

/**
 * Motif, remplacement, et ce que ça donne — sur la vraie valeur.
 *
 * Le surlignage est l'essentiel : écrire une expression à l'aveugle et découvrir
 * le résultat trois champs plus loin est ce qui rend l'exercice pénible. Voir ce
 * que le motif attrape, et le contenu de chaque groupe capturé, permet de corriger
 * `$1` en `$2` sans avoir à raisonner.
 */
function RegexParams({
  transform,
  input,
  fieldLabel,
  path,
  disabled,
  onChange,
}: {
  transform: RegexTransform;
  input: string;
  fieldLabel: string;
  path: string;
  disabled: boolean;
  onChange: (transform: Transform) => void;
}) {
  const isExtract = transform.op === 'extract';
  const pattern = isExtract ? transform.pattern : transform.find;
  const flags = transform.flags ?? '';

  // Un « replace » littéral n'est pas une expression : on force le drapeau ici,
  // parce que cet éditeur n'existe que pour les expressions et qu'une case à
  // cocher « oui c'est bien une regex » n'aurait rien à dire.
  const asRegex = isExtract || !!transform.regex;

  const valid = !pattern || isValidPattern(pattern, flags);
  const analysis = useMemo(
    () => (valid && pattern ? analyse(input, pattern, flags) : null),
    [input, pattern, flags, valid],
  );

  function setPattern(next: string) {
    onChange(isExtract ? { ...transform, pattern: next } : { ...transform, find: next, regex: true });
  }

  return (
    <div className='space-y-2.5'>
      <AiRegex
        fieldLabel={fieldLabel}
        path={path}
        sample={input}
        disabled={disabled}
        onWrite={t => onChange(t)}
      />

      <div className='grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
        <div>
          <label className='mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-700'>
            Motif
            <span className='font-mono text-muted'>/…/{flags}</span>
          </label>
          <div className='flex gap-1.5'>
            <input
              className={`input font-mono text-xs ${!valid ? 'border-amber-400' : ''}`}
              spellCheck={false}
              autoCapitalize='off'
              autoCorrect='off'
              value={pattern}
              disabled={disabled}
              placeholder={isExtract ? '\\d{3}-\\d{4}' : '^p:'}
              onChange={e => setPattern(e.target.value)}
            />
            <button
              type='button'
              title='Ignorer la casse'
              disabled={disabled}
              onClick={() => onChange({ ...transform, flags: flags.includes('i') ? undefined : 'i' })}
              className={`shrink-0 rounded-lg border px-2.5 font-mono text-xs transition-colors ${
                flags.includes('i')
                  ? 'border-ink bg-ink text-white'
                  : 'border-line text-muted hover:border-ink/40 hover:text-ink'
              }`}
            >
              i
            </button>
          </div>
        </div>

        {isExtract ? (
          <div>
            <label className='mb-1 block text-xs font-medium text-ink-700'>Ce qu'on garde</label>
            <select
              className='input text-xs'
              value={transform.group ?? 0}
              disabled={disabled}
              onChange={e => onChange({ ...transform, group: Number(e.target.value) || 0 })}
            >
              <option value={0}>Tout ce que le motif trouve</option>
              {Array.from({ length: analysis?.groups.length ?? 0 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Groupe ${i + 1}
                  {analysis?.groups[i] ? ` — « ${analysis.groups[i]} »` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className='mb-1 block text-xs font-medium text-ink-700'>
              Remplacement <span className='font-normal text-muted'>— vide = supprimer</span>
            </label>
            <input
              className='input font-mono text-xs'
              spellCheck={false}
              value={transform.replace}
              disabled={disabled}
              placeholder='$1'
              onChange={e => onChange({ ...transform, replace: e.target.value, regex: true })}
            />
          </div>
        )}
      </div>

      {!valid && (
        <p className='flex items-start gap-1.5 text-xs text-amber-800'>
          <LuTriangleAlert size={12} className='mt-0.5 shrink-0' />
          Motif invalide, ou refusé parce que son coût peut exploser (quantificateur imbriqué du
          genre <span className='font-mono'>(a+)+</span>). L'enregistrement le refusera aussi.
        </p>
      )}

      {/* ── Ce que le motif attrape, sur la vraie valeur ── */}
      {valid && pattern && analysis && (
        <div className='rounded border border-line bg-white p-2'>
          <p className='mb-1 text-xs font-medium text-muted'>
            {analysis.count === 0
              ? 'Aucune correspondance dans cette valeur'
              : `${analysis.count} correspondance${analysis.count > 1 ? 's' : ''}`}
          </p>
          <p className='break-all font-mono text-xs leading-relaxed'>
            {analysis.segments.length === 0 ? (
              <span className='italic text-muted'>valeur vide</span>
            ) : (
              analysis.segments.map((seg, i) =>
                seg.hit ? (
                  <mark key={i} className='rounded bg-violet-200/70 px-0.5 text-ink'>{seg.text}</mark>
                ) : (
                  <span key={i} className='text-muted'>{seg.text}</span>
                ),
              )
            )}
          </p>
          {analysis.groups.length > 0 && (
            <p className='mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-1.5 text-xs text-muted'>
              {analysis.groups.map((g, i) => (
                <span key={i}>
                  <span className='font-mono text-ink'>${i + 1}</span>{' '}
                  {g ? `« ${g} »` : <span className='italic'>vide</span>}
                </span>
              ))}
            </p>
          )}
          {!asRegex && (
            <p className='mt-1 text-xs text-muted'>Ce motif est traité comme une expression régulière.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Découpe la valeur en morceaux touchés / non touchés, et relève les groupes du
 * premier résultat.
 *
 * La boucle avance de force sur une correspondance de longueur nulle : un motif
 * comme `\d*` en trouve une à chaque position, et `exec` sans cette précaution
 * tourne indéfiniment sur le même index. Le nombre de tours est aussi plafonné —
 * un surlignage n'a pas besoin de plus, et cet appel est refait à chaque frappe.
 */
function analyse(
  value: string,
  pattern: string,
  flags: string,
): { segments: { text: string; hit: boolean }[]; groups: string[]; count: number } | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch {
    return null;
  }

  const segments: { text: string; hit: boolean }[] = [];
  let groups: string[] = [];
  let last = 0;
  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(value)) !== null && count < 50) {
    if (match.index > last) segments.push({ text: value.slice(last, match.index), hit: false });
    if (match[0]) segments.push({ text: match[0], hit: true });
    if (count === 0) groups = match.slice(1).map(g => g ?? '');
    last = match.index + match[0].length;
    count++;
    if (match[0] === '') re.lastIndex++;
  }
  if (last < value.length) segments.push({ text: value.slice(last), hit: false });

  return { segments, groups, count };
}

// ─── L'assistant, dans l'éditeur d'expression ─────────────────────────────────

/**
 * Une phrase en français → un motif écrit dans les champs au-dessus.
 *
 * Le résultat s'écrit **directement** dans l'éditeur, sans étape d'acceptation :
 * le surlignage montre aussitôt ce que le motif attrape, et le corriger à la main
 * est le geste attendu. Une confirmation intermédiaire n'ajouterait qu'un clic
 * avant de voir ce que seul le surlignage peut dire.
 */
function AiRegex({
  fieldLabel,
  path,
  sample,
  disabled,
  onWrite,
}: {
  fieldLabel: string;
  path: string;
  sample: string;
  disabled: boolean;
  onWrite: (transform: Transform) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await suggestFieldCleanup({
        fieldLabel,
        path,
        samples: [sample].filter(Boolean),
        instruction,
        prefer: 'regex',
      });
      const written = (res.transforms as Transform[])[0];
      if (!written) {
        toast.error("L'assistant n'a pas produit d'expression.");
        return;
      }
      onWrite(written);
    } catch (err: any) {
      toast.error(err?.message ?? "L'assistant n'a pas répondu.");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) return null;

  return (
    <div className='flex gap-1.5'>
      <div className='relative flex-1'>
        <LuSparkles size={13} className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-violet-500' />
        <input
          className='input pl-8 text-xs'
          placeholder="Décrivez l'expression — « garde les 10 chiffres »"
          value={instruction}
          disabled={busy}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
        />
      </div>
      <button
        type='button'
        onClick={() => void run()}
        disabled={busy}
        className='inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50'
      >
        {busy ? <LuLoader size={13} className='animate-spin' /> : <LuWandSparkles size={13} />}
        Écrire
      </button>
    </div>
  );
}

// ─── Les formats ──────────────────────────────────────────────────────────────

/** Les réglages des opérations qui ne sont pas des expressions régulières. */
function FormatParams({
  transform,
  disabled,
  onChange,
}: {
  transform: Transform;
  disabled: boolean;
  onChange: (transform: Transform) => void;
}) {
  const cls = 'input text-xs';

  switch (transform.op) {
    case 'trim':
      return <Note>Espaces de tête et de fin retirés, suites d'espaces ramenées à un seul.</Note>;

    case 'phone':
      return (
        <Note>
          Numéro ramené au format <span className='font-mono'>+15145551234</span>. Laissé tel quel si
          ce n'en est pas un.
        </Note>
      );

    case 'case':
      return (
        <Row>
          <Field label='Casse'>
            <select
              className={cls}
              value={transform.to}
              disabled={disabled}
              onChange={e => onChange({ op: 'case', to: e.target.value as 'lower' | 'upper' | 'title' })}
            >
              <option value='title'>Initiales En Majuscule</option>
              <option value='lower'>minuscules</option>
              <option value='upper'>CAPITALES</option>
            </select>
          </Field>
        </Row>
      );

    case 'strip':
      return (
        <Row>
          <Field label='Retirer ce début' hint='Ex. : p:'>
            <input
              className={`${cls} font-mono`}
              value={transform.prefix ?? ''}
              disabled={disabled}
              placeholder='p:'
              onChange={e => onChange({ ...transform, prefix: e.target.value })}
            />
          </Field>
          <Field label='Retirer cette fin' hint='Optionnel.'>
            <input
              className={`${cls} font-mono`}
              value={transform.suffix ?? ''}
              disabled={disabled}
              onChange={e => onChange({ ...transform, suffix: e.target.value })}
            />
          </Field>
        </Row>
      );

    case 'remove':
      return (
        <Row>
          <Field label='Caractères à supprimer' hint='Écrits à la suite, sans séparateur.'>
            <input
              className={`${cls} font-mono`}
              value={transform.chars}
              disabled={disabled}
              placeholder='()- .'
              onChange={e => onChange({ op: 'remove', chars: e.target.value })}
            />
          </Field>
        </Row>
      );

    case 'keep':
      return (
        <Row>
          <Field label='Ne garder que'>
            <select
              className={cls}
              value={transform.only}
              disabled={disabled}
              onChange={e => onChange({ op: 'keep', only: e.target.value as 'digits' | 'letters' | 'alnum' })}
            >
              <option value='digits'>les chiffres</option>
              <option value='letters'>les lettres</option>
              <option value='alnum'>les lettres et les chiffres</option>
            </select>
          </Field>
        </Row>
      );

    case 'date':
      return (
        <Row>
          <Field
            label='Format'
            // Un exemple d'heure serait trompeur : Meta envoie ses horodatages en
            // UTC, et « 14:00 » reçu s'affiche « 10 h 00 » ici. La ligne
            // « Après cette étape » montre l'heure réelle, ce qu'aucun exemple
            // figé ne peut faire.
            hint="Converti à l'heure de Montréal, comme partout ailleurs dans l'application."
          >
            <select
              className={cls}
              value={transform.to}
              disabled={disabled}
              onChange={e => onChange({ op: 'date', to: e.target.value as 'day' | 'daytime' | 'iso' })}
            >
              <option value='day'>Date seulement — 13 avril 2026</option>
              <option value='daytime'>Date et heure</option>
              <option value='iso'>Format ISO — 2026-04-13</option>
            </select>
          </Field>
        </Row>
      );

    case 'truncate':
      return (
        <Row>
          <Field label='Longueur maximale' hint="Coupé sur un mot quand c'est possible, suivi de « … ».">
            <input
              type='number'
              min={1}
              max={2000}
              className={cls}
              value={transform.max}
              disabled={disabled}
              onChange={e => onChange({ op: 'truncate', max: Math.max(1, Math.min(2000, Number(e.target.value) || 1)) })}
            />
          </Field>
        </Row>
      );

    case 'fallback':
      return (
        <Row>
          <Field label='Valeur si le résultat est vide'>
            <input
              className={cls}
              value={transform.value}
              disabled={disabled}
              placeholder='Non précisé'
              onChange={e => onChange({ op: 'fallback', value: e.target.value })}
            />
          </Field>
        </Row>
      );

    default:
      return null;
  }
}

function Row({ children }: { children: ReactNode }) {
  return <div className='grid gap-2.5 sm:grid-cols-2'>{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className='text-xs text-muted'>{children}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className='mb-1 block text-xs font-medium text-ink-700'>{label}</label>
      {children}
      {hint && <p className='mt-0.5 text-xs text-muted'>{hint}</p>}
    </div>
  );
}

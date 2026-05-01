import {
  forwardRef,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { LuSparkles, LuLoader } from 'react-icons/lu';
import toast from 'react-hot-toast';
import { magicCorrect } from 'wasp/client/operations';

/**
 * Drop-in replacements for native <input> and <textarea> that surface a small
 * "magic" sparkles icon allowing the user to auto-correct the field's text via
 * an LLM (Replicate). The icon only appears for free-text fields and never for
 * structured types like number, date, email, password, checkbox, etc.
 */

const TEXT_LIKE_TYPES = new Set<string>(['text', 'search', '']);

function isTextType(type: string | undefined): boolean {
  return type === undefined || TEXT_LIKE_TYPES.has(type);
}

/**
 * Programmatically updates a controlled input/textarea so React's onChange
 * fires with the new value. We use the prototype value setter trick because
 * React intercepts the original setter and won't observe a plain assignment.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function runMagic(
  el: HTMLInputElement | HTMLTextAreaElement,
  setBusy: (b: boolean) => void,
): Promise<void> {
  const current = el.value;
  if (!current.trim()) {
    toast('Aucun texte à corriger', { icon: '✨' });
    return;
  }
  setBusy(true);
  try {
    const res = await magicCorrect({ text: current });
    const next = res.text ?? '';
    if (next && next !== current) {
      setNativeValue(el, next);
      toast.success('Texte corrigé');
    } else {
      toast('Aucune correction nécessaire', { icon: '✨' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur lors de la correction';
    toast.error(msg);
  } finally {
    setBusy(false);
  }
}

function MagicButton({
  busy,
  align,
  onClick,
}: {
  busy: boolean;
  align: 'center' | 'top';
  onClick: () => void;
}) {
  const position = align === 'top' ? 'top-2' : 'top-1/2 -translate-y-1/2';
  return (
    <button
      type='button'
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={busy}
      title='Corriger avec l’IA'
      aria-label='Corriger le texte avec l’IA'
      className={`absolute right-1.5 ${position} inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50`}
    >
      {busy ? (
        <LuLoader size={14} className='animate-spin' />
      ) : (
        <LuSparkles size={14} />
      )}
    </button>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────

type MagicInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /**
   * Force-enable or force-disable the magic icon. Defaults to auto: enabled
   * for plain text/search fields and disabled for everything else.
   */
  magic?: boolean;
  /** Class names applied to the wrapper element (useful for grid/flex spans). */
  containerClassName?: string;
};

export const MagicInput = forwardRef<HTMLInputElement, MagicInputProps>(
  function MagicInput(
    { magic, type = 'text', className, containerClassName, ...rest },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);

    const enabled =
      (magic ?? isTextType(type)) && !rest.disabled && !rest.readOnly;

    const setRef = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    return (
      <div className={['relative', containerClassName].filter(Boolean).join(' ')}>
        <input
          ref={setRef}
          type={type}
          className={[className, enabled ? 'pr-9' : ''].filter(Boolean).join(' ')}
          {...rest}
        />
        {enabled && (
          <MagicButton
            busy={busy}
            align='center'
            onClick={() => {
              if (innerRef.current) void runMagic(innerRef.current, setBusy);
            }}
          />
        )}
      </div>
    );
  },
);

// ─── Textarea ─────────────────────────────────────────────────────────────

type MagicTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  magic?: boolean;
  /** Class names applied to the wrapper element (useful for grid/flex spans). */
  containerClassName?: string;
};

export const MagicTextarea = forwardRef<HTMLTextAreaElement, MagicTextareaProps>(
  function MagicTextarea(
    { magic = true, className, containerClassName, ...rest },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    const [busy, setBusy] = useState(false);

    const enabled = magic && !rest.disabled && !rest.readOnly;

    const setRef = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    };

    return (
      <div className={['relative', containerClassName].filter(Boolean).join(' ')}>
        <textarea
          ref={setRef}
          className={[className, enabled ? 'pr-9' : ''].filter(Boolean).join(' ')}
          {...rest}
        />
        {enabled && (
          <MagicButton
            busy={busy}
            align='top'
            onClick={() => {
              if (innerRef.current) void runMagic(innerRef.current, setBusy);
            }}
          />
        )}
      </div>
    );
  },
);

import { useMemo, useState, useRef, useEffect } from 'react';
import { formatCurrency } from '../../shared/format';
import { MagicInput } from '../../client/magic';

export const TPS = 0.05;
export const TVQ = 0.09975;

export type LineItem = { description: string; note?: string; quantity: number; unitPrice: number };

export type PriceItemLike = {
  id: string;
  name: string;
  description?: string | null;
  unitPrice: number;
  code?: string | null;
  category?: string | null;
};

function CatalogPicker({
  priceItems,
  onPick,
}: {
  priceItems: PriceItemLike[];
  onPick: (item: PriceItemLike) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return priceItems;
    return priceItems.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.code?.toLowerCase().includes(q) ?? false) ||
        (it.category?.toLowerCase().includes(q) ?? false) ||
        (it.description?.toLowerCase().includes(q) ?? false),
    );
  }, [priceItems, q]);

  const grouped = useMemo(() => {
    const groups: Record<string, PriceItemLike[]> = {};
    for (const it of filtered) {
      const cat = it.category || 'Sans catégorie';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(it);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className='relative' ref={containerRef}>
      <button
        type='button'
        className='btn-secondary text-sm flex items-center gap-1'
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
      >
        <svg className='w-3.5 h-3.5' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
          <path strokeLinecap='round' strokeLinejoin='round' d='M4 6h16M4 12h16M4 18h7' />
        </svg>
        Depuis le catalogue
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
          <path strokeLinecap='round' strokeLinejoin='round' d='M19 9l-7 7-7-7' />
        </svg>
      </button>

      {open && (
        <div className='absolute left-0 top-full mt-1 z-50 bg-surface border border-line rounded-lg shadow-lg w-80 flex flex-col max-h-72'>
          <div className='p-2 border-b border-line'>
            <input
              ref={searchRef}
              className='input text-sm py-1.5 w-full'
              placeholder='Rechercher…'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className='overflow-y-auto flex-1'>
            {grouped.length === 0 ? (
              <p className='text-sm text-muted px-3 py-4 text-center'>Aucun résultat</p>
            ) : (
              grouped.map(([cat, catItems]) => (
                <div key={cat}>
                  <div className='px-3 py-1.5 text-xs font-semibold text-muted uppercase tracking-wider bg-canvas sticky top-0'>
                    {cat}
                  </div>
                  {catItems.map((it) => (
                    <button
                      key={it.id}
                      type='button'
                      className='w-full text-left px-3 py-2 hover:bg-accent/10 flex justify-between items-center gap-2 text-sm'
                      onClick={() => {
                        onPick(it);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <span className='truncate'>
                        {it.code && <span className='text-muted mr-1 font-mono text-xs'>[{it.code}]</span>}
                        {it.name}
                        {it.description && <span className='text-muted text-xs ml-1'>— {it.description}</span>}
                      </span>
                      <span className='shrink-0 font-medium text-accent tabular-nums'>
                        {formatCurrency(it.unitPrice)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ItemsEditor({
  items,
  setItems,
  priceItems,
  onAddToCatalogue,
}: {
  items: LineItem[];
  setItems: (i: LineItem[]) => void;
  priceItems?: PriceItemLike[];
  onAddToCatalogue?: (name: string, description: string | null) => Promise<void>;
}) {
  const [savedFingerprints, setSavedFingerprints] = useState<Set<string>>(new Set());

  const fingerprint = (it: LineItem) =>
    `${it.description.trim().toLowerCase()}|${it.unitPrice}`;

  const update = (idx: number, patch: Partial<LineItem>) => {
    const oldFp = fingerprint(items[idx]);
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    setItems(next);
    if ('description' in patch || 'unitPrice' in patch) {
      setSavedFingerprints((prev) => {
        const s = new Set(prev);
        s.delete(oldFp);
        return s;
      });
    }
  };

  const handlePick = (found: PriceItemLike) => {
    setItems([
      ...items,
      {
        description: found.name,
        note: found.description || '',
        quantity: 1,
        unitPrice: found.unitPrice,
      },
    ]);
  };

  return (
    <div>
      <div className='label mb-2'>Items</div>
      {/* Column headers */}
      <div className='hidden sm:grid sm:grid-cols-12 gap-2 mb-1 px-0.5'>
        <span className='col-span-6 text-xs text-muted'>Description</span>
        <span className='col-span-2 text-xs text-muted'>Qté</span>
        <span className='col-span-3 text-xs text-muted'>Prix unitaire</span>
      </div>
      <div className='space-y-2'>
        {items.map((it, idx) => (
          <div key={idx} className='rounded-lg border border-line bg-surface p-2 space-y-1.5'>
            {/* Main row */}
            <div className='flex flex-col sm:grid sm:grid-cols-12 gap-2'>
              <MagicInput
                containerClassName='sm:col-span-6'
                className='input'
                placeholder='Nom / Description'
                value={it.description}
                onChange={(e) => update(idx, { description: e.target.value })}
              />
              <div className='flex gap-2 sm:contents'>
                <input
                  type='number'
                  step='0.01'
                  className='input sm:col-span-2 flex-1'
                  placeholder='Qté'
                  value={it.quantity}
                  onChange={(e) => update(idx, { quantity: parseFloat(e.target.value) || 0 })}
                />
                <input
                  type='number'
                  step='0.01'
                  className='input sm:col-span-3 flex-[2]'
                  placeholder='Prix unitaire'
                  value={it.unitPrice}
                  onChange={(e) => update(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                />
                <div className='flex items-center gap-0.5 sm:col-span-1 shrink-0 justify-end'>
                  {onAddToCatalogue && it.description.trim() && (() => {
                    const fp = fingerprint(it);
                    const alreadyIn = !!priceItems?.some(
                      (p) => p.name.trim().toLowerCase() === it.description.trim().toLowerCase()
                    );
                    const justSaved = savedFingerprints.has(fp);
                    const saved = alreadyIn || justSaved;
                    return (
                      <button
                        type='button'
                        title={alreadyIn ? 'Déjà dans le catalogue' : justSaved ? 'Ajouté au catalogue' : 'Sauvegarder dans le catalogue'}
                        disabled={saved}
                        className={`btn-ghost p-1 shrink-0 ${saved ? 'text-muted opacity-50 cursor-default' : 'text-accent'}`}
                        onClick={async () => {
                          const fp = fingerprint(it);
                          await onAddToCatalogue(it.description.trim(), it.note?.trim() || null);
                          setSavedFingerprints((prev) => new Set(prev).add(fp));
                        }}
                      >
                        <svg className='w-3.5 h-3.5' fill={saved ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' d='M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z' />
                        </svg>
                      </button>
                    );
                  })()}
                  <button
                    type='button'
                    className='btn-ghost text-danger shrink-0 p-1'
                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
            {/* Note sub-row */}
            <MagicInput
              className='input text-sm w-full'
              placeholder='Note / détails (optionnel)'
              value={it.note || ''}
              onChange={(e) => update(idx, { note: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className='flex items-center gap-2 mt-3 pt-3 border-t border-line'>
        <button
          type='button'
          className='btn-secondary text-sm flex items-center gap-1'
          onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}
        >
          <svg className='w-3.5 h-3.5' fill='none' stroke='currentColor' strokeWidth='2.5' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' d='M12 4v16m8-8H4' />
          </svg>
          Ajouter un item
        </button>
        {priceItems && priceItems.length > 0 && (
          <CatalogPicker priceItems={priceItems} onPick={handlePick} />
        )}
      </div>

    </div>
  );
}

export function TotalsDisplay({
  items,
  discount,
}: {
  items: LineItem[];
  discount?: { type: 'percent' | 'amount'; value: number };
}) {
  const totals = useMemo(() => {
    const itemsTotal = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    let discountAmount = 0;
    if (discount && discount.value > 0) {
      if (discount.type === 'percent') {
        discountAmount = itemsTotal * Math.min(discount.value, 100) / 100;
      } else {
        discountAmount = Math.min(discount.value, itemsTotal);
      }
    }
    const sub = itemsTotal - discountAmount;
    return { itemsTotal, discountAmount, sub, gst: sub * TPS, qst: sub * TVQ, total: sub * (1 + TPS + TVQ) };
  }, [items, discount]);

  const showDiscount = totals.discountAmount > 0;

  return (
    <div className='border-t border-line pt-4 grid grid-cols-2 gap-2 text-sm'>
      {showDiscount && (
        <>
          <div className='text-muted'>Sous-total items</div>
          <div className='text-right'>{formatCurrency(totals.itemsTotal)}</div>
          <div className='text-muted'>
            Rabais
            {discount?.type === 'percent' ? ` (${discount.value} %)` : ''}
          </div>
          <div className='text-right text-success'>−{formatCurrency(totals.discountAmount)}</div>
        </>
      )}
      <div className='text-muted'>{showDiscount ? 'Sous-total après rabais' : 'Sous-total'}</div>
      <div className='text-right'>{formatCurrency(totals.sub)}</div>
      <div className='text-muted'>TPS (5 %)</div>
      <div className='text-right'>{formatCurrency(totals.gst)}</div>
      <div className='text-muted'>TVQ (9,975 %)</div>
      <div className='text-right'>{formatCurrency(totals.qst)}</div>
      <div className='font-semibold border-t border-line pt-2'>Total</div>
      <div className='font-semibold border-t border-line pt-2 text-right'>
        {formatCurrency(totals.total)}
      </div>
    </div>
  );
}

/**
 * Normalize items for server submission: ensure numbers and trimmed description.
 * Returns null when any item is missing a description.
 */
export function prepareItemsForSubmit(items: LineItem[]): LineItem[] | null {
  if (items.some((i) => !i.description.trim())) {
    return null;
  }
  return items.map((i) => ({
    description: i.description.trim(),
    note: i.note?.trim() || undefined,
    quantity: +i.quantity,
    unitPrice: +i.unitPrice,
  }));
}

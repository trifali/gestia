import { useMemo, useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
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

function CatalogPanel({
  priceItems,
  onPick,
  onClose,
  selectedIds,
}: {
  priceItems: PriceItemLike[];
  onPick: (item: PriceItemLike) => void;
  onClose: () => void;
  selectedIds: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const it of priceItems) cats.add(it.category || 'Sans catégorie');
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [priceItems]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = priceItems;
    if (activeCategory) list = list.filter((it) => (it.category || 'Sans catégorie') === activeCategory);
    if (!q) return list;
    return list.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.code?.toLowerCase().includes(q) ?? false) ||
        (it.category?.toLowerCase().includes(q) ?? false) ||
        (it.description?.toLowerCase().includes(q) ?? false),
    );
  }, [priceItems, q, activeCategory]);

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
    <div className='rounded-xl border border-line bg-white shadow-sm mt-3 flex flex-col overflow-hidden'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-line bg-canvas'>
        <span className='text-sm font-semibold'>Catalogue</span>
        <button type='button' onClick={onClose} className='text-muted hover:text-ink p-1 rounded-md'>
          <svg className='w-4 h-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth='2'>
            <path strokeLinecap='round' strokeLinejoin='round' d='M6 6l12 12M6 18L18 6' />
          </svg>
        </button>
      </div>

      {/* Search + category chips */}
      <div className='px-4 pt-3 pb-2 border-b border-line space-y-2 bg-white'>
        <div className='relative'>
          <svg className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' d='M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z' />
          </svg>
          <input
            ref={searchRef}
            className='input pl-9 w-full text-sm'
            placeholder='Rechercher par nom, code ou description…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {categories.length > 1 && (
          <div className='flex flex-wrap gap-1.5'>
            <button
              type='button'
              onClick={() => setActiveCategory(null)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                activeCategory === null
                  ? 'bg-accent text-white border-accent'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              Tous
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type='button'
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                  activeCategory === cat
                    ? 'bg-accent text-white border-accent'
                    : 'border-line text-muted hover:text-ink'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className='overflow-y-auto bg-white px-4 py-3' style={{ maxHeight: '280px' }}>
        {grouped.length === 0 ? (
          <p className='text-sm text-muted text-center py-6'>Aucun résultat</p>
        ) : (
          <div className='space-y-4'>
            {grouped.map(([cat, catItems]) => (
              <div key={cat}>
                {grouped.length > 1 && (
                  <div className='text-xs font-semibold text-muted uppercase tracking-wider mb-1.5'>{cat}</div>
                )}
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  {catItems.map((it) => {
                    const isSelected = selectedIds.has(it.id);
                    return (
                    <button
                      key={it.id}
                      type='button'
                      onClick={() => { onPick(it); }}
                      className={`relative text-left rounded-lg border-2 transition-colors p-3 w-full ${
                        isSelected
                          ? 'border-accent bg-accent/8 hover:bg-accent/15'
                          : 'border-line bg-canvas hover:border-accent/60 hover:bg-accent/5'
                      }`}
                    >
                      {isSelected && (
                        <span className='absolute -top-2 -right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm z-10'>
                          <svg className='w-3 h-3 text-white' fill='none' stroke='currentColor' strokeWidth='3' viewBox='0 0 24 24'>
                            <path strokeLinecap='round' strokeLinejoin='round' d='M5 13l4 4L19 7' />
                          </svg>
                        </span>
                      )}
                      <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0'>
                          <div className='font-medium text-sm leading-snug'>
                            {it.code && (
                              <span className='text-muted font-mono text-xs mr-1.5'>[{it.code}]</span>
                            )}
                            {it.name}
                          </div>
                          {it.description && (
                            <div className='text-xs text-muted mt-0.5 line-clamp-2'>{it.description}</div>
                          )}
                        </div>
                        <div className='shrink-0 font-semibold text-sm text-accent tabular-nums'>
                          {formatCurrency(it.unitPrice)}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='px-4 py-2 border-t border-line bg-canvas text-xs text-muted'>
        {filtered.length} article{filtered.length !== 1 ? 's' : ''}
        {priceItems.length !== filtered.length && ` sur ${priceItems.length}`}
      </div>
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
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Catalog item IDs currently present in the line items (matched by name)
  const selectedCatalogIds = useMemo(() => {
    if (!priceItems) return new Set<string>();
    const nameSet = new Set(items.map((i) => i.description.trim().toLowerCase()));
    return new Set(priceItems.filter((p) => nameSet.has(p.name.trim().toLowerCase())).map((p) => p.id));
  }, [items, priceItems]);

  const handleCatalogPick = (found: PriceItemLike) => {
    const isSelected = selectedCatalogIds.has(found.id);
    if (isSelected) {
      // Remove the last line item whose description matches
      const matchName = found.name.trim().toLowerCase();
      const lastIdx = [...items].map((i, idx) => ({ i, idx })).reverse()
        .find(({ i }) => i.description.trim().toLowerCase() === matchName)?.idx;
      if (lastIdx !== undefined) {
        setItems(items.filter((_, i) => i !== lastIdx));
        toast.success(`« ${found.name} » retiré`, { duration: 2000 });
      }
    } else {
      setItems([
        ...items,
        { description: found.name, note: found.description || '', quantity: 1, unitPrice: found.unitPrice },
      ]);
      toast.success(`« ${found.name} » ajouté`, { duration: 2000 });
    }
  };

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

  return (
    <div>
      {/* Toolbar */}
      <div className='flex items-center justify-between mb-3'>
        <div className='label mb-0'>Items</div>
        <div className='flex items-center gap-2'>
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
            <button
              type='button'
              className={`btn-secondary text-sm flex items-center gap-1 ${catalogOpen ? 'ring-1 ring-accent' : ''}`}
              onClick={() => setCatalogOpen((v) => !v)}
            >
              <svg className='w-3.5 h-3.5' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' d='M4 6h16M4 12h16M4 18h7' />
              </svg>
              Catalogue
              <svg className={`w-3 h-3 transition-transform ${catalogOpen ? 'rotate-180' : ''}`} fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' d='M19 9l-7 7-7-7' />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Catalog panel — above items so it doesn't shift when list grows */}
      {catalogOpen && priceItems && priceItems.length > 0 && (
        <CatalogPanel
          priceItems={priceItems}
          selectedIds={selectedCatalogIds}
          onPick={handleCatalogPick}
          onClose={() => setCatalogOpen(false)}
        />
      )}

      {/* Items area */}
      <div className='mt-3 rounded-xl border-2 border-dashed border-line bg-canvas-50 p-3'>
        {items.length === 0 ? (
          <p className='text-sm text-muted text-center py-4'>
            Aucun item. Utilisez les boutons ci-dessus pour ajouter des items.
          </p>
        ) : (
          <>
            {/* Column headers */}
            <div className='hidden sm:grid sm:grid-cols-12 gap-2 mb-2 px-0.5'>
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
                    disabled={false}
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
          </>
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

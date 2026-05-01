import { useMemo } from 'react';
import { formatCurrency } from '../../shared/format';

export const TPS = 0.05;
export const TVQ = 0.09975;

export type LineItem = { description: string; quantity: number; unitPrice: number };

export function ItemsEditor({
  items,
  setItems,
}: {
  items: LineItem[];
  setItems: (i: LineItem[]) => void;
}) {
  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    setItems(next);
  };

  return (
    <div>
      <div className='label'>Items</div>
      <div className='space-y-2'>
        {items.map((it, idx) => (
          <div key={idx} className='flex flex-col sm:grid sm:grid-cols-12 gap-2'>
            <input
              className='input sm:col-span-6'
              placeholder='Description'
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
              <button
                type='button'
                className='btn-ghost sm:col-span-1 text-danger shrink-0'
                onClick={() => setItems(items.filter((_, i) => i !== idx))}
                disabled={items.length === 1}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type='button'
        className='btn-secondary mt-2 text-sm'
        onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}
      >
        + Ajouter un item
      </button>
    </div>
  );
}

export function TotalsDisplay({ items }: { items: LineItem[] }) {
  const totals = useMemo(() => {
    const sub = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    return { sub, gst: sub * TPS, qst: sub * TVQ, total: sub * (1 + TPS + TVQ) };
  }, [items]);

  return (
    <div className='border-t border-line pt-4 grid grid-cols-2 gap-2 text-sm'>
      <div className='text-muted'>Sous-total</div>
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
 * Returns null with an alert if any item is missing a description.
 */
export function prepareItemsForSubmit(items: LineItem[]): LineItem[] | null {
  if (items.some((i) => !i.description.trim())) {
    alert('Chaque item doit avoir une description.');
    return null;
  }
  return items.map((i) => ({
    description: i.description.trim(),
    quantity: +i.quantity,
    unitPrice: +i.unitPrice,
  }));
}

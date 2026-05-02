// Branded PDF generator for quotes / invoices.
// Uses pdfmake on the client. Brand (logo + colors + tagline) comes from
// the connected company, fetched separately via getCompanyBrandAssets.

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, ContextPageSize } from 'pdfmake/interfaces';
import { formatCurrency, formatDate, formatNumber } from '../../shared/format';

// pdfmake VFS bootstrapping (Roboto bundled).
const _vfs: any = (pdfFonts as any).default ?? (pdfFonts as any).vfs ?? pdfFonts;
(pdfMake as any).vfs = _vfs;

// ---------- Default palette (used when company brand is unset) ----------
const DEFAULT_PRIMARY = '#0E0E0E';
const DEFAULT_ACCENT = '#D4A24C';
const DEFAULT_TEXT = '#1A1A1A';
const CREAM = '#F5EFE1';
const GREY = '#555555';
const GREY_LT = '#9A9A9A';
const WHITE = '#FFFFFF';

// ---------- Types ----------
type Item = {
  description: string;
  note?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type DocForPdf = {
  id: string;
  type: 'quote' | 'invoice' | string;
  number: string;
  title?: string | null;
  description?: string | null;
  status: string;
  issueDate: Date | string;
  validUntil?: Date | string | null;
  dueDate?: Date | string | null;
  discountType: string;
  discountValue: number;
  subtotal: number;
  taxGst: number;
  taxQst: number;
  total: number;
  amountPaid: number;
  notes?: string | null;
  items: Item[];
  client: {
    name: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  };
  project?: { name: string } | null;
};

export type CompanyForPdf = {
  name: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  website?: string | null;
  taxNumberGst?: string | null;
  taxNumberQst?: string | null;
} | null;

export type BrandAssets = {
  logoDataUrl: string | null;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  tagline: string | null;
} | null;

// ---------- Helpers ----------
function joinAddress(p: {
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  const line2 = [p.city, p.province, p.postalCode].filter(Boolean).join(', ');
  return [p.address, line2, p.country].filter(Boolean).join(' • ');
}

function watermarkForStatus(status: string): { text: string; lightColor: string; darkColor: string; opacity: number } | null {
  if (status === 'brouillon') {
    return { text: 'BROUILLON', lightColor: '#FFFFFF', darkColor: '#1A1A1A', opacity: 0.18 };
  }
  if (status === 'expire') {
    return { text: 'EXPIRÉ', lightColor: '#FF6B6B', darkColor: '#C0392B', opacity: 0.22 };
  }
  return null;
}

function docKindLabel(type: string): { word: string; titre: string; refLabel: string } {
  if (type === 'invoice') {
    return { word: 'FACTURE', titre: 'Facture.', refLabel: 'N° facture' };
  }
  return { word: 'DEVIS', titre: 'Proposition\ncommerciale.', refLabel: 'Référence' };
}

type Theme = {
  primary: string;
  accent: string;
  text: string;
  cream: string;
  grey: string;
  greyLt: string;
  white: string;
  zebra: string;
};

function buildTheme(brand: BrandAssets): Theme {
  return {
    primary: brand?.primaryColor || DEFAULT_PRIMARY,
    accent: brand?.accentColor || DEFAULT_ACCENT,
    text: brand?.textColor || DEFAULT_TEXT,
    cream: CREAM,
    grey: GREY,
    greyLt: GREY_LT,
    white: WHITE,
    zebra: '#FAF6EC',
  };
}

// ---------- Cover (page 1) ----------
function buildCover(doc: DocForPdf, company: CompanyForPdf, brand: BrandAssets, t: Theme): Content[] {
  const kind = docKindLabel(doc.type);
  const eyebrow = `${doc.type === 'invoice' ? 'Facture' : 'Devis'} ${doc.number}`;
  const tagline =
    doc.description?.trim() ||
    doc.title?.trim() ||
    brand?.tagline ||
    (doc.type === 'invoice'
      ? 'Détail des services rendus et montant total à régler.'
      : 'Proposition commerciale détaillée et transparente.');

  const meta: Array<[string, string]> = [];
  meta.push([doc.type === 'invoice' ? 'Facturé à' : 'Préparé pour', doc.client.name]);
  if (doc.client.contactName) meta.push(['Contact', doc.client.contactName]);
  meta.push(['Date', formatDate(doc.issueDate)]);
  if (doc.validUntil) {
    meta.push(['Valide jusqu’au', formatDate(doc.validUntil)]);
  }
  if (doc.dueDate) {
    meta.push(['Échéance', formatDate(doc.dueDate)]);
  }
  meta.push([kind.refLabel, doc.number]);

  const titleLines = kind.titre.split('\n');

  // Top of page: logo OR company name big
  const topBlock: Content = brand?.logoDataUrl
    ? { image: brand.logoDataUrl, fit: [180, 70], margin: [0, 30, 0, 60] }
    : {
        text: (company?.legalName || company?.name || '').toUpperCase(),
        color: t.white,
        bold: true,
        fontSize: 18,
        characterSpacing: 3,
        margin: [0, 30, 0, 60],
      };

  return [
    topBlock,
    {
      text: eyebrow.toUpperCase(),
      color: t.accent,
      bold: true,
      fontSize: 10,
      characterSpacing: 3,
      margin: [0, 0, 0, 14],
    },
    {
      text: [
        { text: titleLines[0], color: t.white },
        ...(titleLines[1] ? [{ text: '\n' + titleLines[1], color: t.accent }] : []),
      ],
      fontSize: 44,
      bold: true,
      lineHeight: 1.05,
      margin: [0, 0, 0, 18],
    },
    {
      text: tagline,
      color: t.cream,
      italics: true,
      fontSize: 12,
      margin: [0, 0, 0, 50],
    },
    {
      table: {
        widths: ['*', '*'],
        body: chunkPairs(meta).map((pair) =>
          pair.map((entry) =>
            entry
              ? {
                  stack: [
                    { text: entry[0].toUpperCase(), color: t.accent, bold: true, fontSize: 8, characterSpacing: 2 },
                    { text: entry[1], color: t.white, fontSize: 11, margin: [0, 4, 0, 0] },
                  ],
                  border: [false, false, false, false],
                  margin: [0, 0, 0, 14],
                }
              : { text: '', border: [false, false, false, false] },
          ),
        ),
      },
      layout: 'noBorders',
    },
    {
      text: footerLine(company),
      color: t.greyLt,
      fontSize: 8,
      characterSpacing: 1,
      margin: [0, 60, 0, 0],
    },
    { text: '', pageBreak: 'after' },
  ];
}

function footerLine(company: CompanyForPdf): string {
  const parts: string[] = [];
  if (company?.legalName || company?.name) parts.push(company!.legalName || company!.name);
  if (company?.email) parts.push(company.email);
  if (company?.website) parts.push(company.website);
  return parts.join('  •  ');
}

function chunkPairs<T>(arr: T[]): (T | null)[][] {
  const out: (T | null)[][] = [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push([arr[i], arr[i + 1] ?? null]);
  }
  return out;
}

// ---------- Section heading ----------
function sectionHeading(eyebrow: string, title: string, t: Theme): Content {
  return {
    stack: [
      { text: eyebrow.toUpperCase(), color: t.accent, bold: true, fontSize: 8, characterSpacing: 3, margin: [0, 0, 0, 4] },
      { text: title, color: t.text, bold: true, fontSize: 18, margin: [0, 0, 0, 10] },
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0, lineWidth: 2, lineColor: t.accent }],
        margin: [0, 0, 0, 14],
      },
    ],
    margin: [0, 18, 0, 0],
  };
}

function subheading(text: string, t: Theme): Content {
  return {
    text: text,
    color: t.accent,
    bold: true,
    fontSize: 10,
    characterSpacing: 2,
    margin: [0, 14, 0, 6],
  };
}

// ---------- Parties ----------
function partiesBlock(company: CompanyForPdf, doc: DocForPdf, t: Theme): Content {
  const fromLines: string[] = [];
  if (company) {
    fromLines.push(company.legalName || company.name);
    const addr = joinAddress(company);
    if (addr) fromLines.push(addr);
    if (company.email) fromLines.push(company.email);
    if (company.phone) fromLines.push(company.phone);
    if (company.taxNumberGst) fromLines.push(`TPS : ${company.taxNumberGst}`);
    if (company.taxNumberQst) fromLines.push(`TVQ : ${company.taxNumberQst}`);
  }

  const toLines: string[] = [];
  toLines.push(doc.client.name);
  if (doc.client.contactName) toLines.push(doc.client.contactName);
  const cAddr = joinAddress(doc.client);
  if (cAddr) toLines.push(cAddr);
  if (doc.client.email) toLines.push(doc.client.email);
  if (doc.client.phone) toLines.push(doc.client.phone);

  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: 'ÉMETTEUR', color: t.accent, bold: true, fontSize: 8, characterSpacing: 2, margin: [0, 0, 0, 6] },
          { text: fromLines[0] || (company?.name ?? ''), bold: true, fontSize: 11, color: t.text, margin: [0, 0, 0, 4] },
          ...fromLines.slice(1).map<Content>((l) => ({ text: l, color: t.grey, fontSize: 9, margin: [0, 0, 0, 2] })),
        ],
      },
      {
        width: '*',
        stack: [
          {
            text: doc.type === 'invoice' ? 'FACTURÉ À' : 'PRÉPARÉ POUR',
            color: t.accent,
            bold: true,
            fontSize: 8,
            characterSpacing: 2,
            margin: [0, 0, 0, 6],
          },
          { text: toLines[0], bold: true, fontSize: 11, color: t.text, margin: [0, 0, 0, 4] },
          ...toLines.slice(1).map<Content>((l) => ({ text: l, color: t.grey, fontSize: 9, margin: [0, 0, 0, 2] })),
        ],
      },
    ],
    columnGap: 24,
    margin: [0, 0, 0, 8],
  };
}

// ---------- Items table ----------
function itemsTable(doc: DocForPdf, t: Theme): Content {
  const headerCell = (text: string, alignment: 'left' | 'right' | 'center' = 'left'): any => ({
    text: text.toUpperCase(),
    color: t.white,
    bold: true,
    fontSize: 9,
    characterSpacing: 1,
    alignment,
    fillColor: t.primary,
    margin: [8, 8, 8, 8],
  });

  const body: any[][] = [
    [
      headerCell('Description'),
      headerCell('Qté', 'right'),
      headerCell('Prix unitaire', 'right'),
      headerCell('Total', 'right'),
    ],
  ];

  doc.items.forEach((it, idx) => {
    const fill = idx % 2 === 1 ? t.zebra : t.white;
    const desc: Content = it.note
      ? {
          stack: [
            { text: it.description, color: t.text, fontSize: 10 },
            { text: it.note, color: t.grey, fontSize: 8, italics: true, margin: [0, 2, 0, 0] },
          ],
        }
      : { text: it.description, color: t.text, fontSize: 10 };
    body.push([
      cellWith(desc, fill),
      cellWith({ text: formatNumber(it.quantity, it.quantity % 1 === 0 ? 0 : 2), color: t.text, fontSize: 10, alignment: 'right' }, fill),
      cellWith({ text: formatCurrency(it.unitPrice), color: t.text, fontSize: 10, alignment: 'right' }, fill),
      cellWith({ text: formatCurrency(it.amount), color: t.text, fontSize: 10, alignment: 'right', bold: true }, fill),
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: ['*', 40, 80, 80],
      body,
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
    margin: [0, 4, 0, 0],
  };
}

function cellWith(content: Content, fill: string): any {
  return { ...(content as any), fillColor: fill };
}

// ---------- Totals card ----------
function totalsCard(doc: DocForPdf, t: Theme): Content {
  const rows: Array<[string, string, boolean]> = [];
  // Items total = sum of line amounts. doc.subtotal is already AFTER discount,
  // so we recompute the pre-discount figure to display the discount clearly.
  const itemsTotal = +doc.items.reduce((s, it) => s + (it.amount || 0), 0).toFixed(2);
  const hasDiscount = !!doc.discountValue && doc.discountValue > 0;
  const discountAmount = hasDiscount ? +(itemsTotal - doc.subtotal).toFixed(2) : 0;

  if (hasDiscount) {
    rows.push(['Sous-total avant remise', formatCurrency(itemsTotal), false]);
    const label =
      doc.discountType === 'percent'
        ? `Remise (${formatNumber(doc.discountValue, 2)} %)`
        : 'Remise';
    rows.push([label, '− ' + formatCurrency(discountAmount), false]);
    rows.push(['Sous-total après remise', formatCurrency(doc.subtotal), false]);
  } else {
    rows.push(['Sous-total', formatCurrency(doc.subtotal), false]);
  }
  if (doc.taxGst > 0) rows.push(['TPS (5 %)', formatCurrency(doc.taxGst), false]);
  if (doc.taxQst > 0) rows.push(['TVQ (9,975 %)', formatCurrency(doc.taxQst), false]);
  rows.push([doc.type === 'invoice' ? 'Total à payer' : 'Total estimé', formatCurrency(doc.total), true]);
  if (doc.type === 'invoice' && doc.amountPaid > 0) {
    rows.push(['Déjà payé', formatCurrency(doc.amountPaid), false]);
    rows.push(['Solde restant', formatCurrency(doc.total - doc.amountPaid), true]);
  }

  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 260,
        table: {
          widths: ['*', 'auto'],
          body: rows.map(([label, value, emphasize]) => [
            {
              text: label,
              fontSize: emphasize ? 11 : 9,
              bold: emphasize,
              color: emphasize ? t.white : t.text,
              fillColor: emphasize ? t.primary : t.zebra,
              margin: [10, 8, 10, 8],
              border: [false, false, false, false],
            },
            {
              text: value,
              alignment: 'right',
              fontSize: emphasize ? 12 : 10,
              bold: true,
              color: emphasize ? t.accent : t.text,
              fillColor: emphasize ? t.primary : t.zebra,
              margin: [10, 8, 10, 8],
              border: [false, false, false, false],
            },
          ]),
        },
        layout: 'noBorders',
      },
    ],
    margin: [0, 14, 0, 0],
  };
}

// ---------- Closing card ----------
function closingCard(doc: DocForPdf, company: CompanyForPdf, t: Theme): Content {
  const isInvoice = doc.type === 'invoice';
  const title = isInvoice ? 'Merci pour votre confiance.' : 'Prêt(e) à démarrer ?';
  const contact = company?.email || '';
  const message = isInvoice
    ? `Pour toute question concernant cette facture, écrivez-nous${contact ? ' à ' + contact : ''}.`
    : `Un appel rapide suffit pour valider la proposition. Écrivez-nous${contact ? ' à ' + contact : ''}.`;

  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              { text: title, color: t.white, bold: true, fontSize: 16, margin: [0, 0, 0, 6] },
              { text: message, color: t.cream, fontSize: 10 },
            ],
            fillColor: t.primary,
            margin: [22, 22, 22, 22],
            border: [false, false, false, false],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 30, 0, 0],
  };
}

// ---------- Build full doc definition ----------
function buildDocDefinition(doc: DocForPdf, company: CompanyForPdf, brand: BrandAssets): TDocumentDefinitions {
  const kind = docKindLabel(doc.type);
  const watermark = watermarkForStatus(doc.status);
  const t = buildTheme(brand);

  const cover = buildCover(doc, company, brand, t);

  const content: Content[] = [
    ...cover,
    sectionHeading('Détails', 'Émetteur & destinataire', t),
    partiesBlock(company, doc, t),
    sectionHeading(
      doc.type === 'invoice' ? 'Détail' : 'Investissement',
      doc.type === 'invoice' ? 'Lignes facturées' : 'Lignes de la proposition',
      t,
    ),
    ...(doc.title ? [{ text: doc.title, color: t.text, bold: true, fontSize: 12, margin: [0, 0, 0, 8] } as Content] : []),
    itemsTable(doc, t),
    totalsCard(doc, t),
  ];

  if (doc.notes && doc.notes.trim()) {
    content.push(subheading('Notes', t));
    content.push({ text: doc.notes, color: t.grey, fontSize: 10, lineHeight: 1.4 });
  }

  if (doc.type !== 'invoice' && doc.validUntil) {
    content.push(subheading('Validité', t));
    content.push({
      text: `Cette proposition est valide jusqu’au ${formatDate(doc.validUntil)}.`,
      color: t.grey,
      fontSize: 10,
    });
  }

  content.push(closingCard(doc, company, t));

  const background = (currentPage: number, pageSize: ContextPageSize) => {
    if (currentPage === 1) {
      return [
        {
          canvas: [
            {
              type: 'rect',
              x: 0,
              y: 0,
              w: pageSize.width,
              h: pageSize.height,
              color: t.primary,
            },
          ],
        },
      ] as any;
    }
    return [];
  };

  const headerLabel = `${(company?.name || '').toUpperCase()}  •  ${kind.word} ${doc.number}`.replace(/^\s+•\s+/, '');

  return {
    pageSize: 'LETTER',
    pageMargins: [54, 54, 54, 70],
    info: {
      title: `${doc.type === 'invoice' ? 'Facture' : 'Devis'} ${doc.number}`,
      author: company?.name || 'Gestia',
      subject: doc.title || `${kind.word} ${doc.number}`,
    },
    background,
    header: (currentPage: number, _pageCount: number, pageSize: ContextPageSize) => {
      const items: any[] = [];
      if (watermark) {
        const color = currentPage === 1 ? watermark.lightColor : watermark.darkColor;
        const cx = pageSize.width / 2;
        const cy = pageSize.height / 2;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageSize.width}" height="${pageSize.height}"><text x="${cx}" y="${cy}" font-family="Helvetica, Arial, sans-serif" font-size="90" font-weight="bold" letter-spacing="6" fill="${color}" fill-opacity="${watermark.opacity}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-30 ${cx} ${cy})">${watermark.text}</text></svg>`;
        items.push({ svg, width: pageSize.width, absolutePosition: { x: 0, y: 0 } });
      }
      if (currentPage > 1) {
        items.push({
          text: headerLabel,
          alignment: 'right',
          color: t.accent,
          bold: true,
          fontSize: 8,
          characterSpacing: 2,
          margin: [54, 24, 54, 0],
        });
      }
      if (items.length === 0) return null as any;
      if (items.length === 1) return items[0];
      return { stack: items };
    },
    footer: (currentPage: number, pageCount: number) => {
      if (currentPage === 1) return null as any;
      const left = [company?.name, company?.email].filter(Boolean).join('  |  ');
      return {
        columns: [
          { text: left, alignment: 'left', color: t.grey, fontSize: 8, margin: [54, 0, 0, 0] },
          { text: `Page ${currentPage} / ${pageCount}`, alignment: 'right', color: t.grey, fontSize: 8, margin: [0, 0, 54, 0] },
        ],
        margin: [0, 24, 0, 0],
      };
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      color: t.text,
    },
    content,
  };
}

// ---------- Public API ----------
export function downloadDocumentPdf(
  doc: DocForPdf,
  company: CompanyForPdf,
  brand: BrandAssets,
): void {
  const def = buildDocDefinition(doc, company, brand);
  const fileBase = doc.type === 'invoice' ? 'Facture' : 'Devis';
  const name = `${fileBase}-${doc.number}${doc.status === 'brouillon' ? '-BROUILLON' : doc.status === 'expire' ? '-EXPIRE' : ''}.pdf`;
  pdfMake.createPdf(def).download(name);
}

// Branded price-catalog PDF generator (client-side, pdfmake).
// Shares the cover / theme / section language of the quote & invoice PDFs so a
// catalog handed to a reseller looks like it came from the same house.

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, ContextPageSize } from 'pdfmake/interfaces';
import { formatCurrency, formatDate } from '../../shared/format';
import {
  buildTheme,
  chunkPairs,
  footerLine,
  joinAddress,
  sectionHeading,
  subheading,
} from '../documents/pdf';
import type { BrandAssets, CompanyForPdf, Theme } from '../documents/pdf';

// pdfmake VFS bootstrapping (Roboto bundled).
const _vfs: any = (pdfFonts as any).default ?? (pdfFonts as any).vfs ?? pdfFonts;
(pdfMake as any).vfs = _vfs;

const UNCATEGORIZED = 'Sans catégorie';

// ---------- Types ----------
export type CatalogItemForPdf = {
  code?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  unitPrice: number;
  isActive?: boolean;
};

export type CatalogPdfOptions = {
  /** Cover title. Two lines max — the second one is painted in the accent color. */
  title?: string | null;
  /** Italic line under the cover title. Falls back to the brand tagline. */
  intro?: string | null;
  /** Shown as « Préparé pour » on the cover, e.g. the reseller's name. */
  recipient?: string | null;
  /** Date after which the prices are no longer guaranteed. */
  validUntil?: Date | string | null;
  groupByCategory?: boolean;
  showDescriptions?: boolean;
  showCodes?: boolean;
  /** Category recap table before the detailed grid (grouped mode only). */
  showSummary?: boolean;
  /** Free-form paragraph appended to the conditions section. */
  notes?: string | null;
  /** Issue date printed on the cover. Defaults to today. */
  issueDate?: Date | string;
};

type Group = { name: string; items: CatalogItemForPdf[] };

// ---------- Helpers ----------
const UNIT_LABELS: Record<string, string> = {
  unite: 'Unité',
  unité: 'Unité',
  heure: 'Heure',
  jour: 'Jour',
  semaine: 'Semaine',
  mois: 'Mois',
  forfait: 'Forfait',
  km: 'km',
  m2: 'm²',
  m3: 'm³',
  ml: 'm. lin.',
  pi2: 'pi²',
  pi: 'pi',
  lot: 'Lot',
};

function unitLabel(unit?: string | null): string {
  const raw = (unit || '').trim();
  if (!raw) return '—';
  const known = UNIT_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function groupItems(items: CatalogItemForPdf[], groupByCategory: boolean): Group[] {
  if (!groupByCategory) return [{ name: '', items }];

  const buckets = new Map<string, CatalogItemForPdf[]>();
  for (const it of items) {
    const key = (it.category || '').trim() || UNCATEGORIZED;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(it);
    else buckets.set(key, [it]);
  }

  return Array.from(buckets.entries())
    .map(([name, list]) => ({ name, items: list }))
    .sort((a, b) => {
      // « Sans catégorie » always lands at the bottom.
      if (a.name === UNCATEGORIZED) return 1;
      if (b.name === UNCATEGORIZED) return -1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
}

// ---------- Cover (page 1) ----------
function buildCover(
  items: CatalogItemForPdf[],
  groups: Group[],
  company: CompanyForPdf,
  brand: BrandAssets,
  opts: CatalogPdfOptions,
  t: Theme,
): Content[] {
  const titleLines = (opts.title?.trim() || 'Catalogue\nde prix.').split('\n');
  const tagline =
    opts.intro?.trim() ||
    brand?.tagline ||
    'Grille tarifaire officielle — services et produits offerts.';

  const meta: Array<[string, string]> = [];
  if (opts.recipient?.trim()) meta.push(['Préparé pour', opts.recipient.trim()]);
  meta.push(['Date d’émission', formatDate(opts.issueDate ?? new Date())]);
  if (opts.validUntil) meta.push(['Prix valides jusqu’au', formatDate(opts.validUntil)]);
  meta.push(['Articles', String(items.length)]);
  if (opts.groupByCategory && groups.length > 1) {
    meta.push(['Catégories', String(groups.length)]);
  }

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
      text: 'CATALOGUE DE PRIX',
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

// ---------- Issuer block ----------
function issuerBlock(company: CompanyForPdf, opts: CatalogPdfOptions, t: Theme): Content {
  const fromLines: string[] = [];
  if (company) {
    const addr = joinAddress(company);
    if (addr) fromLines.push(addr);
    if (company.email) fromLines.push(company.email);
    if (company.phone) fromLines.push(company.phone);
    if (company.website) fromLines.push(company.website);
  }

  const rightLines: string[] = [];
  if (opts.recipient?.trim()) rightLines.push(opts.recipient.trim());
  rightLines.push(`Émis le ${formatDate(opts.issueDate ?? new Date())}`);
  if (opts.validUntil) rightLines.push(`Prix valides jusqu’au ${formatDate(opts.validUntil)}`);

  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: 'ÉMETTEUR', color: t.accent, bold: true, fontSize: 8, characterSpacing: 2, margin: [0, 0, 0, 6] },
          {
            text: company?.legalName || company?.name || '',
            bold: true,
            fontSize: 11,
            color: t.text,
            margin: [0, 0, 0, 4],
          },
          ...fromLines.map<Content>((l) => ({ text: l, color: t.grey, fontSize: 9, margin: [0, 0, 0, 2] })),
        ],
      },
      {
        width: '*',
        stack: [
          {
            text: opts.recipient?.trim() ? 'DESTINATAIRE' : 'VALIDITÉ',
            color: t.accent,
            bold: true,
            fontSize: 8,
            characterSpacing: 2,
            margin: [0, 0, 0, 6],
          },
          { text: rightLines[0], bold: true, fontSize: 11, color: t.text, margin: [0, 0, 0, 4] },
          ...rightLines.slice(1).map<Content>((l) => ({ text: l, color: t.grey, fontSize: 9, margin: [0, 0, 0, 2] })),
        ],
      },
    ],
    columnGap: 24,
    margin: [0, 0, 0, 8],
  };
}

// ---------- Category summary ----------
function summaryTable(groups: Group[], t: Theme): Content {
  const headerCell = (text: string, alignment: 'left' | 'right' = 'left'): any => ({
    text: text.toUpperCase(),
    color: t.white,
    bold: true,
    fontSize: 9,
    characterSpacing: 1,
    alignment,
    fillColor: t.primary,
    margin: [8, 8, 8, 8],
  });

  const body: any[][] = [[headerCell('Catégorie'), headerCell('Articles', 'right'), headerCell('À partir de', 'right')]];

  groups.forEach((g, idx) => {
    const fill = idx % 2 === 1 ? t.zebra : t.white;
    const min = Math.min(...g.items.map((it) => it.unitPrice || 0));
    body.push([
      { text: g.name, color: t.text, fontSize: 10, bold: true, fillColor: fill },
      { text: String(g.items.length), color: t.grey, fontSize: 10, alignment: 'right', fillColor: fill },
      { text: formatCurrency(min), color: t.text, fontSize: 10, alignment: 'right', fillColor: fill },
    ]);
  });

  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, widths: ['*', 74, 100], body },
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

// ---------- Items table (one per category) ----------
function itemsTable(group: Group, opts: CatalogPdfOptions, t: Theme): Content {
  const showCodes = opts.showCodes !== false;
  const showDescriptions = opts.showDescriptions !== false;
  const grouped = !!opts.groupByCategory && !!group.name;

  const headerCell = (text: string, alignment: 'left' | 'right' = 'left'): any => ({
    text: text.toUpperCase(),
    color: t.white,
    bold: true,
    fontSize: 9,
    characterSpacing: 1,
    alignment,
    fillColor: t.primary,
    margin: [8, 8, 8, 8],
  });

  const columnCount = showCodes ? 4 : 3;
  const body: any[][] = [];

  // The category name lives inside the table (spanning row) so it can never be
  // orphaned at the bottom of a page, and it repeats on continuation pages.
  if (grouped) {
    body.push([
      {
        text: group.name.toUpperCase(),
        color: t.primary,
        bold: true,
        fontSize: 10,
        characterSpacing: 2,
        fillColor: t.cream,
        colSpan: columnCount,
        margin: [8, 8, 8, 8],
      },
      ...Array.from({ length: columnCount - 1 }, () => ({ text: '', fillColor: t.cream })),
    ]);
  }

  body.push([
    ...(showCodes ? [headerCell('Code')] : []),
    headerCell('Désignation'),
    headerCell('Unité', 'right'),
    headerCell('Prix unitaire', 'right'),
  ]);

  group.items.forEach((it, idx) => {
    const fill = idx % 2 === 1 ? t.zebra : t.white;
    const desc: Content =
      showDescriptions && it.description?.trim()
        ? {
            stack: [
              { text: it.name, color: t.text, fontSize: 10, bold: true },
              { text: it.description.trim(), color: t.grey, fontSize: 8, italics: true, margin: [0, 2, 0, 0] },
            ],
          }
        : { text: it.name, color: t.text, fontSize: 10, bold: true };

    body.push([
      ...(showCodes
        ? [{ text: it.code || '—', color: t.grey, fontSize: 9, fillColor: fill }]
        : []),
      { ...(desc as any), fillColor: fill },
      { text: unitLabel(it.unit), color: t.grey, fontSize: 9, alignment: 'right', fillColor: fill },
      { text: formatCurrency(it.unitPrice), color: t.text, fontSize: 10, alignment: 'right', bold: true, fillColor: fill },
    ]);
  });

  return {
    table: {
      headerRows: grouped ? 2 : 1,
      // Never leave the category / column headers stranded at a page bottom.
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: showCodes ? [64, '*', 58, 100] : ['*', 58, 100],
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
    margin: [0, 4, 0, 14],
  };
}

// ---------- Conditions ----------
function conditionsSection(company: CompanyForPdf, opts: CatalogPdfOptions, t: Theme): Content[] {
  const lines: string[] = [
    'Tous les prix sont en dollars canadiens (CAD) et indiqués avant les taxes applicables (TPS et TVQ).',
  ];
  if (opts.validUntil) {
    lines.push(`Ces prix sont garantis jusqu’au ${formatDate(opts.validUntil)}. Passé cette date, ils peuvent être révisés sans préavis.`);
  } else {
    lines.push('Les prix peuvent être modifiés sans préavis. Ce document n’est pas une offre contractuelle.');
  }
  if (company?.modalityPaymentTermsDays != null) {
    lines.push(`Conditions de paiement habituelles : net ${company.modalityPaymentTermsDays} jours.`);
  }
  if (opts.notes?.trim()) lines.push(opts.notes.trim());

  return [
    sectionHeading('Conditions', 'À savoir', t),
    ...lines.map<Content>((l) => ({
      text: l,
      color: t.grey,
      fontSize: 9,
      lineHeight: 1.45,
      margin: [0, 0, 0, 6],
    })),
  ];
}

// ---------- Closing card ----------
function closingCard(company: CompanyForPdf, t: Theme): Content {
  const contact = [company?.email, company?.phone].filter(Boolean).join('  •  ');
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              { text: 'Une question sur un prix ?', color: t.white, bold: true, fontSize: 16, margin: [0, 0, 0, 6] },
              {
                text: contact
                  ? `Contactez-nous : ${contact}`
                  : 'Contactez-nous pour toute demande de soumission personnalisée.',
                color: t.cream,
                fontSize: 10,
              },
            ],
            fillColor: t.primary,
            margin: [22, 22, 22, 22],
            border: [false, false, false, false],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 24, 0, 0],
  };
}

// ---------- Build full doc definition ----------
function buildCatalogDefinition(
  items: CatalogItemForPdf[],
  company: CompanyForPdf,
  brand: BrandAssets,
  options: CatalogPdfOptions = {},
): TDocumentDefinitions {
  const opts: CatalogPdfOptions = { groupByCategory: true, showDescriptions: true, showCodes: true, showSummary: true, ...options };
  const t = buildTheme(brand);
  const groups = groupItems(items, !!opts.groupByCategory);

  const content: Content[] = [
    ...buildCover(items, groups, company, brand, opts, t),
    sectionHeading('Détails', 'Émetteur', t),
    issuerBlock(company, opts, t),
  ];

  const withSummary = !!opts.showSummary && !!opts.groupByCategory && groups.length > 1;
  if (withSummary) {
    content.push(sectionHeading('Aperçu', 'Sommaire par catégorie', t));
    content.push(summaryTable(groups, t));
  }

  // After a summary, start the grid on a fresh page: the recap page rarely
  // leaves room for a whole category block, so the heading would end up alone.
  const gridHeading = sectionHeading('Tarifs', 'Grille tarifaire', t) as any;
  content.push(withSummary ? { ...gridHeading, pageBreak: 'before' } : gridHeading);
  if (items.length === 0) {
    content.push({ text: 'Aucun article à afficher.', color: t.grey, fontSize: 10, italics: true });
  } else {
    groups.forEach((g) => content.push(itemsTable(g, opts, t)));
  }

  content.push(...conditionsSection(company, opts, t));
  content.push(closingCard(company, t));

  const background = (currentPage: number, pageSize: ContextPageSize) => {
    if (currentPage === 1) {
      return [
        { canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color: t.primary }] },
      ] as any;
    }
    return [];
  };

  const headerLabel = `${(company?.name || '').toUpperCase()}  •  CATALOGUE DE PRIX`.replace(/^\s+•\s+/, '');

  return {
    pageSize: 'LETTER',
    pageMargins: [54, 54, 54, 70],
    info: {
      title: `Catalogue de prix — ${company?.name || 'Gestia'}`,
      author: company?.name || 'Gestia',
      subject: 'Grille tarifaire',
    },
    background,
    header: (currentPage: number) => {
      if (currentPage === 1) return null as any;
      return {
        text: headerLabel,
        alignment: 'right',
        color: t.accent,
        bold: true,
        fontSize: 8,
        characterSpacing: 2,
        margin: [54, 24, 54, 0],
      };
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
    defaultStyle: { font: 'Roboto', fontSize: 10, color: t.text },
    content,
  };
}

// ---------- Public API ----------
export function buildCatalogPdfFilename(company: CompanyForPdf, issueDate?: Date | string): string {
  const slug = (company?.name || 'Catalogue')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'Catalogue';
  const d = issueDate ? new Date(issueDate) : new Date();
  const stamp = Number.isNaN(d.getTime()) ? '' : `-${d.toISOString().slice(0, 10)}`;
  return `Catalogue-${slug}${stamp}.pdf`;
}

export function downloadCatalogPdf(
  items: CatalogItemForPdf[],
  company: CompanyForPdf,
  brand: BrandAssets,
  options: CatalogPdfOptions = {},
): void {
  const def = buildCatalogDefinition(items, company, brand, options);
  pdfMake.createPdf(def).download(buildCatalogPdfFilename(company, options.issueDate));
}

export function getCatalogPdfBase64(
  items: CatalogItemForPdf[],
  company: CompanyForPdf,
  brand: BrandAssets,
  options: CatalogPdfOptions = {},
): Promise<string> {
  const def = buildCatalogDefinition(items, company, brand, options);
  return pdfMake.createPdf(def).getBase64();
}

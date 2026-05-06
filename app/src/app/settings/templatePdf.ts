// Client-side PDF generation for document templates.
// Uses pdfmake (same as invoice PDFs). Brand assets must be passed in from
// getCompanyBrandAssets query result.

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import type { BrandAssets } from '../documents/pdf';

const _vfs: any = (pdfFonts as any).default ?? (pdfFonts as any).vfs ?? pdfFonts;
(pdfMake as any).vfs = _vfs;

const DEFAULT_PRIMARY = '#0E0E0E';
const DEFAULT_ACCENT = '#D4A24C';
const DEFAULT_TEXT = '#1A1A1A';

// ─── Template types ───────────────────────────────────────────────────────────

export const TEMPLATE_TYPES: { value: string; label: string }[] = [
  { value: 'contract', label: 'Contrat' },
  { value: 'cahier_des_charges', label: 'Cahier des charges' },
  { value: 'hebergement', label: 'Hébergement' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'autre', label: 'Autre' },
];

export function templateTypeLabel(type: string): string {
  return TEMPLATE_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ─── Available variables ──────────────────────────────────────────────────────

export type TemplateVarGroup = {
  group: string;
  vars: { key: string; label: string; sample: string }[];
};

export const TEMPLATE_VARIABLE_GROUPS: TemplateVarGroup[] = [
  {
    group: 'Date',
    vars: [
      { key: '{{date}}', label: 'Date du jour', sample: '6 mai 2026' },
      { key: '{{date_expiry}}', label: "Date d'expiration", sample: '6 juin 2026' },
      { key: '{{date_signed}}', label: 'Date de signature', sample: '8 mai 2026' },
    ],
  },
  {
    group: 'Client',
    vars: [
      { key: '{{client.name}}', label: 'Nom du client', sample: 'Jean Dupont' },
      { key: '{{client.company}}', label: 'Entreprise client', sample: 'Acme Inc.' },
      { key: '{{client.email}}', label: 'Email', sample: 'jean@acme.com' },
      { key: '{{client.phone}}', label: 'Téléphone', sample: '+1 514 555-0100' },
      { key: '{{client.address}}', label: 'Adresse', sample: '123 rue Example, Montréal, QC' },
    ],
  },
  {
    group: 'Entreprise',
    vars: [
      { key: '{{company.name}}', label: 'Nom', sample: 'Mon Entreprise Inc.' },
      { key: '{{company.email}}', label: 'Email', sample: 'contact@monentreprise.com' },
      { key: '{{company.phone}}', label: 'Téléphone', sample: '+1 514 555-0200' },
      { key: '{{company.address}}', label: 'Adresse', sample: '456 rue Bureau, Montréal, QC' },
      { key: '{{company.neq}}', label: 'NEQ / N° entreprise', sample: '1234567890' },
      { key: '{{company.tps}}', label: 'N° TPS (fédéral)', sample: '123456789 RT0001' },
      { key: '{{company.tvq}}', label: 'N° TVQ (provincial)', sample: '1234567890 TQ0001' },
    ],
  },
  {
    group: 'Document',
    vars: [
      { key: '{{document.number}}', label: 'Numéro de document', sample: 'CONT-2026-001' },
      { key: '{{amount.total}}', label: 'Montant total (HT)', sample: '2 500,00 $' },
      { key: '{{amount.deposit}}', label: 'Acompte', sample: '625,00 $' },
      { key: '{{amount.tps}}', label: 'TPS (5%)', sample: '125,00 $' },
      { key: '{{amount.tvq}}', label: 'TVQ (9,975%)', sample: '249,38 $' },
      { key: '{{amount.total_ttc}}', label: 'Montant total (TTC)', sample: '2 874,38 $' },
    ],
  },
  {
    group: 'Projet',
    vars: [
      { key: '{{project.name}}', label: 'Nom du projet', sample: 'Refonte Site Web' },
    ],
  },
];

// Flat list of all variable keys with their sample values
export const TEMPLATE_SAMPLES: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLE_GROUPS.flatMap((g) => g.vars.map((v) => [v.key, v.sample])),
);

/** Replace all {{variable}} placeholders with their sample values */
export function applyTemplateSamples(content: string): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (match) => TEMPLATE_SAMPLES[match] ?? match);
}

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = { primary: string; accent: string; text: string; white: string };

function buildTheme(brand: BrandAssets): Theme {
  return {
    primary: brand?.primaryColor ?? DEFAULT_PRIMARY,
    accent: brand?.accentColor ?? DEFAULT_ACCENT,
    text: brand?.textColor ?? DEFAULT_TEXT,
    white: '#FFFFFF',
  };
}

// ─── Inline markdown parser ───────────────────────────────────────────────────

type Span = string | { text: any; bold?: boolean; italics?: boolean; color?: string };

function parseInline(raw: string, t: Theme): Span[] {
  const parts: Span[] = [];
  let rem = raw;
  const patterns: { re: RegExp; type: string }[] = [
    { re: /\{\{([^}]+)\}\}/, type: 'var' },
    { re: /\*\*([^*]+)\*\*/, type: 'bold' },
    { re: /\*([^*]+)\*/, type: 'italic' },
    { re: /_([^_]+)_/, type: 'italic' },
    { re: /`([^`]+)`/, type: 'code' },
  ];

  while (rem.length > 0) {
    let earliest: { idx: number; match: RegExpMatchArray; type: string } | null = null;
    for (const { re, type } of patterns) {
      const m = rem.match(re);
      if (m && m.index !== undefined) {
        if (!earliest || m.index < earliest.idx) earliest = { idx: m.index, match: m, type };
      }
    }
    if (!earliest) { parts.push(rem); break; }
    if (earliest.idx > 0) parts.push(rem.slice(0, earliest.idx));
    const inner = earliest.match[1];
    switch (earliest.type) {
      case 'var':   parts.push({ text: `{{${inner}}}`, color: t.accent, bold: true }); break;
      case 'bold':  parts.push({ text: inner, bold: true }); break;
      case 'italic': parts.push({ text: inner, italics: true }); break;
      case 'code':  parts.push({ text: ` ${inner} `, color: t.accent }); break;
    }
    rem = rem.slice(earliest.idx + earliest.match[0].length);
  }
  return parts.length > 0 ? parts : [raw];
}

function inline(raw: string, t: Theme): any {
  const spans = parseInline(raw, t);
  if (spans.length === 1 && typeof spans[0] === 'string') return spans[0];
  return spans;
}

// ─── Block markdown parser → pdfmake content ─────────────────────────────────

function parseMarkdown(md: string, t: Theme): Content[] {
  const lines = md.split('\n');
  const out: Content[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^# (.+)/.test(line)) {
      out.push({ text: inline(line.replace(/^# /, ''), t), fontSize: 18, bold: true, color: t.primary, margin: [0, 14, 0, 6] });
    } else if (/^## (.+)/.test(line)) {
      out.push({ text: inline(line.replace(/^## /, ''), t), fontSize: 14, bold: true, color: t.primary, margin: [0, 12, 0, 2] });
      out.push({ canvas: [{ type: 'line' as any, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: t.accent }], margin: [0, 0, 0, 6] });
    } else if (/^### (.+)/.test(line)) {
      out.push({ text: inline(line.replace(/^### /, ''), t), fontSize: 12, bold: true, color: t.accent, margin: [0, 10, 0, 3] });
    } else if (/^---+$/.test(line.trim())) {
      out.push({ canvas: [{ type: 'line' as any, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#D0D0D0' }], margin: [0, 8, 0, 8] });
    } else if (/^[-*] /.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push({ text: inline(lines[i].slice(2), t) });
        i++;
      }
      out.push({ ul: items, margin: [0, 4, 0, 4] });
      continue;
    } else if (/^\d+\. /.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push({ text: inline(lines[i].replace(/^\d+\. /, ''), t) });
        i++;
      }
      out.push({ ol: items, margin: [0, 4, 0, 4] });
      continue;
    } else if (/^> /.test(line)) {
      out.push({ text: inline(line.slice(2), t), margin: [12, 2, 0, 4], color: '#666666', italics: true });
    } else if (line.trim() === '') {
      out.push({ text: '', margin: [0, 3, 0, 0] });
    } else {
      out.push({ text: inline(line, t), fontSize: 10, color: t.text, margin: [0, 0, 0, 4] });
    }
    i++;
  }
  return out;
}

// ─── Cover page ───────────────────────────────────────────────────────────────

function buildCover(
  name: string,
  type: string,
  description: string | null | undefined,
  brand: BrandAssets,
  companyName: string,
  t: Theme,
): Content[] {
  const typeLabel = templateTypeLabel(type).toUpperCase();
  const logoBlock: Content = brand?.logoDataUrl
    ? ({ image: brand.logoDataUrl, width: 100, margin: [0, 0, 0, 32] } as Content)
    : ({ text: companyName, fontSize: 20, bold: true, color: t.white, margin: [0, 0, 0, 32] } as Content);

  const descriptionBlock: Content[] = description?.trim()
    ? [
        {
          text: description.trim(),
          fontSize: 11,
          color: '#CCCCCC',
          italics: true,
          margin: [0, 0, 0, 20],
        } as Content,
      ]
    : [];

  return [
    {
      canvas: [{ type: 'rect' as any, x: 0, y: 0, w: 595, h: 842, color: t.primary }],
      absolutePosition: { x: 0, y: 0 },
    } as Content,
    {
      stack: [
        logoBlock,
        { text: typeLabel, fontSize: 9, color: t.accent, margin: [0, 0, 0, 10], characterSpacing: 2 },
        { text: name, fontSize: 26, bold: true, color: t.white, margin: [0, 0, 0, 20] },
        {
          canvas: [{ type: 'line' as any, x1: 0, y1: 0, x2: 60, y2: 0, lineWidth: 2, lineColor: t.accent }],
          margin: [0, 0, 0, 20],
        },
        ...descriptionBlock,

      ],
      margin: [60, 160, 60, 0],
      pageBreak: 'after',
    } as Content,
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getTemplatePdfBase64(
  template: { name: string; type: string; description?: string | null; content: string },
  brand: BrandAssets,
  companyName: string,
): Promise<string> {
  const t = buildTheme(brand);
  const cover = buildCover(template.name, template.type, template.description, brand, companyName, t);
  const body = parseMarkdown(
    template.content?.trim() || '# Contenu du modèle\n\nAjoutez votre contenu ici.',
    t,
  );

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [60, 60, 60, 60],
    content: [...cover, ...body],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: t.text, lineHeight: 1.45 },
  };

  return pdfMake.createPdf(docDef).getBase64();
}

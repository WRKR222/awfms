// src/modules/brooder/cage-layout-parser.util.ts
//
// Turns a plain-text description of a cage layout into the same
// {rowLabel, levelLabels, startCageNumber, cageCount, birdsPerCage}
// "block" shape that bulkReassignCages already understands — just with
// row/level identified by LABEL instead of an id, since the caller is
// typing a description rather than picking ids from a dropdown.
//
// Why a text grammar instead of one-block-per-count already being
// possible via the JSON API: the JSON API technically supports mixed
// counts today (submit N blocks, one per distinct run), but composing
// that by hand for a real layout — "cages 1-33 have 9 birds, 34 has 8,
// 35-39 have 9, 40 has 8, 41-44 have 9" — means manually computing 5
// start/count pairs and getting the JSON exactly right. This lets
// someone type the description the way they'd actually say it out loud
// and get the same 5 blocks computed for them.
//
// Deliberately NOT an LLM call: bird counts feed directly into feed
// rationing, mortality baselines, and capacity checks, so parsing must
// be deterministic, auditable, and fail loudly on anything ambiguous
// rather than guess. Every line either matches the grammar below or the
// whole parse is rejected with a line number and reason — never a
// partial, best-effort result.
//
// ─────────────────────────────────────────────────────────────────────
// GRAMMAR (line-oriented; blank lines ignored)
// ─────────────────────────────────────────────────────────────────────
//   Row header      "Row F"                  "Row F:"
//   Level header     "Level 4"                "Levels 4, 3, 2:"
//   Combined header  "Row F Level 4"          "Row F Levels 4/3/2:"
//   Segment          "1-33: 9 birds each"     "34: 8 birds"
//                     "cages 35-39 -> 9 each"  "40 = 8"
//                     "41 to 44: 9"
//   Isolation tag    append "(isolation: <reason>)" to a header or
//                     segment line — scopes to that header until the
//                     next header, or to just that segment if attached
//                     to a segment line.
//
// A row header must appear before any segment lines that follow it; a
// level header (or combined row+level header) must be in effect before
// a segment line is parsed. Segments accumulate under the current
// row/level context until a new header changes it.
// ─────────────────────────────────────────────────────────────────────

export interface ParsedCageBlock {
  rowLabel: string;
  levelLabels: string[];
  startCageNumber: number;
  cageCount: number;
  birdsPerCage: number;
  isIsolation: boolean;
  isolationReason: string | null;
  /** 1-based source line number, for error messages / preview display. */
  sourceLine: number;
}

export class CageLayoutParseError extends Error {
  constructor(message: string, public readonly line: number, public readonly rawLine: string) {
    super(`Line ${line}: ${message} — "${rawLine.trim()}"`);
  }
}

// Trailing ":" allowed after the closing paren so a header can carry both
// an isolation tag and its own tail-colon, e.g. "Row A Level 2 (isolation:
// sick birds):".
const ISOLATION_TAG_RE = /\(\s*isolation\s*:\s*([^)]+?)\s*\)\s*(:)?\s*$/i;

// Each header regex optionally captures a trailing ": <segments...>" tail so a
// header and its first segment(s) can share one line, e.g.
// "Row F Level 4: 1-33=9, 34=8". Group order: (row?, levels?, tail).
const ROW_HEADER_RE = /^row\s+([A-Za-z0-9]+)\s*(?::\s*(.*))?$/i;

// "Row F Level 4:" / "Row F Levels 4, 3, 2:" / "Row F Level 4/3/2: 1-33=9, ..."
const COMBINED_HEADER_RE =
  /^row\s+([A-Za-z0-9]+)\s+levels?\s+([A-Za-z0-9]+(?:\s*[,/&]\s*[A-Za-z0-9]+)*)\s*(?::\s*(.*))?$/i;

// "Level 4:" / "Levels 4, 3, 2:" / "Level 4/3/2: 1-33=9, ..."
const LEVEL_HEADER_RE = /^levels?\s+([A-Za-z0-9]+(?:\s*[,/&]\s*[A-Za-z0-9]+)*)\s*(?::\s*(.*))?$/i;

// "1-33: 9 birds each" / "cage 34: 8 birds" / "cages 35-39 -> 9 each" / "41 to 44 = 9"
const SEGMENT_RE =
  /^(?:cages?\s+)?(\d+)\s*(?:-|to|–)\s*(\d+)?\s*(?:cages?)?\s*[:=\-–>]+\s*(\d+)\s*(?:birds?)?\s*(?:each)?\.?$/i;
// Simpler fallback for a single cage number ("34: 8 birds", "40 = 8"), tried if SEGMENT_RE
// (which expects a range dash) doesn't match.
const SINGLE_SEGMENT_RE =
  /^(?:cage\s+)?(\d+)\s*[:=\-–>]+\s*(\d+)\s*(?:birds?)?\s*(?:each)?\.?$/i;

function splitLabelList(raw: string): string[] {
  return raw.split(/[,/&]/).map(s => s.trim()).filter(Boolean);
}

function stripIsolationTag(line: string): { text: string; isIsolation: boolean; reason: string | null } {
  const m = line.match(ISOLATION_TAG_RE);
  if (!m) return { text: line, isIsolation: false, reason: null };
  return { text: line.slice(0, m.index).trim(), isIsolation: true, reason: m[1].trim() };
}

/**
 * Parses a free-text cage layout description into an ordered list of
 * blocks matching the same shape the bulk-reassign JSON API accepts,
 * except rowLabel/levelLabels are raw text — the service layer resolves
 * those against the actual BrooderRow/BrooderLevel records (and is the
 * place where a genuinely unresolvable label becomes a 400).
 *
 * Also splits comma-separated segments that were typed on a single
 * line, e.g. "Row F Level 4: 1-33=9, 34=8, 35-39=9, 40=8, 41-44=9".
 */
export function parseCageLayoutDescription(raw: string): ParsedCageBlock[] {
  if (!raw || !raw.trim()) {
    throw new Error('Description is empty — nothing to parse.');
  }

  const blocks: ParsedCageBlock[] = [];

  let currentRow: string | null = null;
  let currentLevels: string[] = [];
  let scopeIsolation: { isIsolation: boolean; reason: string | null } = { isIsolation: false, reason: null };

  const lines = raw.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (!line) return;

    // First, check whether the line OPENS with a Row/Level header. Headers
    // may carry a trailing ": <segments...>" tail sharing the same line
    // (e.g. "Row F Level 4: 1-33=9, 34=8"). Whatever isn't consumed by the
    // header becomes the segment text to split on commas; if no header
    // matches, the whole line is treated as (comma-separated) segments
    // under whatever row/level context is already active.
    let tail: string | null = null;

    const untaggedLine = stripIsolationTag(line);
    const headerIsolation = untaggedLine.isIsolation
      ? { isIsolation: true, reason: untaggedLine.reason }
      : null;

    const combined = untaggedLine.text.match(COMBINED_HEADER_RE);
    if (combined) {
      currentRow = combined[1];
      currentLevels = splitLabelList(combined[2]);
      scopeIsolation = headerIsolation ?? { isIsolation: false, reason: null };
      tail = combined[3] ?? '';
    } else {
      const rowOnly = untaggedLine.text.match(ROW_HEADER_RE);
      if (rowOnly) {
        currentRow = rowOnly[1];
        currentLevels = [];
        scopeIsolation = headerIsolation ?? { isIsolation: false, reason: null };
        tail = rowOnly[2] ?? '';
      } else {
        const levelOnly = untaggedLine.text.match(LEVEL_HEADER_RE);
        if (levelOnly) {
          currentLevels = splitLabelList(levelOnly[1]);
          if (headerIsolation) scopeIsolation = headerIsolation;
          tail = levelOnly[2] ?? '';
        }
      }
    }

    // No header matched at all — the whole (untagged) line is segment text.
    const segmentText = tail !== null ? tail : untaggedLine.text;
    if (!segmentText.trim()) return; // header-only line, nothing more to do

    const segments = segmentText.split(',').map(s => s.trim()).filter(Boolean);

    for (const rawSegment of segments) {
      const untagged = stripIsolationTag(rawSegment);
      const segment = untagged.text;
      const inlineIsolation = untagged.isIsolation
        ? { isIsolation: true, reason: untagged.reason }
        : null;

      // Otherwise this segment must describe a cage range + bird count.
      let start: number, end: number, birds: number;
      const rangeMatch = segment.match(SEGMENT_RE);
      if (rangeMatch) {
        start = parseInt(rangeMatch[1], 10);
        end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : start;
        birds = parseInt(rangeMatch[3], 10);
      } else {
        const singleMatch = segment.match(SINGLE_SEGMENT_RE);
        if (!singleMatch) {
          throw new CageLayoutParseError(
            'Could not parse this as a "Row"/"Level" header or a "<cage range>: <birds>" segment',
            lineNo, rawLine,
          );
        }
        start = parseInt(singleMatch[1], 10);
        end = start;
        birds = parseInt(singleMatch[2], 10);
      }

      if (!currentRow) {
        throw new CageLayoutParseError(
          'No "Row" specified yet for this segment', lineNo, rawLine,
        );
      }
      if (currentLevels.length === 0) {
        throw new CageLayoutParseError(
          'No "Level" specified yet for this segment', lineNo, rawLine,
        );
      }
      if (end < start) {
        throw new CageLayoutParseError(
          `Cage range end (${end}) is before start (${start})`, lineNo, rawLine,
        );
      }

      blocks.push({
        rowLabel: currentRow,
        levelLabels: [...currentLevels],
        startCageNumber: start,
        cageCount: end - start + 1,
        birdsPerCage: birds,
        isIsolation: (inlineIsolation ?? scopeIsolation).isIsolation,
        isolationReason: (inlineIsolation ?? scopeIsolation).reason,
        sourceLine: lineNo,
      });
    }
  });

  if (blocks.length === 0) {
    throw new Error(
      'No cage segments were found. Expected lines like "Row F Level 4:" followed by ' +
      '"1-33: 9 birds each".',
    );
  }

  return blocks;
}

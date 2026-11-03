// Local Accessibility Checker (Mission 2, P2-5 — a Word-gap feature;
// extended in Phase 2, P2-16, with two further JSON-derivable rules, and
// in Phase 2, P2-18, with two more, and in Phase 2, P2-21, with two more,
// and in Phase 2, P2-22, with two more, and in Phase 2, P2-23, with two
// more, and in Phase 2, P2-24, with two more, and in Phase 2, P2-25,
// with two more, and in Phase 2, P2-26, with two more, and in Phase 2,
// P2-27, with two more, and in Phase 2, P2-28, with two more, and in
// Phase 2, P2-29, with two more, and in Phase 2, P2-30, with two more, and in
// Phase 2, P2-32, with two more, and in Phase 2, P2-33, with two more, and in
// Phase 2, P2-34, with two more, and in Phase 2, P2-35, with two
// more, and in Phase 2, P2-36, with two more, and in
// Phase 2, P2-37, with two more, and in Phase 2, P2-38,
// with two more, and in Phase 2, P2-39, with two more, and in
// Phase 2, P2-40, with two more, and in
// Phase 2, P2-41, with two more).
//
// Pure, READ-ONLY analysis over stored TipTap JSON: it never mutates the
// document, never touches storage, network, or the editor. Exactly
// forty-eight local, JSON-derivable rules — nothing is faked:
//   (1) images missing alt text (attrs.alt missing, empty, or whitespace),
//   (2) heading level skips (e.g. H1 followed by H3),
//   (3) empty headings,
//   (4) tables whose first row has no header cell,
//   (5) links with empty visible text (linkEmptyText),
//   (6) the document's first heading not being Heading 1
//       (firstHeadingNotH1, at most one per document),
//   (7) links whose visible text is exactly a vague phrase
//       (linkVagueText — exact match only, never substring, after trim,
//       lowercasing, whitespace collapsing, and mapping Arabic Yeh/Kaf to
//       Persian Yeh/Kaf, so "click here for details" is NOT vague),
//   (8) images whose alt text is longer than 125 characters
//       (imageAltTooLong — counted in code points of the trimmed alt;
//       missing/empty alt is NOT flagged here, it is imageAltMissing),
//   (9) headings whose text duplicates an earlier heading's text
//       (headingDuplicateText — the first occurrence is never flagged,
//       only each later one; normalisation is trim + lowercasing +
//       collapsing internal whitespace + mapping Arabic Yeh/Kaf to
//       Persian Yeh/Kaf, with ZWNJ preserved; empty headings are NOT
//       flagged here, they are already headingEmpty),
//   (10) images whose alt text duplicates an earlier image's alt text
//       (imageAltDuplicate — same normalisation as (9), first occurrence
//       never flagged, only each later one; missing/empty alt is NOT
//       flagged here, it is imageAltMissing; a duplicate long alt
//       legitimately fires both imageAltTooLong and imageAltDuplicate),
//   (11) images whose alt text is a single-token filename ending in a
//       known image extension (imageAltIsFilename — regex
//       /^[^\s]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i on the trimmed
//       alt; missing/empty alt is NOT flagged here, it is
//       imageAltMissing; a filename alt may legitimately also fire
//       imageAltTooLong / imageAltDuplicate, neither branch suppresses
//       the other),
//   (12) links whose visible text is the link's own URL (linkTextIsUrl
//       — the run's trimmed text compared case-insensitively with the
//       href after stripping a leading http:// or https://, a leading
//       www., and one trailing '/' from BOTH sides; empty runs are NOT
//       flagged here, they are already linkEmptyText; vague phrases are
//       unaffected),
//   (13) images whose alt text is exactly a generic word (imageAltVague
//       — exact match only, never substring, after the same duplicate
//       normalisation as (9)/(10); missing/empty alt is NOT flagged
//       here, it is imageAltMissing; this branch does not suppress the
//       long/duplicate/filename branches, and they do not suppress it),
//   (14) TOP-LEVEL headings whose section contains no readable content
//       (headingNoContent — hierarchical: for a top-level heading at
//       level L, a following heading with level <= L ends the section,
//       a following heading with level > L is a subsection and scanning
//       continues past it, a block counts as content when its recursive
//       trimmed text is non-empty or it is/contains an image node, and
//       empty paragraphs neither count nor stop the scan; reaching the
//       end of the document without content flags the heading).
//   (15) tables containing at least one merged cell (tableMergedCells —
//       a tableCell or tableHeader anywhere in its rows whose
//       attrs.colspan > 1 or attrs.rowspan > 1, numeric only; one issue
//       per table, never per cell; missing attrs, a span of 1, or a
//       non-numeric span value never flags; this branch does not
//       suppress tableNoHeader, and tableNoHeader does not suppress it,
//       so a merged-cell table with no header row fires both),
//   (16) links whose visible text repeats an earlier link's text but
//       points to a different destination (linkSameTextDifferentTarget
//       — per link RUN, as defined below; runs are grouped by the same
//       normalisation as (7), and a run is flagged only when its href
//       is new for that normalised text while an earlier run with the
//       same text already exists, so [A, A, B] flags only B and
//       [A, B, A] flags only B; empty runs are NOT flagged here, they
//       are already linkEmptyText; the vague/URL-text branches neither
//       suppress nor are suppressed by this rule).
//   (17) links with non-empty visible text but no destination
//       (linkMissingHref — per link RUN, as defined below; the run's
//       href is missing, non-string, empty, or whitespace-only; the
//       issue always carries href '' and the trimmed visible text;
//       empty runs are NOT flagged here, they are already
//       linkEmptyText; this branch neither suppresses nor is
//       suppressed by the vague/URL-text branches, so a vague-text
//       link with no href fires both; the URL-text branch already
//       cannot fire on an empty href).
//   (18) headings whose trimmed text is longer than 100 code points
//       (headingTooLong — counted in code points of the trimmed text,
//       so 100 passes and 101 flags; headingText carries the original,
//       unnormalised text; empty headings have length 0 and never
//       fire this, they are already headingEmpty; 100 is a
//       diagnostic threshold for screen-reader navigation, not a
//       hard WCAG limit).
//   (19) a document with more than one Heading 1 (headingMultipleH1 —
//       only the SECOND and later H1 headings are flagged, never the
//       first; empty H1 headings are excluded, they are already
//       headingEmpty; headingText carries the original, unnormalised
//       text; independent of headingDuplicateText / headingSkip /
//       firstHeadingNotH1, so a second H1 may legitimately fire
//       several rules).
//   (20) images whose alt text opens with a redundant word
//       (imageAltRedundantPrefix — the first whitespace-separated
//       token of the trimmed alt, lowercased, with trailing
//       punctuation (: , . ; - –) stripped, is one of image, photo,
//       picture, photograph, graphic, illustration, img, عکس, تصویر,
//       نگاره, AND there is more text after that first word, so an
//       exact vague alt such as 'photo' is NOT flagged here, it is
//       already imageAltVague; missing/empty alt is NOT flagged here,
//       it is already imageAltMissing; independent of the
//       long/duplicate/filename/vague branches, so a redundant-prefix
//       alt may legitimately fire several of them too).
//   (21) tables containing at least one empty cell (tableEmptyCells —
//       a tableCell or tableHeader anywhere in its rows whose
//       recursive text, trimmed, is '' AND which contains no image
//       node, so a whitespace-only cell flags but a cell holding an
//       image does not; one issue per table, never per cell, carrying
//       tableIndex only; independent of tableNoHeader and
//       tableMergedCells, so a table may legitimately fire several).
//   (22) links whose visible text differs from an earlier link's text
//       but points to the same destination (linkSameTargetDifferentText
//       — the inverse of (16), a second independent pass over the
//       already-collected linkRuns; runs are grouped by the exact href
//       string, and a run is flagged only when its normalised text
//       (the same normalisation as (7)) is NEW for that href while an
//       earlier run with the same href already exists, so [Guide,
//       Manual] to one href flags only Manual, [Guide, Guide] flags
//       nothing, and [Guide, Manual, Guide] flags only Manual; empty
//       runs are NOT flagged here, they are already linkEmptyText, and
//       runs with href '' are NOT flagged here, they are already
//       linkMissingHref; independent of (16) and of the vague/URL-text
//       branches).
//   (23) tables whose header row is not the first row
//       (tableHeaderNotFirstRow — one issue per table, carrying
//       tableIndex only; fires if and only if the table's first row
//       (content[0], when it is a tableRow) contains NO tableHeader
//       cell AND some LATER row contains a tableHeader cell; a table
//       with a header in the first row passes, a table with no header
//       anywhere passes this rule (tableNoHeader already covers it),
//       and a table with no rows or a non-tableRow first row never
//       fires; independent of tableNoHeader / tableMergedCells /
//       tableEmptyCells, so co-firing is legitimate).
//   (24) images whose alt text matches nearby text
//       (imageAltMatchesNearbyText — for each image with a non-empty
//       alt, missing/empty alt is excluded, already imageAltMissing;
//       the normalised alt (normalizeDuplicateText of the trimmed alt)
//       is compared with the normalised recursive text of (a) its
//       containing top-level block, when that block's recursive text
//       trimmed is non-empty, (b) the nearest preceding top-level
//       block with non-empty trimmed recursive text, and (c) the
//       nearest following such block; any equality flags one issue
//       carrying imageIndex and the trimmed alt; imageIndex matches
//       the main walk's document order, top-level blocks in doc.content
//       order, depth-first inside each; own-block text never contains
//       the alt itself, since image nodes carry no text, so the
//       own-block comparison is safe; malformed docs with no content
//       array never fire).
//   (25) images whose trimmed alt text IS a URL (imageAltIsUrl —
//       matches /^https?:\/\/\S+$/i OR /^www\.[^\s]+\.[^\s]{2,}$/i
//       on the trimmed alt, so 'https://example.com/a.png' and
//       'www.example.com' flag but a sentence embedding a URL or a
//       bare domain without a scheme does not; missing/empty/
//       whitespace alt is NOT flagged here, it is imageAltMissing;
//       independent of the long/duplicate/filename/vague/redundant/
//       matching-nearby branches, so co-firing is legitimate and no
//       branch suppresses another).
//   (26) images whose trimmed alt text contains NO Unicode letter at
//       all (imageAltNoLetters — /\p{L}/u does not match the trimmed
//       alt, so '12345' and '!!!' flag but any alt containing even
//       one letter passes; Persian/Arabic letters count as letters
//       under \p{L}, so a Dari alt like 'کوهستان' never flags;
//       missing/empty alt is NOT flagged here, it is
//       imageAltMissing; independent of all other branches).
//   (27) non-empty headings whose trimmed text contains NO Unicode
//       letter at all (headingNoLetters — /\p{L}/u does not match the
//       trimmed text, so '12345' and '!!!' flag but any heading
//       containing even one letter passes; Persian/Arabic letters
//       count as letters under \p{L}, so a Dari heading never
//       flags; empty headings are EXCLUDED, they are already
//       headingEmpty; headingText carries the original,
//       unnormalised text; independent of all other heading rules,
//       so co-firing with e.g. headingDuplicateText is legitimate).
//   (28) tables whose counted rows have differing effective column
//       counts (tableInconsistentColumns — one issue per table,
//       carrying tableIndex only; the effective count of a row is
//       the sum over its tableCell/tableHeader cells of (numeric
//       attrs.colspan > 0 ? colspan : 1), rowspan ignored for
//       width; only tableRow rows with at least one cell count, so
//       a table with fewer than 2 counted rows never flags and
//       malformed/non-tableRow rows are ignored; a merged-cell
//       table whose colspan arithmetic makes rows equal does NOT
//       flag; independent of tableNoHeader / tableMergedCells /
//       tableEmptyCells / tableHeaderNotFirstRow, so co-firing is
//       legitimate).
//   (29) links whose trimmed visible text contains NO Unicode letter
//       at all (linkTextNoLetters — per link RUN, as defined below;
//       /\p{L}/u does not match the trimmed text, so '12345' and
//       '!!!' flag but any run containing even one letter passes;
//       Persian/Arabic letters count as letters under \p{L}, so a
//       Dari link never flags; empty runs are EXCLUDED, they are
//       already linkEmptyText; the issue carries linkIndex and the
//       trimmed linkText; independent of all other link branches,
//       so a no-letter link with no href legitimately also fires
//       linkMissingHref, and a no-letter link whose text equals its
//       href may also fire linkTextIsUrl — no branch suppresses
//       another).
//   (30) headings whose TRIMMED text is exactly a URL
//       (headingTextIsUrl — the same URL test as rule (25):
//       /^https?:\/\/\S+$/i or /^www\.[^\s]+\.[^\s]{2,}$/i on the
//       trimmed text, so 'https://example.com' and
//       'www.example.com' flag but a URL embedded in a longer
//       heading sentence does NOT flag, and a bare domain without a
//       scheme or www. (e.g. 'example.com') does NOT flag either;
//       empty headings are EXCLUDED, they are already headingEmpty;
//       headingText carries the original, unnormalised text, and the
//       issue also carries level; independent of all other heading
//       rules, so co-firing is legitimate).
//   (31) links whose trimmed visible text is longer than 100 code
//       points (linkTextTooLong — per link RUN, as defined below;
//       counted in code points of the trimmed text, so exactly 100
//       passes and 101 flags; empty runs are NOT flagged here, they
//       are already linkEmptyText; the issue carries linkIndex, href,
//       and the trimmed linkText; independent of all other link
//       branches, so co-firing is legitimate and no branch suppresses
//       another).
//   (32) non-empty headings whose trimmed text is in ALL CAPITAL
//       letters (headingAllCaps — the trimmed text has at least one
//       Unicode letter, and trimmed === trimmed.toUpperCase() AND
//       trimmed !== trimmed.toLowerCase(), so Persian/Dari/Arabic
//       text (no case distinction) never flags, and mixed-case or
//       lowercase text never flags; empty headings are EXCLUDED,
//       they are already headingEmpty; headingText carries the
//       original, unnormalised text, and the issue also carries
//       level; independent of all other heading rules, so co-firing
//       is legitimate).
//   (33) images whose TRIMMED alt text is 1–2 code points long
//       (imageAltVeryShort — counted in code points, not UTF-16
//       units, so a single emoji counts as 1 and flags, and a
//       3-code-point alt passes; missing/empty alt is NOT flagged
//       here, it is imageAltMissing; independent of all other alt
//       rules, so co-firing is legitimate).
//   (34) links whose TRIMMED visible text is an email address
//       (linkTextIsEmail — per link RUN, as defined below; the
//       trimmed run text matches
//       /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i, so an uppercase address
//       and an address with surrounding spaces (trimmed first)
//       both flag, while a bare domain without '@' and ordinary
//       non-email text do not; empty runs are NOT flagged here,
//       they are already linkEmptyText; independent of the
//       vague/URL-text/no-letters branches, so neither suppresses
//       nor is suppressed by them).
//   (35) headings whose TRIMMED text is an email address
//       (headingTextIsEmail — the same regex as rule (34):
//       /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i on the trimmed text, so
//       an uppercase address and an address with surrounding
//       spaces (trimmed first) both flag, while a bare domain
//       without '@' and ordinary heading text do not; empty
//       headings are EXCLUDED, they are already headingEmpty;
//       headingText carries the original, unnormalised text, and
//       the issue also carries level; independent of all other
//       heading rules, so co-firing is legitimate).
//   (36) links whose TRIMMED visible text is a phone number
//       (linkTextIsPhoneNumber — per link RUN, as defined below;
//       after stripping spaces, parentheses, hyphens, and dots
//       from the trimmed text and an optional leading '+', the
//       remaining text is all digits with at least 7 digits, AND
//       the original trimmed text either starts with '+',
//       contains a space or parenthesis, or has at least 10
//       digits; that last condition is what keeps a YYYY-MM-DD
//       date (8 digits, hyphens only) from flagging, and likewise
//       a bare 7-digit string with hyphens only; empty runs are
//       NOT flagged here, they are already linkEmptyText; the
//       issue carries linkIndex, href, and the trimmed linkText;
//       independent of all other link branches, so a phone-number
//       link legitimately also fires linkTextNoLetters (its text
//       contains no letters), and no branch suppresses another).
//   (37) headings whose TRIMMED text is a phone number
//       (headingTextIsPhoneNumber — the same phone test as rule
//       (36), on the trimmed heading text, so '+98 912 345 6789'
//       and a 10-digit plain number flag, while a YYYY-MM-DD
//       date (8 digits, hyphens only) and a bare hyphenated
//       7-digit string do not; empty headings are EXCLUDED,
//       they are already headingEmpty; headingText carries the
//       original, unnormalised text, and the issue also carries
//       level; independent of all other heading rules, so a
//       phone heading legitimately also fires headingNoLetters
//       (its text contains no letters), and no branch suppresses
//       another).
//   (38) images whose TRIMMED alt text is a phone number
//       (imageAltIsPhoneNumber — the same phone test as rule
//       (36), on the trimmed alt text, so '+98 912 345 6789'
//       and a 10-digit plain number flag, while a YYYY-MM-DD
//       date (8 digits, hyphens only) and a bare hyphenated
//       7-digit string do not; missing/empty/whitespace alt is
//       EXCLUDED, it is already imageAltMissing; independent of
//       all other alt branches, so a phone alt legitimately
//       also fires imageAltNoLetters (its text contains no
//       letters), and no branch suppresses another).
//   (39) images whose TRIMMED alt text is an email address
//       (imageAltIsEmail — the same email regex as rules (34)
//       and (35): /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i on the
//       trimmed alt, so an uppercase address and an address
//       with surrounding spaces (trimmed first) both flag,
//       while a bare domain without '@' and a sentence
//       embedding an email do not; missing/empty/whitespace
//       alt is EXCLUDED, it is already imageAltMissing;
//       independent of all other alt branches, so no branch
//       suppresses another and co-firing is legitimate).
//   (40) NON-empty headings whose TRIMMED text is 1–2 code
//       points long (headingTooShort — counted in code points,
//       not UTF-16 units, so a single emoji counts as 1 and
//       flags, and a 3-code-point heading passes; a single
//       Persian/Dari letter heading also flags, by design —
//       the count is code points, not letters; empty headings
//       are EXCLUDED, they are already headingEmpty;
//       headingText carries the original, unnormalised text,
//       and the issue also carries level; independent of all
//       other heading rules, so a digit-only short heading
//       legitimately also fires headingNoLetters, and no
//       branch suppresses another).
//   (41) links whose TRIMMED visible text is 1–2 code points
//       long (linkTextTooShort — per link RUN, as defined below;
//       counted in code points of the trimmed text, so a single
//       emoji counts as 1 and flags, and a 3-code-point link
//       passes; empty runs are NOT flagged here, they are
//       already linkEmptyText; the issue carries linkIndex,
//       href, and the trimmed linkText; independent of all
//       other link branches, so a 1-digit link legitimately
//       also fires linkTextNoLetters, and no branch
//       suppresses another).
//   (42) images whose TRIMMED alt text is in ALL CAPITAL
//       letters (imageAltAllCaps — exactly the headingAllCaps
//       test (rule 32): the trimmed alt has at least one
//       Unicode letter (/\p{L}/u), and trimmed ===
//       trimmed.toUpperCase() AND trimmed !==
//       trimmed.toLowerCase(), so Persian/Dari/Arabic
//       caseless alt never flags and lowercase/mixed-case
//       never flags; missing/empty alt is NOT flagged here,
//       it is already imageAltMissing; the issue carries
//       imageIndex and the trimmed altText; independent of
//       all other alt branches, so co-firing is legitimate).
//   (43) links whose TRIMMED visible text is a single-token
//       filename ending in a known file extension
//       (linkTextIsFilename — per link RUN, as defined below;
//       the shared isFilenameText test below on the trimmed
//       run text, so 'report.pdf' and 'REPORT.PDF' flag, while
//       a bare domain like 'example.com' does NOT flag
//       (com/net/org are deliberately not listed extensions),
//       a sentence embedding a filename does NOT flag (it
//       is not a single token), '.pdf' with no basename
//       does NOT flag, and 'file.' with no extension does
//       NOT flag; empty runs are NOT flagged here, they are
//       already linkEmptyText; independent of all other link
//       branches, so no branch suppresses another).
//   (44) non-empty headings whose TRIMMED text is a
//       single-token filename ending in a known file
//       extension (headingTextIsFilename — the same shared
//       isFilenameText test as rule (43), so 'report.pdf'
//       and 'manual.docx' flag, while 'example.com' does
//       NOT flag, a multi-token heading like 'Annual
//       Report.docx' does NOT flag, and a sentence
//       embedding a filename does NOT flag; empty headings
//       are EXCLUDED, they are already headingEmpty;
//       headingText carries the original, unnormalised text,
//       and the issue also carries level; independent of
//       all other heading rules, so co-firing is
//       legitimate).
//   (45) links whose TRIMMED visible text is in ALL CAPITAL
//       letters (linkTextAllCaps — per link RUN, as defined
//       below; exactly the headingAllCaps (rule 32) /
//       imageAltAllCaps (rule 42) test: the trimmed run text
//       has at least one Unicode letter, and trimmed ===
//       trimmed.toUpperCase() AND trimmed !==
//       trimmed.toLowerCase(), so Persian/Dari/Arabic caseless
//       link text never flags and mixed-case or lowercase
//       text never flags; empty runs are NOT flagged here,
//       they are already linkEmptyText; the issue carries
//       linkIndex, href, and the trimmed linkText;
//       independent of all other link branches, so no branch
//       suppresses another).
//   (46) non-empty headings whose TRIMMED text ends with a
//       full stop / period '.' (headingEndsWithPeriod —
//       only '.' flags, NOT '?' (question headings are
//       legitimate), NOT ':' or ';' (label punctuation);
//       empty headings are EXCLUDED, they are already
//       headingEmpty; headingText carries the original,
//       unnormalised text, and the issue also carries
//       level; independent of all other heading rules, so
//       co-firing is legitimate).
//   (47) non-empty headings whose TRIMMED text CONTAINS a
//       URL substring but is NOT exactly a URL
//       (headingContainsUrl — the trimmed text matches
//       /https?:\/\/\S+/i or /www\.[^\s]+\.[^\s]{2,}/i
//       somewhere inside it, so 'See https://example.com
//       for details' and 'Visit www.example.com today'
//       flag, while a heading that IS exactly a URL does
//       NOT flag here (it is already headingTextIsUrl,
//       rule 30), a bare domain without a scheme or www.
//       (e.g. 'example.com guide') does NOT flag, and a
//       www. host without a TLD (e.g. 'www.example')
//       does NOT flag; empty headings are EXCLUDED,
//       they are already headingEmpty; headingText
//       carries the original, unnormalised text, and the
//       issue also carries level; independent of all
//       other heading rules, so co-firing with e.g.
//       headingTooLong is legitimate).
//   (48) images whose TRIMMED alt text CONTAINS a URL
//       substring but is NOT exactly a URL
//       (imageAltContainsUrl — the same contains test
//       as rule (47) on the trimmed alt, so 'See
//       https://example.com for details' flags, while
//       an alt that IS exactly a URL does NOT flag here
//       (it is already imageAltIsUrl, rule 25), a bare
//       domain without a scheme or www. does NOT flag,
//       and a www. host without a TLD does NOT flag;
//       missing/empty/whitespace alt is EXCLUDED, it
//       is already imageAltMissing; the issue carries
//       imageIndex and the trimmed alt; independent of
//       all other alt branches, so co-firing is
//       legitimate).
//       LIMITATION, documented deliberately: only top-level headings are
//       evaluated for rule (14) — a heading nested inside a blockquote
//       or list item is never flagged by this rule (it is still covered
//       by the other heading rules, e.g. headingEmpty / headingSkip /
//       headingDuplicateText, which use extractHeadings over the whole
//       document). headingIndex for rule (14) still matches
//       extractHeadings order: headings nested inside earlier top-level
//       blocks are counted when assigning the index.
// Deliberately NOT covered: colour contrast — that needs rendered styles,
// which JSON alone cannot establish, so it is omitted rather than guessed.
//
// A link RUN is consecutive text nodes sharing the same href inside one
// parent's content array: a link split across text nodes counts once.
// Any non-link text node, or any non-text node, breaks a run, and runs
// never span across different parents (e.g. a paragraph boundary or a
// list item / table cell boundary starts a fresh run).
//
// Heading rules reuse the existing helpers instead of duplicating them:
// extractHeadings (headings.ts) for the heading list and levelSkipWarnings
// (sections.ts) for the skip rule. levelSkipWarnings only reads each
// heading's level, so the HeadingItem list is passed through with a cast;
// no positions are invented or used here.

import { extractHeadings, type LiveHeading } from './headings'
import { levelSkipWarnings } from './sections'

export type A11yIssueKind =
  | 'imageAltMissing'
  | 'headingSkip'
  | 'headingEmpty'
  | 'tableNoHeader'
  | 'linkEmptyText'
  | 'firstHeadingNotH1'
  | 'linkVagueText'
  | 'imageAltTooLong'
  | 'headingDuplicateText'
  | 'imageAltDuplicate'
  | 'imageAltIsFilename'
  | 'linkTextIsUrl'
  | 'imageAltVague'
  | 'headingNoContent'
  | 'tableMergedCells'
  | 'linkSameTextDifferentTarget'
  | 'linkMissingHref'
  | 'headingTooLong'
  | 'headingMultipleH1'
  | 'imageAltRedundantPrefix'
  | 'tableEmptyCells'
  | 'linkSameTargetDifferentText'
  | 'tableHeaderNotFirstRow'
  | 'imageAltMatchesNearbyText'
  | 'imageAltIsUrl'
  | 'imageAltNoLetters'
  | 'headingNoLetters'
  | 'tableInconsistentColumns'
  | 'linkTextNoLetters'
  | 'headingTextIsUrl'
  | 'linkTextTooLong'
  | 'headingAllCaps'
  | 'imageAltVeryShort'
  | 'linkTextIsEmail'
  | 'headingTextIsEmail'
  | 'linkTextIsPhoneNumber'
  | 'headingTextIsPhoneNumber'
  | 'imageAltIsPhoneNumber'
  | 'imageAltIsEmail'
  | 'headingTooShort'
  | 'linkTextTooShort'
  | 'imageAltAllCaps'
  | 'linkTextIsFilename'
  | 'headingTextIsFilename'
  | 'linkTextAllCaps'
  | 'headingEndsWithPeriod'
  | 'headingContainsUrl'
  | 'imageAltContainsUrl'

export interface A11yIssue {
  kind: A11yIssueKind
  /** 1-based ordinal among headings, for heading issues. */
  headingIndex?: number
  /** Heading text ('' for an empty heading); never normalised. Carried by heading issues, including headingEndsWithPeriod. */
  headingText?: string
  /** Heading level, for heading issues. */
  level?: number
  /** Previous heading's level, for heading-skip issues. */
  prevLevel?: number
  /** 1-based ordinal among images, for image issues. */
  imageIndex?: number
  /** 1-based ordinal among tables, for table issues. */
  tableIndex?: number
  /** 1-based ordinal among link runs, for link issues. */
  linkIndex?: number
  /** Link target, for link issues ('' when the link mark has no href). */
  href?: string
  /** Trimmed visible link text, for linkVagueText / linkTextIsUrl / linkTextNoLetters / linkTextTooLong / linkTextIsEmail / linkTextIsPhoneNumber / linkTextTooShort / linkTextIsFilename / linkTextAllCaps issues. */
  linkText?: string
  /** Trimmed alt text, for imageAltDuplicate / imageAltIsFilename / imageAltVague / imageAltRedundantPrefix / imageAltMatchesNearbyText / imageAltIsUrl / imageAltNoLetters / imageAltVeryShort / imageAltIsPhoneNumber / imageAltIsEmail / imageAltAllCaps / imageAltContainsUrl issues. */
  altText?: string
}

export interface A11yResult {
  issues: A11yIssue[]
  /** Total issue count (== issues.length). */
  total: number
  /** Per-kind counts, in a fixed order for stable panel grouping. */
  counts: Record<A11yIssueKind, number>
}

const EMPTY_COUNTS: Record<A11yIssueKind, number> = {
  imageAltMissing: 0,
  headingSkip: 0,
  headingEmpty: 0,
  tableNoHeader: 0,
  linkEmptyText: 0,
  firstHeadingNotH1: 0,
  linkVagueText: 0,
  imageAltTooLong: 0,
  headingDuplicateText: 0,
  imageAltDuplicate: 0,
  imageAltIsFilename: 0,
  linkTextIsUrl: 0,
  imageAltVague: 0,
  headingNoContent: 0,
  tableMergedCells: 0,
  linkSameTextDifferentTarget: 0,
  linkMissingHref: 0,
  headingTooLong: 0,
  headingMultipleH1: 0,
  imageAltRedundantPrefix: 0,
  tableEmptyCells: 0,
  linkSameTargetDifferentText: 0,
  tableHeaderNotFirstRow: 0,
  imageAltMatchesNearbyText: 0,
  imageAltIsUrl: 0,
  imageAltNoLetters: 0,
  headingNoLetters: 0,
  tableInconsistentColumns: 0,
  linkTextNoLetters: 0,
  headingTextIsUrl: 0,
  linkTextTooLong: 0,
  headingAllCaps: 0,
  imageAltVeryShort: 0,
  linkTextIsEmail: 0,
  headingTextIsEmail: 0,
  linkTextIsPhoneNumber: 0,
  headingTextIsPhoneNumber: 0,
  imageAltIsPhoneNumber: 0,
  imageAltIsEmail: 0,
  headingTooShort: 0,
  linkTextTooShort: 0,
  imageAltAllCaps: 0,
  linkTextIsFilename: 0,
  headingTextIsFilename: 0,
  linkTextAllCaps: 0,
  headingEndsWithPeriod: 0,
  headingContainsUrl: 0,
  imageAltContainsUrl: 0,
}

function isHeaderCell(cell: any): boolean {
  return !!cell && typeof cell === 'object' && cell.type === 'tableHeader'
}

/**
 * Normalisation shared by the duplicate-text rules (P2-21): trim,
 * lowercase, collapse internal whitespace, map Arabic Yeh (ي) / Kaf (ك)
 * to Persian (ی/ک). ZWNJ is preserved — it is not whitespace and is
 * never normalised away.
 */
function normalizeDuplicateText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
}

/**
 * Phone-number test shared by rules (36), (37), and (38) (P2-35/P2-36):
 * the input must already be trimmed. Strip spaces, parentheses,
 * hyphens, and dots, then an optional leading '+'; what remains must
 * be all digits with at least 7 digits, AND the original trimmed text
 * must either start with '+', contain a space or parenthesis, or have
 * at least 10 digits — that last condition is what keeps a
 * YYYY-MM-DD date (8 digits, hyphens only) and a bare hyphenated
 * 7-digit string from flagging.
 */
/**
 * Filename test shared by rules (43) and (44) (P2-39): the input
 * must already be trimmed. A single token (no whitespace) with a
 * non-empty basename ending in a known file extension. com/net/org
 * are deliberately NOT listed, so a bare domain like 'example.com'
 * never flags; '.pdf' (no basename) and 'file.' (no extension)
 * never flag either, because [^\s]+ before the dot must contain
 * at least one character and the extension group must match.
 */
function isFilenameText(trimmed: string): boolean {
  return /^[^\s]+\.(pdf|docx?|txt|rtf|odt|xlsx?|csv|pptx?|zip|rar|7z|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|mp4|mov|html|json|md)$/i.test(trimmed)
}

/**
 * URL tests shared by rules (47) and (48) (P2-41): the input must
 * already be trimmed. isUrlText is the exact-URL test of rules
 * (25)/(30) — an http(s) URL with no whitespace, or a www. host
 * with a TLD of at least 2 characters. containsUrlText is the
 * substring version: the same two patterns unanchored, so a URL
 * embedded in a longer sentence matches, while a bare domain
 * without a scheme or www. and a www. host without a TLD do not.
 */
function isUrlText(trimmed: string): boolean {
  return /^https?:\/\/\S+$/i.test(trimmed) || /^www\.[^\s]+\.[^\s]{2,}$/i.test(trimmed)
}

function containsUrlText(trimmed: string): boolean {
  return /https?:\/\/\S+|www\.[^\s]+\.[^\s]{2,}/i.test(trimmed)
}

function isPhoneNumberText(trimmed: string): boolean {
  const phoneDigits = trimmed.replace(/[\s().-]/g, '').replace(/^\+/, '')
  return /^\d{7,}$/.test(phoneDigits)
    && (trimmed.startsWith('+')
      || /[\s()]/.test(trimmed)
      || phoneDigits.length >= 10)
}

/** Recursive text of a node (same shape as headings.ts nodeText). */
function nodeTextRecursive(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (Array.isArray(node.content)) return node.content.map(nodeTextRecursive).join('')
  return ''
}

/** True when the node itself is, or recursively contains, an image node. */
function nodeHasImage(node: any): boolean {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'image') return true
  return Array.isArray(node.content) && node.content.some(nodeHasImage)
}

/** Number of heading nodes in a subtree, in document order. */
function countHeadings(node: any): number {
  if (!node || typeof node !== 'object') return 0
  const self = node.type === 'heading' ? 1 : 0
  return self + (Array.isArray(node.content)
    ? node.content.reduce((n: number, c: any) => n + countHeadings(c), 0)
    : 0)
}

/** Analyse a stored TipTap JSON doc. Null / malformed input => no issues. */
export function analyzeDoc(docJson: any): A11yResult {
  const issues: A11yIssue[] = []
  const counts: Record<A11yIssueKind, number> = { ...EMPTY_COUNTS }
  const push = (issue: A11yIssue) => {
    issues.push(issue)
    counts[issue.kind] += 1
  }

  // Headings (reused helpers; see the header comment).
  const headings = extractHeadings(docJson)
  headings.forEach((h, i) => {
    if (h.empty) push({ kind: 'headingEmpty', headingIndex: i + 1, headingText: h.text, level: h.level })
  })
  // Headings that are too long (P2-25, rule 18): trimmed text over
  // 100 code points flags; 100 passes. Empty headings have length 0
  // and never fire this (already headingEmpty). Independent of the
  // other heading rules — a long heading may legitimately also fire
  // headingSkip / headingDuplicateText / headingNoContent.
  // headingText carries the original, unnormalised text.
  headings.forEach((h, i) => {
    if ([...h.text.trim()].length > 100) {
      push({ kind: 'headingTooLong', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Multiple Heading 1 headings (P2-26, rule 19): only the SECOND and
  // later non-empty H1 headings are flagged, never the first; empty
  // H1 headings are excluded (already headingEmpty). headingText
  // carries the original, unnormalised text. Independent of the
  // duplicate / skip / first-heading rules — a second H1 may
  // legitimately fire several of them.
  let seenH1 = false
  headings.forEach((h, i) => {
    if (h.level !== 1 || h.empty) return
    if (seenH1) {
      push({ kind: 'headingMultipleH1', headingIndex: i + 1, headingText: h.text, level: 1 })
    } else {
      seenH1 = true
    }
  })
  // Headings with no letters (P2-30, rule 27): a NON-EMPTY heading
  // whose trimmed text contains no Unicode letter at all flags;
  // /\p{L}/u covers Latin, Persian, and Arabic letters alike, so a
  // Dari heading never flags. Empty headings are excluded (already
  // headingEmpty). headingText carries the original, unnormalised
  // text. Independent of the other heading rules — a no-letters
  // heading may legitimately also fire headingDuplicateText /
  // headingNoContent / headingSkip.
  headings.forEach((h, i) => {
    if (h.empty) return
    if (!/\p{L}/u.test(h.text.trim())) {
      push({ kind: 'headingNoLetters', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings that are exactly a URL (P2-32, rule 30): the TRIMMED
  // text must match the same URL test as rule (25) — an http(s) URL
  // with no whitespace, or a www. host with a TLD of at least 2
  // characters. A URL embedded in a longer heading sentence does NOT
  // flag, and a bare domain without a scheme or www. (e.g.
  // 'example.com') does NOT flag either. Empty headings are excluded
  // (already headingEmpty). headingText carries the original,
  // unnormalised text. Independent of the other heading rules.
  headings.forEach((h, i) => {
    if (h.empty) return
    const trimmedHeading = h.text.trim()
    if (/^https?:\/\/\S+$/i.test(trimmedHeading) || /^www\.[^\s]+\.[^\s]{2,}$/i.test(trimmedHeading)) {
      push({ kind: 'headingTextIsUrl', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings in all capital letters (P2-33, rule 32): a NON-EMPTY
  // heading whose trimmed text has at least one Unicode letter, and
  // where trimmed === trimmed.toUpperCase() AND trimmed !==
  // trimmed.toLowerCase(). The second condition is what keeps
  // caseless scripts out: Persian/Dari/Arabic text uppercases and
  // lowercases to itself, so it never flags, and mixed-case or
  // lowercase text never flags either. Empty headings are excluded
  // (already headingEmpty). headingText carries the original,
  // unnormalised text. Independent of the other heading rules.
  headings.forEach((h, i) => {
    if (h.empty) return
    const trimmedHeading = h.text.trim()
    if (/\p{L}/u.test(trimmedHeading)
      && trimmedHeading === trimmedHeading.toUpperCase()
      && trimmedHeading !== trimmedHeading.toLowerCase()) {
      push({ kind: 'headingAllCaps', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings that are exactly an email address (P2-35, rule 35):
  // the TRIMMED text must match the same regex as rule (34) —
  // /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i — so an uppercase address
  // and an address with surrounding spaces (trimmed first) both
  // flag, while a bare domain without '@' and ordinary heading
  // text do not. Empty headings are excluded (already
  // headingEmpty). headingText carries the original,
  // unnormalised text. Independent of the other heading rules.
  headings.forEach((h, i) => {
    if (h.empty) return
    const trimmedHeading = h.text.trim()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(trimmedHeading)) {
      push({ kind: 'headingTextIsEmail', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings that are exactly a phone number (P2-36, rule 37):
  // the same phone test as rule (36), on the TRIMMED text, so
  // '+98 912 345 6789' and a 10-digit plain number flag, while
  // a YYYY-MM-DD date (8 digits, hyphens only) and a bare
  // hyphenated 7-digit string do not. Empty headings are
  // excluded (already headingEmpty). headingText carries the
  // original, unnormalised text. Independent of the other
  // heading rules — a phone heading legitimately also fires
  // headingNoLetters (its text contains no letters).
  headings.forEach((h, i) => {
    if (h.empty) return
    if (isPhoneNumberText(h.text.trim())) {
      push({ kind: 'headingTextIsPhoneNumber', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings that are very short (P2-37, rule 40): a NON-empty
  // heading whose TRIMMED text is 1–2 code points long flags,
  // so a single emoji counts as 1 and flags, a 2-code-point
  // heading flags, and a 3-code-point heading passes; a single
  // Persian/Dari letter heading also flags, by design — the
  // count is code points, not letters. Empty headings are
  // excluded (already headingEmpty). headingText carries the
  // original, unnormalised text. Independent of the other
  // heading rules — a digit-only short heading legitimately
  // also fires headingNoLetters, and no branch suppresses
  // another.
  headings.forEach((h, i) => {
    if (h.empty) return
    const trimmedLength = [...h.text.trim()].length
    if (trimmedLength >= 1 && trimmedLength <= 2) {
      push({ kind: 'headingTooShort', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings that are just a filename (P2-39, rule 44): a
  // NON-empty heading whose TRIMMED text matches the shared
  // isFilenameText test, so 'report.pdf' and 'manual.docx'
  // flag, while 'example.com' (com not a listed extension),
  // a multi-token heading like 'Annual Report.docx', and a
  // sentence embedding a filename do NOT flag. Empty
  // headings are excluded (already headingEmpty).
  // headingText carries the original, unnormalised text.
  // Independent of the other heading rules — no branch
  // suppresses another, so co-firing is legitimate.
  headings.forEach((h, i) => {
    if (h.empty) return
    if (isFilenameText(h.text.trim())) {
      push({ kind: 'headingTextIsFilename', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings ending with a period (P2-40, rule 46): a
  // NON-empty heading whose TRIMMED text ends with '.'
  // (a full stop) flags. '?' does NOT flag (question
  // headings are legitimate), and neither do ':' or ';'
  // (label punctuation). Empty headings are excluded
  // (already headingEmpty). headingText carries the
  // original, unnormalised text. Independent of the
  // other heading rules — no branch suppresses another,
  // so co-firing is legitimate.
  headings.forEach((h, i) => {
    if (h.empty) return
    if (h.text.trim().endsWith('.')) {
      push({ kind: 'headingEndsWithPeriod', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Headings containing a URL (P2-41, rule 47): a NON-empty
  // heading whose TRIMMED text CONTAINS a URL substring but
  // is NOT exactly a URL, so 'See https://example.com for
  // details' and 'Visit www.example.com today' flag, while
  // a heading that IS exactly a URL does NOT flag here
  // (it is already headingTextIsUrl, rule 30), a bare
  // domain without a scheme or www. does NOT flag, and a
  // www. host without a TLD does NOT flag. Empty
  // headings are excluded (already headingEmpty).
  // headingText carries the original, unnormalised text.
  // Independent of the other heading rules — a heading
  // containing a URL may legitimately also fire e.g.
  // headingTooLong, and no branch suppresses another.
  headings.forEach((h, i) => {
    if (h.empty) return
    const trimmedHeading = h.text.trim()
    if (!isUrlText(trimmedHeading) && containsUrlText(trimmedHeading)) {
      push({ kind: 'headingContainsUrl', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Duplicate heading text (P2-21): only later occurrences are flagged,
  // never the first; empty headings are excluded (already headingEmpty).
  // headingText carries the original, unnormalised text.
  const seenHeadingTexts = new Set<string>()
  headings.forEach((h, i) => {
    if (h.empty) return
    const normalized = normalizeDuplicateText(h.text)
    if (seenHeadingTexts.has(normalized)) {
      push({ kind: 'headingDuplicateText', headingIndex: i + 1, headingText: h.text, level: h.level })
    } else {
      seenHeadingTexts.add(normalized)
    }
  })
  // levelSkipWarnings reads only `level`; HeadingItem carries no positions.
  const skips = levelSkipWarnings(headings as unknown as LiveHeading[])
  for (const s of skips) {
    const h = headings[s.index]
    push({
      kind: 'headingSkip',
      headingIndex: s.index + 1,
      headingText: h?.text ?? '',
      level: s.level,
      prevLevel: s.prevLevel,
    })
  }

  // First heading not Heading 1 (at most one per document). The skip
  // rule above never fires on the first heading (it has no predecessor),
  // so this is independent of it, not a change to it.
  if (headings.length > 0 && headings[0].level > 1) {
    push({
      kind: 'firstHeadingNotH1',
      headingIndex: 1,
      headingText: headings[0].text,
      level: headings[0].level,
    })
  }

  // Headings with no content (P2-23, rule 14): TOP-LEVEL headings only
  // (see the header comment for the limitation). A top-level heading's
  // index is assigned in extractHeadings order, counting headings
  // nested inside earlier top-level blocks before it.
  const topBlocks: any[] = Array.isArray((docJson as any)?.content) ? (docJson as any).content : []
  let headingsSeenBefore = 0
  const topInfos = topBlocks.map((block: any) => {
    const isHeading = !!block && typeof block === 'object' && block.type === 'heading'
    const info = {
      node: block,
      isHeading,
      level: isHeading ? (block.attrs?.level || 1) : 0,
      text: isHeading ? nodeTextRecursive(block) : '',
      headingIndex: isHeading ? headingsSeenBefore + 1 : 0,
    }
    headingsSeenBefore += countHeadings(block)
    return info
  })
  topInfos.forEach((info, i) => {
    if (!info.isHeading) return
    let hasContent = false
    for (let j = i + 1; j < topInfos.length && !hasContent; j += 1) {
      const next = topInfos[j]
      if (next.isHeading) {
        // A heading at or above this level ends the section; a deeper
        // heading is a subsection — keep scanning past it (its own text
        // is not content, and content under it still counts).
        if (next.level <= info.level) break
      } else if (nodeHasImage(next.node) || nodeTextRecursive(next.node).trim() !== '') {
        hasContent = true
      }
      // Empty paragraphs (and other text-free, image-free blocks)
      // neither count as content nor stop the scan.
    }
    if (!hasContent) {
      push({ kind: 'headingNoContent', headingIndex: info.headingIndex, headingText: info.text, level: info.level })
    }
  })

  // Images + tables, in document order, anywhere in the doc (including
  // inside list items / blockquotes / table cells). A table's own first
  // row is inspected directly — never via its nested content walk.
  let imageIndex = 0
  let tableIndex = 0
  const seenAltTexts = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image') {
      imageIndex += 1
      const alt = node.attrs?.alt
      if (typeof alt !== 'string' || alt.trim() === '') {
        push({ kind: 'imageAltMissing', imageIndex })
      } else {
        const trimmedAlt = alt.trim()
        if ([...trimmedAlt].length > 125) {
          push({ kind: 'imageAltTooLong', imageIndex })
        }
        // Duplicate alt text (P2-21): only later occurrences are flagged,
        // never the first; missing/empty alt is excluded above. A
        // duplicate long alt legitimately fires both rules, so neither
        // branch suppresses the other.
        const normalizedAlt = normalizeDuplicateText(trimmedAlt)
        if (seenAltTexts.has(normalizedAlt)) {
          push({ kind: 'imageAltDuplicate', imageIndex, altText: trimmedAlt })
        } else {
          seenAltTexts.add(normalizedAlt)
        }
        // Filename alt text (P2-22): a single token (no whitespace)
        // ending in a known image extension. Missing/empty alt is
        // excluded above. Neither this branch nor the long/duplicate
        // branches suppress each other.
        if (/^[^\s]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(trimmedAlt)) {
          push({ kind: 'imageAltIsFilename', imageIndex, altText: trimmedAlt })
        }
        // Vague alt text (P2-23): the normalised alt EXACTLY matches a
        // generic word — never a substring, so 'a photo of a cat' is
        // not vague. Missing/empty alt is excluded above. Neither this
        // branch nor the long/duplicate/filename branches suppress
        // each other, so a vague duplicate fires both rules.
        const VAGUE_ALT_TEXT = new Set([
          'image', 'photo', 'picture', 'img', 'graphic', 'illustration', 'photograph',
          'تصویر', 'عکس', 'نگاره',
        ])
        if (VAGUE_ALT_TEXT.has(normalizedAlt)) {
          push({ kind: 'imageAltVague', imageIndex, altText: trimmedAlt })
        }
        // Redundant-prefix alt text (P2-26, rule 20): the FIRST word
        // of the trimmed alt is a word screen readers already announce
        // for an image, followed by more text. Only the first token
        // counts — 'A photo of a cat' is not flagged (first word 'a'),
        // and an exact vague alt ('photo') is not flagged here either
        // (it has no more text; it is already imageAltVague).
        // Missing/empty alt is excluded above. Neither this branch nor
        // the long/duplicate/filename/vague branches suppress each other.
        const REDUNDANT_ALT_OPENING_WORDS = new Set([
          'image', 'photo', 'picture', 'photograph', 'graphic', 'illustration', 'img',
          'عکس', 'تصویر', 'نگاره',
        ])
        const altTokens = trimmedAlt.split(/\s+/)
        if (altTokens.length > 1) {
          const firstWord = altTokens[0].toLowerCase().replace(/[:,\.;\-–]+$/, '')
          if (REDUNDANT_ALT_OPENING_WORDS.has(firstWord)) {
            push({ kind: 'imageAltRedundantPrefix', imageIndex, altText: trimmedAlt })
          }
        }
        // URL alt text (P2-29, rule 25): the trimmed alt IS a URL —
        // an http(s) URL with no whitespace, or a www. host with a
        // TLD of at least 2 characters. A sentence embedding a URL
        // does not match (neither regex is anchored to a substring),
        // and a bare domain without a scheme or www. does not match
        // either. Missing/empty alt is excluded above (already
        // imageAltMissing). Independent of the long/duplicate/
        // filename/vague/redundant/matching-nearby branches — no
        // branch suppresses another, so co-firing is legitimate.
        if (/^https?:\/\/\S+$/i.test(trimmedAlt) || /^www\.[^\s]+\.[^\s]{2,}$/i.test(trimmedAlt)) {
          push({ kind: 'imageAltIsUrl', imageIndex, altText: trimmedAlt })
        }
        // No-letters alt text (P2-29, rule 26): the trimmed alt
        // contains no Unicode letter at all (digits, punctuation, or
        // symbols only). \p{L} covers Latin, Persian, and Arabic
        // letters alike, so a Dari alt like 'کوهستان' never flags.
        // Missing/empty alt is excluded above (already
        // imageAltMissing). Independent of all other branches.
        if (!/\p{L}/u.test(trimmedAlt)) {
          push({ kind: 'imageAltNoLetters', imageIndex, altText: trimmedAlt })
        }
        // Very short alt text (P2-34, rule 33): the trimmed alt is
        // 1–2 code points long, so a single emoji counts as 1 and
        // flags, and a 3-code-point alt passes. Missing/empty alt
        // is excluded above (already imageAltMissing). Independent
        // of all other alt branches — no branch suppresses another,
        // so co-firing is legitimate.
        if ([...trimmedAlt].length >= 1 && [...trimmedAlt].length <= 2) {
          push({ kind: 'imageAltVeryShort', imageIndex, altText: trimmedAlt })
        }
        // Phone-number alt text (P2-36, rule 38): the same phone
        // test as rule (36), on the TRIMMED alt, so '+98 912 345
        // 6789' and a 10-digit plain number flag, while a
        // YYYY-MM-DD date (8 digits, hyphens only) and a bare
        // hyphenated 7-digit string do not. Missing/empty alt
        // is excluded above (already imageAltMissing).
        // Independent of all other alt branches — a phone alt
        // legitimately also fires imageAltNoLetters (its text
        // contains no letters), so no branch suppresses another.
        if (isPhoneNumberText(trimmedAlt)) {
          push({ kind: 'imageAltIsPhoneNumber', imageIndex, altText: trimmedAlt })
        }
        // Email-address alt text (P2-37, rule 39): the TRIMMED
        // alt must match the same regex as rules (34) and (35) —
        // /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i — so an uppercase
        // address and an address with surrounding spaces
        // (trimmed first) both flag, while a bare domain
        // without '@' and a sentence embedding an email do
        // not. Missing/empty alt is excluded above (already
        // imageAltMissing). Independent of all other alt
        // branches — no branch suppresses another, so
        // co-firing is legitimate.
        if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(trimmedAlt)) {
          push({ kind: 'imageAltIsEmail', imageIndex, altText: trimmedAlt })
        }
        // All-caps alt text (P2-38, rule 42): exactly the
        // headingAllCaps test (rule 32) — the trimmed alt has
        // at least one Unicode letter, and trimmed ===
        // trimmed.toUpperCase() AND trimmed !==
        // trimmed.toLowerCase(), so Persian/Dari/Arabic
        // caseless alt never flags and lowercase/mixed-case
        // never flags. Missing/empty alt is excluded above
        // (already imageAltMissing). Independent of all
        // other alt branches — no branch suppresses
        // another, so co-firing is legitimate.
        if (/\p{L}/u.test(trimmedAlt)
          && trimmedAlt === trimmedAlt.toUpperCase()
          && trimmedAlt !== trimmedAlt.toLowerCase()) {
          push({ kind: 'imageAltAllCaps', imageIndex, altText: trimmedAlt })
        }
        // Alt text containing a URL (P2-41, rule 48):
        // the TRIMMED alt CONTAINS a URL substring but
        // is NOT exactly a URL, so 'See
        // https://example.com for details' flags, while
        // an alt that IS exactly a URL does NOT flag
        // here (it is already imageAltIsUrl, rule 25),
        // a bare domain without a scheme or www. does
        // NOT flag, and a www. host without a TLD does
        // NOT flag. Missing/empty alt is excluded
        // above (already imageAltMissing). Independent
        // of all other alt branches — no branch
        // suppresses another, so co-firing is
        // legitimate.
        if (!isUrlText(trimmedAlt) && containsUrlText(trimmedAlt)) {
          push({ kind: 'imageAltContainsUrl', imageIndex, altText: trimmedAlt })
        }
      }
    } else if (node.type === 'table') {
      tableIndex += 1
      const firstRow = Array.isArray(node.content) ? node.content[0] : undefined
      const firstCells = firstRow && firstRow.type === 'tableRow' && Array.isArray(firstRow.content)
        ? firstRow.content
        : []
      if (!firstCells.some(isHeaderCell)) {
        push({ kind: 'tableNoHeader', tableIndex })
      }
      // Merged cells (P2-24, rule 15): one issue per table, never per
      // cell, independent of the header rule above — neither branch
      // suppresses the other. Only a numeric span > 1 counts; missing
      // attrs, a span of 1, or a non-numeric span value never flags.
      const isMergedCell = (cellNode: any): boolean => {
        if (!cellNode || typeof cellNode !== 'object') return false
        if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') return false
        const attrs = cellNode.attrs
        if (!attrs || typeof attrs !== 'object') return false
        return (typeof attrs.colspan === 'number' && attrs.colspan > 1)
          || (typeof attrs.rowspan === 'number' && attrs.rowspan > 1)
      }
      const hasMergedCell = Array.isArray(node.content) && node.content.some((row: any) =>
        row && typeof row === 'object' && row.type === 'tableRow' && Array.isArray(row.content)
          && row.content.some(isMergedCell))
      if (hasMergedCell) {
        push({ kind: 'tableMergedCells', tableIndex })
      }
      // Empty cells (P2-27, rule 21): one issue per table, never per
      // cell, independent of the header and merged-cell rules above —
      // neither branch suppresses the others. A cell is empty when its
      // recursive text, trimmed, is '' AND it contains no image node,
      // so a whitespace-only cell flags but a cell holding an image
      // does not, even if the image has no alt text of its own.
      const isEmptyCell = (cellNode: any): boolean => {
        if (!cellNode || typeof cellNode !== 'object') return false
        if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') return false
        return nodeTextRecursive(cellNode).trim() === '' && !nodeHasImage(cellNode)
      }
      const hasEmptyCell = Array.isArray(node.content) && node.content.some((row: any) =>
        row && typeof row === 'object' && row.type === 'tableRow' && Array.isArray(row.content)
          && row.content.some(isEmptyCell))
      if (hasEmptyCell) {
        push({ kind: 'tableEmptyCells', tableIndex })
      }
      // Header row not first (P2-28, rule 23): one issue per table,
      // carrying tableIndex only, independent of the header, merged-
      // cell, and empty-cell rules above — neither branch suppresses
      // the others, so a headerless-first table with a later header
      // row legitimately fires both tableNoHeader and this rule. The
      // first row must be a tableRow: a table with no rows, or with a
      // non-tableRow first row, never fires, and a table with no
      // header anywhere passes this rule (tableNoHeader covers it).
      const tableRows = Array.isArray(node.content) ? node.content : []
      const firstRowIsTableRow = tableRows.length > 0
        && !!tableRows[0] && typeof tableRows[0] === 'object' && tableRows[0].type === 'tableRow'
      if (firstRowIsTableRow) {
        const firstRowCells = Array.isArray(tableRows[0].content) ? tableRows[0].content : []
        if (!firstRowCells.some(isHeaderCell)) {
          const laterRowHasHeader = tableRows.slice(1).some((row: any) =>
            row && typeof row === 'object' && row.type === 'tableRow' && Array.isArray(row.content)
              && row.content.some(isHeaderCell))
          if (laterRowHasHeader) {
            push({ kind: 'tableHeaderNotFirstRow', tableIndex })
          }
        }
      }
      // Inconsistent column counts (P2-30, rule 28): one issue per
      // table, carrying tableIndex only, independent of the header,
      // merged-cell, empty-cell, and header-not-first rules above —
      // neither branch suppresses the others. A row's effective
      // column count is the sum over its tableCell/tableHeader cells
      // of (numeric attrs.colspan > 0 ? colspan : 1); rowspan is
      // ignored for width, and a non-numeric or missing colspan
      // counts as 1. Only tableRow rows with at least one cell
      // count: a table with fewer than 2 counted rows never flags,
      // malformed/non-tableRow rows are ignored, and a merged-cell
      // table whose colspan arithmetic makes rows equal does not
      // flag (e.g. a colspan=2 cell plus one plain cell equals
      // three plain cells).
      const countedWidths: number[] = []
      for (const row of tableRows) {
        if (!row || typeof row !== 'object' || row.type !== 'tableRow' || !Array.isArray(row.content)) continue
        const cells = row.content.filter((c: any) =>
          c && typeof c === 'object' && (c.type === 'tableCell' || c.type === 'tableHeader'))
        if (cells.length === 0) continue
        countedWidths.push(cells.reduce((sum: number, c: any) => {
          const span = c.attrs?.colspan
          return sum + (typeof span === 'number' && span > 0 ? span : 1)
        }, 0))
      }
      if (countedWidths.length >= 2 && countedWidths.some((w) => w !== countedWidths[0])) {
        push({ kind: 'tableInconsistentColumns', tableIndex })
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(docJson)

  // Alt text matching nearby text (P2-28, rule 24): a second pass over
  // the top-level blocks, in the same order as the main walk above
  // (top-level blocks in doc.content order, depth-first inside each),
  // so the imageIndex assigned here matches the main walk's. For each
  // image with a non-empty alt (missing/empty alt is excluded above,
  // already imageAltMissing), the normalised alt (normalizeDuplicateText
  // of the trimmed alt) is compared with the normalised recursive text
  // of (a) its containing top-level block, when that block's recursive
  // text trimmed is non-empty, (b) the nearest preceding top-level
  // block with non-empty trimmed recursive text, and (c) the nearest
  // following such block. Any equality flags one issue carrying
  // imageIndex and the trimmed alt. Own-block text never contains the
  // alt itself (image nodes carry no text), so the own-block
  // comparison is safe. A doc with no content array never fires.
  if (Array.isArray((docJson as any)?.content)) {
    const blocks: any[] = (docJson as any).content
    const blockTexts = blocks.map((b: any) => nodeTextRecursive(b).trim())
    let nearbyImageIndex = 0
    blocks.forEach((block: any, blockPos: number) => {
      const collectImages = (node: any) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'image') {
          nearbyImageIndex += 1
          const alt = node.attrs?.alt
          if (typeof alt === 'string' && alt.trim() !== '') {
            const trimmedAlt = alt.trim()
            const normalizedAlt = normalizeDuplicateText(trimmedAlt)
            const matches = (text: string): boolean =>
              text !== '' && normalizeDuplicateText(text) === normalizedAlt
            let flagged = matches(blockTexts[blockPos])
            if (!flagged) {
              for (let j = blockPos - 1; j >= 0; j -= 1) {
                if (blockTexts[j] !== '') {
                  flagged = matches(blockTexts[j])
                  break
                }
              }
            }
            if (!flagged) {
              for (let j = blockPos + 1; j < blocks.length; j += 1) {
                if (blockTexts[j] !== '') {
                  flagged = matches(blockTexts[j])
                  break
                }
              }
            }
            if (flagged) {
              push({ kind: 'imageAltMatchesNearbyText', imageIndex: nearbyImageIndex, altText: trimmedAlt })
            }
          }
          return
        }
        if (Array.isArray(node.content)) node.content.forEach(collectImages)
      }
      collectImages(block)
    })
  }

  // Links with empty or vague visible text, counted per link RUN (see
  // the header comment). Runs are scoped to one parent's content array:
  // entering a nested node flushes any open run and starts fresh inside
  // it, so runs never span paragraphs, list items, or table cells. A link
  // mark with no href counts as href ''.
  //
  // Vague phrases are matched EXACTLY (never substring) against the run's
  // visible text after trim + lowercasing + collapsing internal
  // whitespace + mapping Arabic Yeh (ي) / Kaf (ك) to Persian (ی/ک), so
  // "CLICK  HERE" and "کلیک کنید" with Arabic letters both match, while
  // "click here for details" does not. Empty runs are NOT vague — they
  // are already linkEmptyText, and flush() evaluates all link rules per
  // run (empty, then vague / URL-text, then missing-href, then
  // no-letters, then too-long, then email, then phone, then
  // too-short, in that order).
  const VAGUE_LINK_TEXT = new Set([
    'click here', 'here', 'this', 'link', 'more', 'read more', 'click',
    'اینجا', 'اینجا کلیک کنید', 'کلیک کنید', 'لینک', 'بیشتر',
  ])
  const normalizeLinkText = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  // URL comparison for linkTextIsUrl (P2-22): case-insensitive, after
  // stripping a leading http:// or https://, a leading www., and one
  // trailing '/' from both the visible text and the href.
  const normalizeUrlForComparison = (value: string): string => {
    let v = value.trim().toLowerCase()
    v = v.replace(/^https?:\/\//, '').replace(/^www\./, '')
    if (v.endsWith('/')) v = v.slice(0, -1)
    return v
  }
  let linkIndex = 0
  // Every flushed link run, in document order, for the P2-24 rule (16)
  // pass and the P2-27 rule (22) pass below. A run split across
  // same-href text nodes is recorded once, with its full trimmed
  // visible text.
  const linkRuns: { linkIndex: number; href: string; linkText: string }[] = []
  const linkHrefOf = (node: any): string | null => {
    if (!node || typeof node !== 'object' || node.type !== 'text' || !Array.isArray(node.marks)) return null
    const mark = node.marks.find((m: any) => m && typeof m === 'object' && m.type === 'link')
    if (!mark) return null
    const href = mark.attrs?.href
    return typeof href === 'string' ? href : ''
  }
  const walkLinks = (node: any) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return
    let runHref: string | null = null
    let runText = ''
    const flush = () => {
      if (runHref !== null) {
        linkIndex += 1
        const trimmed = runText.trim()
        linkRuns.push({ linkIndex, href: runHref, linkText: trimmed })
        if (trimmed === '') {
          push({ kind: 'linkEmptyText', linkIndex, href: runHref })
        } else {
          if (VAGUE_LINK_TEXT.has(normalizeLinkText(runText))) {
            push({ kind: 'linkVagueText', linkIndex, href: runHref, linkText: trimmed })
          } else if (normalizeUrlForComparison(trimmed) !== '' && normalizeUrlForComparison(trimmed) === normalizeUrlForComparison(runHref)) {
            push({ kind: 'linkTextIsUrl', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links with no destination (P2-25, rule 17): independent of
          // the vague/URL-text branches above, so a vague-text link
          // with no href fires both. linkHrefOf already coerces a
          // missing or non-string href to '', so a whitespace-only
          // href is the only remaining missing case; the issue always
          // carries href ''. Empty runs are excluded by the branch
          // above (already linkEmptyText).
          if (runHref.trim() === '') {
            push({ kind: 'linkMissingHref', linkIndex, href: '', linkText: trimmed })
          }
          // Links with no letters in their visible text (P2-32,
          // rule 29): the trimmed run text contains no Unicode letter
          // at all (digits, punctuation, or symbols only). \p{L}
          // covers Latin, Persian, and Arabic letters alike, so a
          // Dari link never flags. Empty runs are excluded by the
          // branch above (already linkEmptyText). Independent of the
          // vague/URL-text/missing-href branches above — no branch
          // suppresses another, so a no-letter link with no href
          // legitimately fires both this and linkMissingHref.
          if (!/\p{L}/u.test(trimmed)) {
            push({ kind: 'linkTextNoLetters', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links with very long visible text (P2-33, rule 31): the
          // trimmed run text is longer than 100 code points, so
          // exactly 100 passes and 101 flags. Empty runs are excluded
          // by the branch above (already linkEmptyText). Independent
          // of the vague/URL-text/missing-href/no-letters branches
          // above — no branch suppresses another, so a long link
          // may legitimately fire several of them.
          if ([...trimmed].length > 100) {
            push({ kind: 'linkTextTooLong', linkIndex, href: runHref, linkText: trimmed })
          }
          // Link text that is an email address (P2-34, rule 34):
          // the trimmed run text matches
          // /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i, so an uppercase
          // address and an address with surrounding spaces
          // (trimmed first) both flag, while a bare domain without
          // '@' and ordinary non-email text do not. Empty runs are
          // excluded by the branch above (already linkEmptyText).
          // Independent of the vague/URL-text/no-letters/
          // missing-href/too-long branches above — no branch
          // suppresses another, so co-firing is legitimate.
          if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(trimmed)) {
            push({ kind: 'linkTextIsEmail', linkIndex, href: runHref, linkText: trimmed })
          }
          // Link text that is a phone number (P2-35, rule 36):
          // strip spaces, parentheses, hyphens, and dots, then an
          // optional leading '+'; what remains must be all digits
          // with at least 7 digits, AND the original trimmed text
          // must either start with '+', contain a space or
          // parenthesis, or have at least 10 digits — that last
          // condition keeps a YYYY-MM-DD date (8 digits, hyphens
          // only) and a bare hyphenated 7-digit string from
          // flagging. Empty runs are excluded by the branch above
          // (already linkEmptyText). Independent of the vague/
          // URL-text/missing-href/no-letters/too-long/email
          // branches above — no branch suppresses another, so a
          // phone-number link legitimately also fires
          // linkTextNoLetters (its text contains no letters).
          if (isPhoneNumberText(trimmed)) {
            push({ kind: 'linkTextIsPhoneNumber', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links with very short visible text (P2-38, rule
          // 41): the trimmed run text is 1–2 code points
          // long, so a single emoji counts as 1 and flags,
          // and a 3-code-point link passes. Empty runs are
          // excluded by the branch above (already
          // linkEmptyText). Independent of the vague/
          // URL-text/missing-href/no-letters/too-long/
          // email/phone branches above — no branch
          // suppresses another, so a 1-digit link
          // legitimately also fires linkTextNoLetters.
          if ([...trimmed].length >= 1 && [...trimmed].length <= 2) {
            push({ kind: 'linkTextTooShort', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links whose visible text is a filename (P2-39, rule
          // 43): the trimmed run text matches the shared
          // isFilenameText test, so 'report.pdf' and
          // 'REPORT.PDF' flag, while 'example.com' (com not a
          // listed extension), a sentence embedding a
          // filename, a multi-token text, '.pdf' with no
          // basename, and 'file.' with no extension do NOT
          // flag. Empty runs are excluded by the branch
          // above (already linkEmptyText). Independent of
          // all other link branches — no branch suppresses
          // another, so co-firing is legitimate.
          if (isFilenameText(trimmed)) {
            push({ kind: 'linkTextIsFilename', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links with all-caps visible text (P2-40, rule
          // 45): exactly the headingAllCaps (rule 32) /
          // imageAltAllCaps (rule 42) test on the trimmed
          // run text — at least one Unicode letter, and
          // trimmed === trimmed.toUpperCase() AND trimmed
          // !== trimmed.toLowerCase(), so Persian/Dari/
          // Arabic caseless link text never flags and
          // mixed-case or lowercase text never flags.
          // Empty runs are excluded by the branch above
          // (already linkEmptyText). Independent of all
          // other link branches — no branch suppresses
          // another, so co-firing is legitimate.
          if (/\p{L}/u.test(trimmed)
            && trimmed === trimmed.toUpperCase()
            && trimmed !== trimmed.toLowerCase()) {
            push({ kind: 'linkTextAllCaps', linkIndex, href: runHref, linkText: trimmed })
          }
        }
        runHref = null
        runText = ''
      }
    }
    for (const child of node.content) {
      const href = linkHrefOf(child)
      if (href !== null) {
        if (runHref !== null && runHref === href) {
          runText += typeof child.text === 'string' ? child.text : ''
        } else {
          flush()
          runHref = href
          runText = typeof child.text === 'string' ? child.text : ''
        }
      } else {
        flush()
        // Recurse into nested containers (paragraphs, list items, table
        // cells, ...) with a fresh run state; non-text leaves have no
        // content array and are simply skipped.
        walkLinks(child)
      }
    }
    flush()
  }
  walkLinks(docJson)

  // Same link text, different destinations (P2-24, rule 16): a second,
  // independent pass over the runs collected above, so it neither
  // suppresses nor is suppressed by the empty/vague/URL-text branches
  // (a run may legitimately carry both a vague/URL issue and this one).
  // Empty runs are skipped entirely (already linkEmptyText). A run is
  // flagged only when its normalised text was already seen with a
  // DIFFERENT href — i.e. its href is new for that text: [A, A, B]
  // flags only B, and [A, B, A] flags only B (the third run's href A
  // was already seen for that text, so it is not a new destination).
  // A group with a single distinct href therefore never flags.
  const seenLinkHrefsByText = new Map<string, Set<string>>()
  for (const run of linkRuns) {
    if (run.linkText === '') continue
    const normalized = normalizeLinkText(run.linkText)
    let hrefs = seenLinkHrefsByText.get(normalized)
    if (!hrefs) {
      hrefs = new Set<string>()
      seenLinkHrefsByText.set(normalized, hrefs)
    } else if (!hrefs.has(run.href)) {
      push({ kind: 'linkSameTextDifferentTarget', linkIndex: run.linkIndex, href: run.href, linkText: run.linkText })
    }
    hrefs.add(run.href)
  }

  // Same destination, different link text (P2-27, rule 22): the inverse
  // of rule (16), a second independent pass over the same collected
  // runs, so it neither suppresses nor is suppressed by the
  // empty/vague/URL-text branches or by rule (16) — each pass flags on
  // its own grouping, and a run may legitimately carry both issues
  // (e.g. its text seen before with another href, its href seen before
  // with another text).
  // Runs are grouped by the EXACT href string. Empty runs are skipped
  // entirely (already linkEmptyText) and runs with href '' are skipped
  // entirely (already linkMissingHref) — neither establishes an earlier
  // run for its href. A run is flagged only when its normalised text
  // (the same normalisation as (7)) is NEW for that href while an
  // earlier run with the same href already exists: [Guide, Manual] to
  // one href flags only Manual, [Guide, Guide] flags nothing, and
  // [Guide, Manual, Guide] flags only Manual. A group with a single
  // distinct text therefore never flags.
  const seenLinkTextsByHref = new Map<string, Set<string>>()
  for (const run of linkRuns) {
    if (run.linkText === '' || run.href === '') continue
    const normalized = normalizeLinkText(run.linkText)
    let texts = seenLinkTextsByHref.get(run.href)
    if (!texts) {
      texts = new Set<string>()
      seenLinkTextsByHref.set(run.href, texts)
    } else if (!texts.has(normalized)) {
      push({ kind: 'linkSameTargetDifferentText', linkIndex: run.linkIndex, href: run.href, linkText: run.linkText })
    }
    texts.add(normalized)
  }

  return { issues, total: issues.length, counts }
}

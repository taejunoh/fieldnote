# American odds display plan

**Goal:** Show the Tennis decimal threshold 2.04 as American +104 in the existing compact overview, matching other sports without changing original recommendations.

**Design:** A pure display formatter recognizes unambiguous decimal odds gates and converts them deterministically. Existing signed American odds, ambiguous game lines, units, dates and surrounding conditions remain intact. Threshold rounding must be conservative; the underlying DTO, raw response, provenance manifest and stored records stay unchanged. Original decimal text remains available through the source conversation/tooltip.

**Workspace:** `<Fieldnote workspace>` only; forbidden parent GitHub repository receives no commits/pushes.

- [x] UI worker: add bounded pure formatter/tests and integrate table price rendering + a neutral price-column label, preserving all other UI behavior.
- [x] Independently review conversion/rounding/ambiguity handling; run focused and appropriate full tests/lint/TypeScript/build after source freeze.
- [x] Prepare clean web-only release with the exact already-approved private conditional manifest; no DB, worker, model or hosting changes.
- [x] Verify production runtime source hashes, raw gate preservation, actual displayed +104, original units/NB schedule, and desktop/mobile readability.

## Verification

948 tests / 64 files, full lint, TypeScript and final production build passed. Independent conversion/rounding/ambiguity review approved. Web-only deployment `804f8876-2ee8-4eed-a2b2-477737b67350` reached SUCCESS; four selected runtime hashes, including the unchanged private provenance manifest, match staging. Authenticated production overview visibly renders `+104 이상` with original tooltip `원문 가격 조건: 2.04 이상`; no horizontal overflow or console errors observed. Original prices, stored records, model instructions and worker are unchanged. No DB/model calls or GitHub commits/pushes. Local app restarted healthy after build. Private audit: SportsDesk/verification/private-verification/american-odds-display-20261027/final-verification.json.

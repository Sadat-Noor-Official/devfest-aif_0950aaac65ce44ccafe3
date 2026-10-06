# Tender Document Package Builder — AI DevFest 2026

A frontend-only web app for turning tender PDFs into one checked, correctly ordered submission package.

**Participant:** Sadat Noor  
**Registration:** `aif_0950aaac65ce44ccafe3`  
**Live HTTPS site:** `PASTE_LIVE_HTTPS_LINK_HERE`

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The static production output is written to `dist/` and can be deployed to Netlify, Vercel, GitHub Pages, or Cloudflare Pages as static frontend hosting.

## Main features completed

- Loads and validates `requirements.json`
- Shows tender metadata and requirements sorted by `order`
- Multi-PDF upload with 30-file / 50 MB limits
- Rejects non-PDF files with clear errors
- Reads PDF page counts locally in the browser
- Handles invalid/damaged/password-protected PDFs without crashing
- SHA-256 exact duplicate detection using Web Crypto
- Prevents duplicate copies from being assigned to different requirements
- One-to-one file ↔ requirement matching with undo/change support
- Expiry-date entry and deadline validation
- Exact five-status engine: Missing, Expiry date needed, Expired, Not provided, OK
- Generate button blocked whenever a blocking status exists
- Client-side final PDF generation with English cover page
- Matched documents are appended in requirement order with all original pages
- Optional unmatched documents are skipped
- Every final page gets `<tender_id> | Page X of Y`
- A reserved footer margin is added to document pages so original content is not covered
- Final download name is `<tender_id>_Package.pdf`
- Full English / Bangla UI switch for main labels, instructions, errors and statuses
- No document upload to a server; processing is local in the browser

## Bonus features completed

- Filename-based auto-match suggestions (reviewable; never forces ambiguous matches)
- Checklist CSV export

## Known limitations

- The generated cover is intentionally English only, as required by the problem statement.
- Auto-match is only a filename heuristic; users must verify suggested matches.
- Save/reopen project, index page, seal/signature placement, and Bangla text embedded into the generated PDF were not implemented so mandatory behavior stays reliable.
- Browser refresh clears uploaded PDF data and current matching state.

## AI tools used

- OpenAI ChatGPT (GPT-5.6 Sol) for implementation planning and code generation.

## Most useful prompt

> Build a production-ready, frontend-only React + Vite Tender Document Package Builder. Prioritize every mandatory AI DevFest requirement: JSON loading, multi-PDF upload, SHA-256 duplicate detection, one-to-one matching, expiry/status rules, bilingual UI, and exact client-side combined PDF generation with English cover and page footers. Do not add a backend or hardcode sample-pack filenames.

## Contest output checklist

Before final submission:

1. Run the app with the organizer-provided sample pack.
2. Resolve all mandatory-document statuses.
3. Generate the final sample package from the app.
4. Save it as `output/T-2026-0417_Package.pdf`.
5. Capture at least one screenshot that clearly shows document statuses and save it in `screenshots/`.
6. Replace `PASTE_LIVE_HTTPS_LINK_HERE` above with the public HTTPS deployment URL.
7. Verify the final deployment matches the final eligible commit.

## Privacy / architecture

All tender-document processing happens in the browser. The app has no backend, serverless functions, database, authentication requirement, or participant-controlled online storage.

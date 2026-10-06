# Sample Pack Test Guide

Use the organizer-provided `requirements.json` and files from `sample-pack/documents/`.

## Expected sample resolution

| Requirement | Select this file | Expiry date |
|---|---|---|
| R01 Trade License | `trade_license_2026.pdf` | `2027-06-30` |
| R02 TIN Certificate | `03_tin_certificate.pdf` | — |
| R03 VAT Registration Certificate | `04_vat_certificate.pdf` | — |
| R04 Bank Solvency Certificate | `bank_solvency.pdf` | `2026-12-31` |
| R05 Experience Certificate | ONE of the two `experience_cert` PDFs | — |
| R06 Audited Financial Statement | leave empty (optional) | — |
| R07 Manufacturer's Authorization | leave empty (optional) | — |
| R08 Technical Proposal | `02_technical_proposal.pdf` | — |
| R09 Financial Proposal | `01_financial_proposal.pdf` | — |
| R10 Signed Declaration | `scan_0042.pdf` | — |

## Hidden-problem checks

- `experience_cert.pdf` and `experience_cert (1).pdf` are byte-identical and must both show a duplicate warning.
- The app must prevent those two duplicate copies from being assigned to two different requirements.
- `company_logo.png` must be rejected because it is not a PDF.
- `trade_license_2025.pdf` expires on `2025-06-30`; when matched to R01 with that expiry it must show **Expired** and block generation.
- `trade_license_2026.pdf` expires on `2027-06-30`; it is valid for the `2026-10-20` tender deadline.
- `bank_solvency.pdf` expires on `2026-12-31`; it is valid for the deadline.
- `scan_0042.pdf` is image-based, so matching must not depend on extractable PDF text.

## Required status tests

1. Mandatory + no file → Missing → blocked.
2. Optional + no file → Not provided → not blocked.
3. Expiry-required + matched + empty date → Expiry date needed → blocked.
4. Expiry `2026-10-19` → Expired → blocked.
5. Expiry `2026-10-20` → OK.
6. Expiry `2026-10-21` → OK.
7. Remove a matched file → status immediately returns to Missing/Not provided.
8. Switch to বাংলা → main UI text/statuses switch and requirement titles use `title_bn`.

## Final PDF checks

After all blocking issues are resolved:

- filename: `T-2026-0417_Package.pdf`
- first page: English cover
- included documents: in requirement `order`
- all source pages retained in original order
- unmatched optional R06/R07 skipped
- every page, including cover: `T-2026-0417 | Page X of Y`
- footer does not cover original document content

Move the downloaded package into `output/T-2026-0417_Package.pdf`, then capture a screenshot showing the document status table and save it under `screenshots/`.

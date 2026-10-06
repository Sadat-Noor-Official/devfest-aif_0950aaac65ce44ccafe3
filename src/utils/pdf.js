import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const FOOTER_HEIGHT = 28
const A4 = [595.28, 841.89]

function safeText(value) {
  return value == null ? '' : String(value)
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = safeText(text).split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawLabelValue(page, font, bold, label, value, y) {
  page.drawText(`${label}:`, {
    x: 54,
    y,
    size: 10.5,
    font: bold,
    color: rgb(0.13, 0.17, 0.2),
  })
  const lines = wrapText(value, font, 10.5, 390)
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 165,
      y: y - index * 14,
      size: 10.5,
      font,
      color: rgb(0.16, 0.2, 0.24),
    })
  })
  return y - Math.max(1, lines.length) * 18
}

function addFooter(page, font, tenderId, pageNumber, totalPages) {
  const footer = `${tenderId} | Page ${pageNumber} of ${totalPages}`
  const size = 9
  const width = font.widthOfTextAtSize(footer, size)
  const pageWidth = page.getWidth()
  page.drawText(footer, {
    x: Math.max(16, (pageWidth - width) / 2),
    y: 9,
    size,
    font,
    color: rgb(0.2, 0.23, 0.26),
  })
}

export async function readPdfInfo(bytes) {
  const document = await PDFDocument.load(bytes)
  return { pageCount: document.getPageCount() }
}

export async function generateTenderPackage({ tender, requirements, files }) {
  const output = await PDFDocument.create()
  const regular = await output.embedFont(StandardFonts.Helvetica)
  const bold = await output.embedFont(StandardFonts.HelveticaBold)

  const fileById = new Map(files.map((file) => [file.id, file]))
  const included = requirements
    .filter((requirement) => requirement.matchedFileId)
    .sort((a, b) => a.order - b.order)

  const cover = output.addPage(A4)
  const { width, height } = cover.getSize()

  cover.drawRectangle({
    x: 0,
    y: height - 126,
    width,
    height: 126,
    color: rgb(0.035, 0.32, 0.34),
  })
  cover.drawText('TENDER DOCUMENT PACKAGE', {
    x: 54,
    y: height - 66,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  })
  cover.drawText('Complete submission package', {
    x: 54,
    y: height - 91,
    size: 11,
    font: regular,
    color: rgb(0.88, 0.97, 0.97),
  })

  let y = height - 165
  y = drawLabelValue(cover, regular, bold, 'Tender ID', tender.tender_id, y)
  y = drawLabelValue(cover, regular, bold, 'Tender title', tender.title, y)
  y = drawLabelValue(cover, regular, bold, 'Procuring entity', tender.procuring_entity, y)
  y = drawLabelValue(cover, regular, bold, 'Bidder', tender.bidder, y)
  y = drawLabelValue(cover, regular, bold, 'Submission deadline', tender.submission_deadline, y)
  const now = new Date()
  const madeDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  y = drawLabelValue(cover, regular, bold, 'Package made', madeDate, y)

  y -= 6
  cover.drawText('Included documents', {
    x: 54,
    y,
    size: 12.5,
    font: bold,
    color: rgb(0.035, 0.32, 0.34),
  })
  y -= 22

  included.forEach((requirement, index) => {
    const file = fileById.get(requirement.matchedFileId)
    const line = `${index + 1}. ${requirement.title_en} — ${file?.name || ''}`
    const wrapped = wrapText(line, regular, 9.7, width - 108)
    wrapped.forEach((part) => {
      if (y > 54) {
        cover.drawText(part, {
          x: 62,
          y,
          size: 9.7,
          font: regular,
          color: rgb(0.16, 0.2, 0.24),
        })
        y -= 14
      }
    })
  })

  for (const requirement of included) {
    const file = fileById.get(requirement.matchedFileId)
    if (!file) continue
    const source = await PDFDocument.load(file.bytes)
    const sourcePages = await output.copyPages(source, source.getPageIndices())
    sourcePages.forEach((page) => {
      const originalWidth = page.getWidth()
      const originalHeight = page.getHeight()
      page.setSize(originalWidth, originalHeight + FOOTER_HEIGHT)
      page.translateContent(0, FOOTER_HEIGHT)
      output.addPage(page)
    })
  }

  const pages = output.getPages()
  const totalPages = pages.length
  pages.forEach((page, index) => {
    addFooter(page, regular, tender.tender_id, index + 1, totalPages)
  })

  const pdfBytes = await output.save()
  return {
    bytes: pdfBytes,
    filename: `${tender.tender_id}_Package.pdf`,
    totalPages,
  }
}

export function downloadBytes(bytes, filename, mime = 'application/pdf') {
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

import { useMemo, useRef, useState } from 'react'
import { makeTranslator } from './utils/i18n.js'
import { sha256Hex, duplicateCounts, hasDuplicateAssignmentConflict } from './utils/duplicate.js'
import { getRequirementStatus, statusLabel } from './utils/status.js'
import { downloadBytes, generateTenderPackage, readPdfInfo } from './utils/pdf.js'

const MAX_FILES = 30
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[_\-()\d]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreFilename(fileName, title) {
  const fileTokens = new Set(normalizeName(fileName).split(' ').filter((token) => token.length > 2))
  const titleTokens = normalizeName(title).split(' ').filter((token) => token.length > 2)
  if (!titleTokens.length) return 0
  const hits = titleTokens.filter((token) => fileTokens.has(token)).length
  return hits / titleTokens.length
}

function validateRequirementsJson(data) {
  if (!data || typeof data !== 'object') return false
  const tender = data.tender
  if (!tender || typeof tender !== 'object') return false
  const requiredTenderStrings = ['tender_id', 'title', 'procuring_entity', 'bidder', 'submission_deadline']
  if (requiredTenderStrings.some((key) => typeof tender[key] !== 'string' || !tender[key].trim())) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tender.submission_deadline)) return false
  if (!Array.isArray(data.requirements)) return false

  return data.requirements.every((requirement) => (
    requirement &&
    typeof requirement.id === 'string' &&
    typeof requirement.order === 'number' &&
    Number.isFinite(requirement.order) &&
    typeof requirement.title_en === 'string' &&
    typeof requirement.title_bn === 'string' &&
    typeof requirement.mandatory === 'boolean' &&
    typeof requirement.has_expiry === 'boolean'
  ))
}

function App() {
  const [language, setLanguage] = useState('en')
  const t = useMemo(() => makeTranslator(language), [language])
  const [requirementsFileName, setRequirementsFileName] = useState('')
  const [tender, setTender] = useState(null)
  const [requirements, setRequirements] = useState([])
  const [files, setFiles] = useState([])
  const [messages, setMessages] = useState([])
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const pdfInputRef = useRef(null)

  const counts = useMemo(() => duplicateCounts(files), [files])
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])
  const statusRows = useMemo(() => {
    if (!tender) return []
    return requirements.map((requirement) => ({
      requirement,
      status: getRequirementStatus(requirement, tender.submission_deadline),
    }))
  }, [requirements, tender])

  const duplicateConflict = useMemo(
    () => hasDuplicateAssignmentConflict(requirements, files),
    [requirements, files],
  )

  const blockingRows = statusRows.filter(({ status }) => status.blocking)
  const canGenerate = Boolean(tender) && blockingRows.length === 0 && !duplicateConflict

  const summary = useMemo(() => ({
    total: statusRows.length,
    ok: statusRows.filter(({ status }) => status.key === 'ok').length,
    blocking: blockingRows.length + (duplicateConflict ? 1 : 0),
    optional: statusRows.filter(({ status }) => status.key === 'not_provided').length,
  }), [statusRows, blockingRows.length, duplicateConflict])

  function pushMessages(nextMessages) {
    if (!nextMessages.length) return
    setMessages((current) => [...nextMessages, ...current].slice(0, 8))
  }

  async function handleJsonFile(file) {
    if (!file) return
    setNotice('')
    try {
      const text = await file.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        pushMessages([t('jsonInvalid')])
        return
      }
      if (!validateRequirementsJson(data)) {
        pushMessages([t('jsonStructureInvalid')])
        return
      }

      const sorted = [...data.requirements]
        .sort((a, b) => a.order - b.order)
        .map((requirement) => ({ ...requirement, matchedFileId: '', expiry: '' }))

      setTender(data.tender)
      setRequirements(sorted)
      setRequirementsFileName(file.name)
      setFiles([])
      setMessages([])
      setNotice(t('jsonLoaded'))
    } catch {
      pushMessages([t('jsonReadFailed')])
    }
  }

  async function addPdfFiles(fileList) {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return
    setNotice('')
    if (!tender) {
      pushMessages([t('needRequirements')])
      return
    }

    const currentNames = new Set(files.map((file) => `${file.name}::${file.size}::${file.lastModified}`))
    const nextFiles = [...files]
    const errors = []
    let runningBytes = totalBytes

    for (const source of incoming) {
      const identity = `${source.name}::${source.size}::${source.lastModified}`
      if (currentNames.has(identity)) {
        errors.push(t('sameFileAlreadyAdded', { name: source.name }))
        continue
      }
      const extensionIsPdf = source.name.toLowerCase().endsWith('.pdf')
      const mimeIsAcceptable = !source.type || source.type === 'application/pdf'
      if (!extensionIsPdf || !mimeIsAcceptable) {
        errors.push(t('nonPdfRejected', { name: source.name }))
        continue
      }
      if (nextFiles.length >= MAX_FILES) {
        errors.push(t('tooManyFiles', { name: source.name }))
        continue
      }
      if (runningBytes + source.size > MAX_TOTAL_BYTES) {
        errors.push(t('totalTooLarge', { name: source.name }))
        continue
      }

      try {
        const arrayBuffer = await source.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        const { pageCount } = await readPdfInfo(bytes)
        const hash = await sha256Hex(bytes)
        nextFiles.push({
          id: crypto.randomUUID(),
          name: source.name,
          size: source.size,
          lastModified: source.lastModified,
          pageCount,
          hash,
          bytes,
        })
        currentNames.add(identity)
        runningBytes += source.size
      } catch {
        errors.push(t('invalidPdf', { name: source.name }))
      }
    }

    setFiles(nextFiles)
    pushMessages(errors)
  }

  function removeFile(fileId) {
    setFiles((current) => current.filter((file) => file.id !== fileId))
    setRequirements((current) => current.map((requirement) => (
      requirement.matchedFileId === fileId
        ? { ...requirement, matchedFileId: '', expiry: '' }
        : requirement
    )))
  }

  function clearAllFiles() {
    if (!files.length) return
    if (!window.confirm(t('confirmClear'))) return
    setFiles([])
    setRequirements((current) => current.map((requirement) => ({
      ...requirement,
      matchedFileId: '',
      expiry: '',
    })))
  }

  function fileIsUnavailableForRequirement(file, requirementId) {
    const assignedElsewhere = requirements.some(
      (requirement) => requirement.id !== requirementId && requirement.matchedFileId === file.id,
    )
    if (assignedElsewhere) return true

    return requirements.some((requirement) => {
      if (requirement.id === requirementId || !requirement.matchedFileId) return false
      const assignedFile = files.find((candidate) => candidate.id === requirement.matchedFileId)
      return assignedFile?.hash === file.hash
    })
  }

  function updateMatch(requirementId, fileId) {
    if (fileId) {
      const file = files.find((candidate) => candidate.id === fileId)
      if (file && fileIsUnavailableForRequirement(file, requirementId)) {
        pushMessages([t('duplicateAssignmentBlocked')])
        return
      }
    }

    setRequirements((current) => current.map((requirement) => (
      requirement.id === requirementId
        ? {
            ...requirement,
            matchedFileId: fileId,
            expiry: fileId ? requirement.expiry : '',
          }
        : requirement
    )))
  }

  function updateExpiry(requirementId, expiry) {
    setRequirements((current) => current.map((requirement) => (
      requirement.id === requirementId ? { ...requirement, expiry } : requirement
    )))
  }

  function suggestMatches() {
    if (!tender || !files.length) return
    const usedIds = new Set(requirements.map((requirement) => requirement.matchedFileId).filter(Boolean))
    const usedHashes = new Set(
      files.filter((file) => usedIds.has(file.id)).map((file) => file.hash),
    )

    setRequirements((current) => current.map((requirement) => {
      if (requirement.matchedFileId) return requirement
      const candidates = files
        .filter((file) => !usedIds.has(file.id) && !usedHashes.has(file.hash))
        .map((file) => ({ file, score: scoreFilename(file.name, requirement.title_en) }))
        .filter(({ score }) => score >= 0.5)
        .sort((a, b) => b.score - a.score)

      if (!candidates.length) return requirement
      const winner = candidates[0]
      const second = candidates[1]
      if (second && second.score === winner.score) return requirement
      usedIds.add(winner.file.id)
      usedHashes.add(winner.file.hash)
      return { ...requirement, matchedFileId: winner.file.id }
    }))
    setNotice(t('autoMatchDone'))
  }

  async function handleGenerate() {
    if (!canGenerate || !tender) return
    setGenerating(true)
    setNotice('')
    try {
      const result = await generateTenderPackage({ tender, requirements, files })
      downloadBytes(result.bytes, result.filename)
      setNotice(t('generatedSuccess'))
    } catch (error) {
      console.error(error)
      pushMessages([t('generationFailed')])
    } finally {
      setGenerating(false)
    }
  }

  function exportChecklistCsv() {
    if (!tender) return
    const fileById = new Map(files.map((file) => [file.id, file]))
    const header = ['Order', 'Document', 'File name', 'Pages', 'Expiry date', 'Status']
    const rows = statusRows.map(({ requirement, status }) => {
      const file = fileById.get(requirement.matchedFileId)
      return [
        requirement.order,
        language === 'bn' ? requirement.title_bn : requirement.title_en,
        file?.name || '',
        file?.pageCount || '',
        requirement.expiry || '',
        statusLabel(status.key, t),
      ]
    })
    const escape = (value) => `"${String(value).replaceAll('"', '""')}"`
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
    downloadBytes(new TextEncoder().encode('\ufeff' + csv), `${tender.tender_id}_Checklist.csv`, 'text/csv;charset=utf-8')
  }

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files])
  const matchedRequirementByFileId = useMemo(() => {
    const map = new Map()
    requirements.forEach((requirement) => {
      if (requirement.matchedFileId) map.set(requirement.matchedFileId, requirement)
    })
    return map
  }, [requirements])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <h1>{t('appTitle')}</h1>
            <p>{t('appSubtitle')}</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="privacy-pill">🔒 {t('privacyNote')}</span>
          <div className="language-toggle" aria-label="Language">
            <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>{t('english')}</button>
            <button className={language === 'bn' ? 'active' : ''} onClick={() => setLanguage('bn')}>{t('bangla')}</button>
          </div>
        </div>
      </header>

      <main className="main-content">
        {messages.length > 0 && (
          <div className="alert alert-error" role="alert">
            <div>
              <strong>{t('errorTitle')}</strong>
              <ul>{messages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
            </div>
            <button className="icon-button" onClick={() => setMessages([])} aria-label={t('dismiss')}>×</button>
          </div>
        )}

        {notice && <div className="alert alert-success">✓ {notice}</div>}

        <section className="panel">
          <div className="section-heading">
            <div><span className="eyebrow">JSON</span><h2>{t('step1')}</h2><p>{t('jsonHelp')}</p></div>
            <label className="button secondary">
              {requirementsFileName ? t('replaceJson') : t('chooseJson')}
              <input type="file" accept=".json,application/json" hidden onChange={(event) => handleJsonFile(event.target.files?.[0])} />
            </label>
          </div>

          {requirementsFileName && <div className="loaded-file"><span>✓</span><strong>{t('loadedFile')}:</strong> {requirementsFileName}</div>}

          {tender && (
            <div className="tender-card">
              <div className="tender-card-title">{t('tenderOverview')}</div>
              <dl>
                <div><dt>{t('tenderId')}</dt><dd>{tender.tender_id}</dd></div>
                <div><dt>{t('tenderTitle')}</dt><dd>{tender.title}</dd></div>
                <div><dt>{t('procuringEntity')}</dt><dd>{tender.procuring_entity}</dd></div>
                <div><dt>{t('bidder')}</dt><dd>{tender.bidder}</dd></div>
                <div><dt>{t('submissionDeadline')}</dt><dd>{tender.submission_deadline}</dd></div>
              </dl>
            </div>
          )}
        </section>

        <section className={`panel ${!tender ? 'disabled-panel' : ''}`}>
          <div className="section-heading">
            <div><span className="eyebrow">PDF</span><h2>{t('step2')}</h2><p>{t('uploadHelp')}</p></div>
            {files.length > 0 && <button className="button ghost" onClick={clearAllFiles}>{t('clearAll')}</button>}
          </div>

          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); if (tender) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addPdfFiles(event.dataTransfer.files) }}
            onClick={() => tender && pdfInputRef.current?.click()}
            role="button"
            tabIndex={tender ? 0 : -1}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tender) pdfInputRef.current?.click() }}
          >
            <div className="upload-icon">⇧</div>
            <strong>{t('dropFiles')}</strong>
            <span>{t('orBrowse')}</span>
            <button type="button" className="button primary" disabled={!tender}>{t('choosePdfs')}</button>
            <input ref={pdfInputRef} type="file" multiple hidden onChange={(event) => { addPdfFiles(event.target.files); event.target.value = '' }} />
          </div>

          <div className="upload-meta"><span>{files.length}/{MAX_FILES} {t('fileCount')}</span><span>{formatBytes(totalBytes)} / 50 MB {t('totalSize')}</span></div>

          <div className="subsection-heading"><h3>{t('uploadedFiles')}</h3></div>
          {files.length === 0 ? (
            <div className="empty-state">{t('noFiles')}</div>
          ) : (
            <div className="file-list">
              {files.map((file) => {
                const duplicate = (counts.get(file.hash) || 0) > 1
                const matched = matchedRequirementByFileId.get(file.id)
                return (
                  <div className="file-row" key={file.id}>
                    <div className="pdf-badge">PDF</div>
                    <div className="file-main"><strong title={file.name}>{file.name}</strong><span>{file.pageCount} {file.pageCount === 1 ? t('pageSingular') : t('pagePlural')} · {formatBytes(file.size)}</span></div>
                    <div className="file-tags">
                      <span className={`tag ${duplicate ? 'tag-warn' : 'tag-muted'}`}>{duplicate ? `⚠ ${t('duplicateGroup')}` : t('unique')}</span>
                      <span className="tag tag-match">{matched ? (language === 'bn' ? matched.title_bn : matched.title_en) : t('unassigned')}</span>
                    </div>
                    <button className="button danger-text" onClick={() => removeFile(file.id)}>{t('remove')}</button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className={`panel ${!tender ? 'disabled-panel' : ''}`}>
          <div className="section-heading">
            <div><span className="eyebrow">{t('checkEyebrow')}</span><h2>{t('step3')}</h2><p>{t('checklistHelp')}</p></div>
            <div className="inline-actions">
              <button className="button secondary" onClick={suggestMatches} disabled={!tender || !files.length}>{t('autoMatch')}</button>
              <button className="button ghost" onClick={exportChecklistCsv} disabled={!tender}>{t('exportCsv')}</button>
            </div>
          </div>

          {tender && (
            <>
              <div className="summary-grid">
                <div className="summary-card"><span>{t('totalRequirements')}</span><strong>{summary.total}</strong></div>
                <div className="summary-card ok"><span>{t('ok')}</span><strong>{summary.ok}</strong></div>
                <div className="summary-card danger"><span>{t('blocking')}</span><strong>{summary.blocking}</strong></div>
                <div className="summary-card muted"><span>{t('optionalNotProvided')}</span><strong>{summary.optional}</strong></div>
              </div>

              <div className="table-wrap">
                <table className="checklist-table">
                  <thead><tr><th>{t('order')}</th><th>{t('requirement')}</th><th>{t('type')}</th><th>{t('selectedFile')}</th><th>{t('expiryDate')}</th><th>{t('status')}</th></tr></thead>
                  <tbody>
                    {statusRows.map(({ requirement, status }) => {
                      const currentFile = fileById.get(requirement.matchedFileId)
                      return (
                        <tr key={requirement.id}>
                          <td className="order-cell">{requirement.order}</td>
                          <td><div className="requirement-title"><strong>{language === 'bn' ? requirement.title_bn : requirement.title_en}</strong><span>{requirement.id}</span></div></td>
                          <td><span className={`tag ${requirement.mandatory ? 'tag-required' : 'tag-muted'}`}>{requirement.mandatory ? t('mandatory') : t('optional')}</span></td>
                          <td>
                            <select value={requirement.matchedFileId} onChange={(event) => updateMatch(requirement.id, event.target.value)}>
                              <option value="">{t('selectFile')}</option>
                              {files.map((file) => {
                                const unavailable = fileIsUnavailableForRequirement(file, requirement.id) && file.id !== currentFile?.id
                                return <option key={file.id} value={file.id} disabled={unavailable}>{file.name}{(counts.get(file.hash) || 0) > 1 ? ` ⚠ ${t('duplicate')}` : ''}</option>
                              })}
                            </select>
                          </td>
                          <td>
                            {requirement.has_expiry && requirement.matchedFileId
                              ? <input type="date" value={requirement.expiry} onChange={(event) => updateExpiry(requirement.id, event.target.value)} />
                              : <span className="na">{t('notApplicable')}</span>}
                          </td>
                          <td><span className={`status status-${status.key}`}>{statusLabel(status.key, t)}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className={`panel generate-panel ${!tender ? 'disabled-panel' : ''}`}>
          <div className="section-heading">
            <div><span className="eyebrow">PDF</span><h2>{t('step4')}</h2><p>{t('generateHelp')}</p></div>
          </div>

          {tender && (
            <div className="generate-layout">
              <div className={`generation-status ${canGenerate ? 'ready' : 'blocked'}`}>
                {canGenerate ? (
                  <><div className="status-icon">✓</div><div><strong>{t('readyToGenerate')}</strong><p>{t('footerSafe')}</p></div></>
                ) : (
                  <><div className="status-icon">!</div><div><strong>{t('blockedTitle')}</strong><ul>{blockingRows.map(({ requirement, status }) => <li key={requirement.id}>{language === 'bn' ? requirement.title_bn : requirement.title_en}: {statusLabel(status.key, t)}</li>)}{duplicateConflict && <li>{t('duplicateConflict')}</li>}</ul></div></>
                )}
              </div>
              <button className="button primary large" onClick={handleGenerate} disabled={!canGenerate || generating}>{generating ? t('generating') : t('generate')}</button>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">{t('architectureFooter')}</footer>
    </div>
  )
}

export default App

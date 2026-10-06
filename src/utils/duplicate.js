export async function sha256Hex(bytes) {
  const normalized = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const source = normalized.buffer.slice(
    normalized.byteOffset,
    normalized.byteOffset + normalized.byteLength,
  )
  const digest = await crypto.subtle.digest('SHA-256', source)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function duplicateCounts(files) {
  const counts = new Map()
  files.forEach((file) => counts.set(file.hash, (counts.get(file.hash) || 0) + 1))
  return counts
}

export function hasDuplicateAssignmentConflict(requirements, files) {
  const fileById = new Map(files.map((file) => [file.id, file]))
  const hashToRequirementIds = new Map()

  for (const requirement of requirements) {
    if (!requirement.matchedFileId) continue
    const file = fileById.get(requirement.matchedFileId)
    if (!file) continue
    const reqs = hashToRequirementIds.get(file.hash) || []
    reqs.push(requirement.id)
    hashToRequirementIds.set(file.hash, reqs)
  }

  return Array.from(hashToRequirementIds.values()).some((ids) => ids.length > 1)
}

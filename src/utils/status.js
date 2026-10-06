export function getRequirementStatus(requirement, submissionDeadline) {
  const hasFile = Boolean(requirement.matchedFileId)

  if (!hasFile && requirement.mandatory) {
    return { key: 'missing', blocking: true }
  }

  if (!hasFile && !requirement.mandatory) {
    return { key: 'not_provided', blocking: false }
  }

  if (requirement.has_expiry && !requirement.expiry) {
    return { key: 'expiry_needed', blocking: true }
  }

  if (
    requirement.has_expiry &&
    requirement.expiry &&
    requirement.expiry < submissionDeadline
  ) {
    return { key: 'expired', blocking: true }
  }

  return { key: 'ok', blocking: false }
}

export const statusTranslationKeys = {
  missing: 'statusMissing',
  expiry_needed: 'statusExpiryNeeded',
  expired: 'statusExpired',
  not_provided: 'statusNotProvided',
  ok: 'statusOk',
}

export function statusLabel(statusKey, t) {
  return t(statusTranslationKeys[statusKey] || statusKey)
}

/** Canonical UUIDs make operation IDs stable across retries and durable recovery. */
export function validMaintenanceId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function validMaintenanceSerial(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(value)
}

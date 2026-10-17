import {isIP} from 'node:net'

export type ImageMounter = 'go-ios' | 'pymobiledevice3'

export function selectedTunnel(tunnels: unknown, udid: string): Record<string, unknown> {
  const tunnel = Array.isArray(tunnels) && tunnels.find(t =>
    t && typeof t === 'object' && (t.udid === udid || t.Udid === udid))
  if (!tunnel) {
    throw new Error('No go-ios tunnel for this iPhone; start the tunnel agent first')
  }
  return tunnel
}

export function rsdEndpoint(tunnel: Record<string, unknown>): [string, string] {
  if (tunnel.userspaceTun) {
    throw new Error('pymobiledevice3 requires a kernel go-ios tunnel; disable --userspace')
  }
  const address = tunnel.address
  const port = tunnel.rsdPort
  if (typeof address !== 'string' || !isIP(address) ||
      typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Selected go-ios tunnel has no valid address/rsdPort for pymobiledevice3')
  }
  return [address, String(port)]
}

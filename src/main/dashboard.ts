import { execFile } from 'node:child_process'

// Match known VPN clients/adapters by name or description.
const VPN_RE =
  /(vpn|wireguard|wintun|tap-?win|tap-windows|fortinet|forticlient|fortissl|forti\b|netbird|openvpn|tunnel|nordlynx|zerotier|tailscale|globalprotect|pangp|anyconnect|softether|sangfor|check\s*point|outline|\bppp\b|\btun\b|\btap\b)/i

// WireGuard/Wintun tunnels (NetBird uses one) can linger as "Up" after disconnect,
// so we trust `netbird status` for these and exclude them from the adapter heuristic.
const TUNNEL_RE = /(wireguard|wintun|utun|netbird|\btun\b)/i

let cached = false

/** Last known VPN state (synchronous, for the broadcast payload). */
export function vpnCached(): boolean {
  return cached
}

/** Detect VPN and update the cache. */
export async function refreshVpn(): Promise<boolean> {
  cached = await detect()
  return cached
}

async function detect(): Promise<boolean> {
  const nb = await netbirdStatus()
  if (nb === 'connected') return true
  // Other VPN clients (Forti/Windscribe/OpenVPN…) via adapter status; drop tunnels
  // when NetBird's own status is authoritative to avoid the lingering-adapter false positive.
  return adaptersVpn(nb !== 'unknown')
}

/** Ask NetBird for its real connection state. */
async function netbirdStatus(): Promise<'connected' | 'disconnected' | 'unknown'> {
  const out =
    (await run('netbird', ['status'])) ??
    (await run('C:\\Program Files\\NetBird\\netbird.exe', ['status']))
  if (out === null) return 'unknown'
  return /Management:\s*Connected/i.test(out) ? 'connected' : 'disconnected'
}

async function adaptersVpn(excludeTunnels: boolean): Promise<boolean> {
  const out = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress"
  ])
  if (!out || !out.trim()) return false
  try {
    const parsed = JSON.parse(out)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.some((a) => {
      const text = `${a?.Name ?? ''} ${a?.InterfaceDescription ?? ''}`
      if (excludeTunnels && TUNNEL_RE.test(text)) return false
      return VPN_RE.test(text)
    })
  } catch {
    return false
  }
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

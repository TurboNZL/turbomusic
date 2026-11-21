import { networkInterfaces } from 'node:os';

/**
 * The addresses other devices on the same network can use to reach this server (`http://192.168.1.20:47813`), most likely first.
 * Loopback, link-local (169.254) and container-bridge style names are left out. Lets the now-playing widget (OBS cannot send the
 * Cloudflare Access headers) use the home network instead of the tunnel.
 */
export function lanAddresses(port: number, ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: { name: string; ip: string }[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (/^(docker|br-|veth|virbr|lo$|tailscale|zt|utun)/i.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, ip: a.address });
    }
  }
  // private ranges first (192.168, 10, 172.16-31), wired/wifi names before the rest
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a.ip) - rank(b.ip) || a.name.localeCompare(b.name)).map((x) => `http://${x.ip}:${port}`);
}

import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();

const v4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, Cloud-Metadaten
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // Multicast
  ['240.0.0.0', 4], // reserviert + Broadcast
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');

const v6: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // Dokumentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // Multicast
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, 'ipv6');

/** Wandelt IPv4-mapped IPv6 (::ffff:a.b.c.d bzw. ::ffff:7f00:1) in die enthaltene IPv4-Adresse um. */
function unmapV4(address: string): string | null {
  const m = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(address);
  if (!m) return null;
  const tail = m[1]!;
  if (isIP(tail) === 4) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** true, wenn die Adresse nicht öffentlich routbar ist (oder nicht als IP geparst werden kann). */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(bare);
  if (family === 0) return true;
  if (family === 4) return blocked.check(bare, 'ipv4');
  const mapped = unmapV4(bare);
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(bare, 'ipv6');
}

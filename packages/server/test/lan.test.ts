import { describe, expect, it } from 'vitest';
import { lanAddresses } from '../src/lan.ts';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });
describe('lanAddresses', () => {
  it('lists reachable private addresses, home network first, and skips loopback, link-local and bridges', () => {
    const out = lanAddresses(47813, { lo: [v4('127.0.0.1', true)], docker0: [v4('172.17.0.1')], eth0: [v4('10.0.0.5')], wlan0: [v4('192.168.1.20'), v4('169.254.3.3')] } as never);
    expect(out).toEqual(['http://192.168.1.20:47813', 'http://10.0.0.5:47813']);
  });
});

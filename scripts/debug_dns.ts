import { resolve4, resolveNs } from '../lib/dns-cache';

async function test() {
    try {
        console.log("NS Lookup:", await resolveNs('1791financialserviceshq.com'));
    } catch (e: any) {
        console.log("NS ERR Code:", e.code, "Message:", e.message);
    }

    try {
        console.log("MX/A Lookup:", await resolve4('aspmx.l.google.com'));
    } catch (e: any) {
        console.log("A ERR Code:", e.code, "Message:", e.message);
    }
}

test();

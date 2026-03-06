import fs from 'fs';
const text = fs.readFileSync('out_domains.txt', { encoding: 'utf16le' });
const lines = text.split('\n');
for (const line of lines) {
    if (line.includes('[!] LISTED')) {
        const parts = line.split(':');
        console.log("LISTED ON:", parts[0].replace('[!] LISTED on ', ''));
    }
}

const URL = `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS7922`;

function parseCIDR(cidr) {
    const [ip, bits] = cidr.split('/');
    const mask = parseInt(bits);
    const ipParts = ip.split('.').map(Number);
    const ipNum = (ipParts[0] << 24) +
        (ipParts[1] << 16) +
        (ipParts[2] << 8) +
        ipParts[3];
    const hostBits = 32 - mask;

    return { ipNum, hostBits, mask };
}

function numToIP(num) {
    return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
    ].join('.');
}

function generateRandomIP(cidr) {
    const { ipNum, hostBits } = parseCIDR(cidr);
    const maxHosts = Math.pow(2, hostBits) - 2;
    const randomHost = Math.floor(Math.random() * maxHosts) + 1;

    return numToIP(ipNum + randomHost);
}

async function fetchComcastCIDRs() {
    const response = await fetch(URL);
    if (!response.ok) {
        throw new Error(`BGP API failed with status: ${response.status}`);
    }

    const data = await response.json();
    const prefixes = data.data?.prefixes || [];

    if (prefixes.length === 0) {
        throw new Error('No prefixes found from API');
    }

    const cidrs = prefixes
        .map(p => p.prefix)
        .filter(cidr => {
            if (cidr.includes(':')) return false;
            const mask = parseInt(cidr.split('/')[1]);
            return mask >= 12 && mask <= 24;
        });

    if (cidrs.length === 0) {
        throw new Error('No valid IPv4 residential ranges found');
    }

    return cidrs;
}

async function updateHeaderRules(ip) {
    const rules = [{
        id: 1,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [
                {
                    header: 'X-Forwarded-For',
                    operation: 'set',
                    value: ip
                }
            ]
        },
        condition: {
            urlFilter: '*://*.doublecounter.gg/*',
            resourceTypes: [
                'main_frame',
                'sub_frame',
                'xmlhttprequest',
                'script',
                'image',
                'font',
                'stylesheet',
                'media',
                'other'
            ]
        }
    }];

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1],
            addRules: rules
        });
    } catch (err) {
        console.error('Error updating rules:', err);
    }
}

async function rotateIP() {
    try {
        const cidrs = await fetchComcastCIDRs();
        const randomCIDR = cidrs[Math.floor(Math.random() * cidrs.length)];
        const randomIP = generateRandomIP(randomCIDR);

        await updateHeaderRules(randomIP);
    } catch (err) {
        console.error('Failed to rotate IP:', err);
    }
}
chrome.webNavigation.onBeforeNavigate.addListener(
    async (details) => {
        if (details.frameId === 0) {
            await rotateIP();
        }
    },
    { 
        url: [{ 
            hostSuffix: 'doublecounter.gg' 
        }]
    }
);

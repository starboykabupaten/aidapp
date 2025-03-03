const readline = require('readline');
const colors = require('colors');
const fs = require('fs');
const axios = require('axios');
const { Web3 } = require("web3");
const { HttpsProxyAgent } = require('https-proxy-agent');

const CONFIG = {
    TOKEN_FILE: 'data.txt',
    PROXY_FILE: 'proxy.txt',
    MIN_INTERVAL: 10000,
    MAX_INTERVAL: 30000,
    MAX_FAILED_ATTEMPTS: 3,
};

let proxyList = [];
let axiosConfig = {};

const config = {
    baseUrl: 'https://back.aidapp.com',
    campaignId: '6b963d81-a8e9-4046-b14f-8454bc3e6eb2',
    excludedMissionId: 'f8edb0b4-ac7d-4a32-8522-65c5fb053725', // Task Invite 1 friend
    headers: {
        'authority': 'back.aidapp.com',
        'accept': '*/*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.6',
        'origin': 'https://my.aidapp.com',
        'referer': 'https://my.aidapp.com/',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Brave";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'sec-gpc': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    }
};

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
        case 'success':
            console.log(`[${timestamp}] [✓] ${msg}`.green);
            break;
        case 'custom':
            console.log(`[${timestamp}] [*] ${msg}`.magenta);
            break;
        case 'error':
            console.log(`[${timestamp}] [✗] ${msg}`.red);
            break;
        case 'warning':
            console.log(`[${timestamp}] [!] ${msg}`.yellow);
            break;
        default:
            console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
    }
}

function readProxies() {
    try {
        const proxyFile = fs.readFileSync('proxy.txt', 'utf8');
        proxyList = proxyFile.split('\n')
            .filter(line => line.trim())
            .map(proxy => {
                proxy = proxy.trim();
                if (!proxy.includes('://')) {
                    return `http://${proxy}`;
                }
                return proxy;
            });

        if (proxyList.length === 0) {
            throw new Error('No proxies found in proxy.txt');
        }
        log(`Loaded ${proxyList.length} proxies from proxy.txt`);
        return true;
    } catch (error) {
        log(`Error reading proxies: ${error.message}`, 'error');
        return false;
    }
}


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const askQuestion = (query) => {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
};

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        const timestamp = new Date().toLocaleTimeString();
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`.magenta);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
}

function getProxyAgent(proxyUrl) {
    try {
        const isSocks = proxyUrl.toLowerCase().startsWith('socks');
        if (isSocks) {
            const { SocksProxyAgent } = require('socks-proxy-agent');
            return new SocksProxyAgent(proxyUrl);
        }
        return new HttpsProxyAgent(proxyUrl.startsWith('http') ? proxyUrl : `http://${proxyUrl}`);
    } catch (error) {
        log(`Error creating proxy agent: ${error.message}`, 'error');
        return null;
    }
}

async function checkIP() {
    try {
        const response = await axios.get('https://api.ipify.org?format=json', axiosConfig);
        const ip = response.data.ip;
        log(`Current IP: ${ip}`, 'info');
        return true;
    } catch (error) {
        log(`Failed to get IP: ${error.message}`, 'error');
        return false;
    }
}

async function getRandomProxy() {
    let proxyAttempt = 0;
    while (proxyAttempt < proxyList.length) {
        const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
        try {
            const agent = getProxyAgent(proxy);
            if (!agent) continue;

            axiosConfig.httpsAgent = agent;
            await checkIP();
            return true;
        } catch (error) {
            proxyAttempt++;
        }
    }

    log('Using default IP');
    axiosConfig = {};
    await checkIP();
    return false;
}

async function saveToFile(filename, data) {
    try {
        await fs.appendFile(filename, `${data}\n`, 'utf-8');
        logger.info(`Data saved to ${filename}`);
    } catch (error) {
        logger.error(`Failed to save data to ${filename}: ${error.message}`);
    }
}

async function createWallet() {
    const web3 = new Web3();
    const wallet = web3.eth.accounts.create();
    return wallet;
}

async function getAvailableMissions(accessToken) {
    try {
        const currentDate = new Date().toISOString();
        const response = await axios.get(
            `${config.baseUrl}/questing/missions?filter%5Bdate%5D=${currentDate}&filter%5Bgrouped%5D=true&filter%5Bprogress%5D=true&filter%5Brewards%5D=true&filter%5Bstatus%5D=AVAILABLE&filter%5BcampaignId%5D=${config.campaignId}`,
            {
                headers: {
                    ...config.headers,
                    'authorization': `Bearer ${accessToken}`
                },
                axiosConfig
            }
        );

        return response.data.data.filter(mission =>
            mission.progress === "0" && mission.id !== config.excludedMissionId
        );
    } catch (error) {
        console.error('Error fetching available missions:', error.response?.data || error.message);
        return [];
    }
}

async function completeMission(missionId, accessToken) {
    try {
        const response = await axios.post(
            `${config.baseUrl}/questing/mission-activity/${missionId}`,
            {},
            {
                headers: {
                    ...config.headers,
                    'authorization': `Bearer ${accessToken}`,
                    'content-length': '0'
                },
                axiosConfig
            }
        );

        console.log(`Mission ${missionId} completed successfully!`);
        return true;
    } catch (error) {
        console.error(`Error completing mission ${missionId}:`, error.response?.data || error.message);
        return false;
    }
}

async function claimMissionReward(missionId, accessToken) {
    try {
        const response = await axios.post(
            `${config.baseUrl}/questing/mission-reward/${missionId}`,
            {},
            {
                headers: {
                    ...config.headers,
                    'authorization': `Bearer ${accessToken}`,
                    'content-length': '0'
                },
                axiosConfig
            }
        );

        console.log(`Reward for mission ${missionId} claimed successfully!`);
        return true;
    } catch (error) {
        console.error(`Error claiming reward for mission ${missionId}:`, error.response?.data || error.message);
        return false;
    }
}

async function autoRef(count, refCode) {
    try {
        for (let i = 0; i < count; i++) {
            const wallet = await createWallet();
            log(`Đã tạo ví mới: ${wallet.address}`, 'success');
            const web3 = new Web3();
            const { signature } = web3.eth.accounts.sign('Login', wallet.privateKey);
            const timestamp = Date.now();
            const timeNow = `${timestamp}:${timestamp}`;
            getRandomProxy();

            let url = `https://back.aidapp.com/user-auth/login?strategy=WALLET&chainType=EVM&address=${wallet.address}&token=MESSAGE_ETHEREUM_${timeNow}&signature=${signature}&inviter=${refCode}`;
            const response = await axios.get(url, {
                headers: {
                    ...config.headers,
                },
                axiosConfig
            });

            if (response.data.error) {
                log(`Error processing wallet: ${response.data.error}`, 'error');
                continue;
            }

            let dataLogin = response.data;
            let accessToken = dataLogin.tokens.access_token;

            const availableMissions = await getAvailableMissions(accessToken);
            if (availableMissions.length === 0) {
                log('No available missions to complete for this token.', 'warning');
                continue;
            }

            log(`Found ${availableMissions.length} missions to complete.`, 'info');
            for (const mission of availableMissions) {
                log(`Processing mission: ${mission.label} (ID: ${mission.id})`);

                const completed = await completeMission(mission.id, accessToken);
                if (completed) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await claimMissionReward(mission.id, accessToken);
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            log(`Finished processing ${i + 1}`, 'success');
            const walletData = {
                address: wallet.address,
                privateKey: wallet.privateKey,
                refCode: dataLogin.user.refCode,
            }

            saveToFile('wallet_success.txt', JSON.stringify(walletData));

            await countdown(1000);
        }

        log('Đã hoàn thành tạo ví', 'success');
        return true;
    } catch (error) {
        log(`Error processing wallet: ${error.message}`, 'error');
        return false;
    }
}

async function readWallets() {
    try {
        await fs.access("wallets.json");
        const data = await fs.readFile("wallets.json", "utf-8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info("No wallets found in wallets.json");
            return [];
        }
        throw err;
    }
}

async function autoTask() {
    try {
        let wallets = await readWallets(); console.log(wallets);

        if (wallets.length === 0) {
            log('No wallets found in wallets.json', 'error');
            return;
        }

        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            const { address, privateKey } = wallet;

            const web3 = new Web3();
            const { signature } = web3.eth.accounts.sign('Login', privateKey);
            const timestamp = Date.now();
            const timeNow = `${timestamp}:${timestamp}`;

            let url = `https://back.aidapp.com/user-auth/login?strategy=WALLET&chainType=EVM&address=${address}&token=MESSAGE_ETHEREUM_${timeNow}&signature=${signature}&inviter=`;
            const response = await axios.get(url, {
                headers: {
                    ...config.headers,
                },
                axiosConfig
            });

            if (response.data.error) {
                log(`Login error: ${response.data.error}`, 'error');
                continue;
            }

            let dataLogin = response.data;
            let accessToken = dataLogin.tokens.access_token;

            const availableMissions = await getAvailableMissions(accessToken);
            if (availableMissions.length === 0) {
                log('No available missions to complete for this token.', 'warning');
                continue;
            }

            log(`Found ${availableMissions.length} missions to complete.`, 'info');
            for (const mission of availableMissions) {
                log(`Processing mission: ${mission.label} (ID: ${mission.id})`);

                const completed = await completeMission(mission.id, accessToken);
                if (completed) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await claimMissionReward(mission.id, accessToken);
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            log(`Finished wallet ${i + 1}`, 'success');
        }
    } catch (error) {
        log(`Error auto task: ${error.message}`, 'error');
        return false;
    }
}

async function runBot() {
    const proxies = readProxies();
    if (proxies.length === 0) {
        log('Không tìm thấy proxy trong file proxy.txt. Vui lòng kiểm tra lại', 'error');
        return;
    }

    //const action = await askQuestion('Bạn muốn chạy autoRef hay autoTask? (ref/task): ');
    const action = 'ref';
    if (action === 'task') {
        log('Tính năng đang phát triển...', 'warning');
        return;
    }

    if (action === 'ref') {
        const refCode = await askQuestion('Vui lòng nhập mã ref (Enter để bỏ qua): ');
        const countWallet = await askQuestion('Vui lòng nhập số lượng ví muốn tạo: ');

        log('Đang chạy bot...', 'custom');
        await autoRef(countWallet, refCode);
    }
}

runBot().catch(error => {
    console.error('Bot encountered an error:', error);
});
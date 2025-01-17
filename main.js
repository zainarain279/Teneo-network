const WebSocket = require("ws");
const fs = require("fs/promises");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const colors = require("colors");
const axios = require("axios");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

function headers(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    Referer: "https://dashboard.teneo.pro/",
    Origin: "https://dashboard.teneo.pro",
    "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

async function readFile(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const tokens = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    return tokens;
  } catch (error) {
    console.error("Error reading file:", error.message);
    return [];
  }
}
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

class WebSocketClient {
  constructor(token, proxy = null, accountIndex, proxyIP) {
    this.token = token;
    this.proxy = proxy;
    this.proxyIp = proxyIP;
    this.accountIndex = accountIndex;

    this.socket = null;
    this.pingInterval = null;
    this.reconnectAttempts = 0;
    this.wsUrl = "wss://secure.ws.teneo.pro";
    this.version = "v0.2";
  }

  log(msg, type = "info") {
    switch (type) {
      case "success":
        console.log(`[*][Account ${this.accountIndex + 1}]${this.proxyIp ? `[${this.proxyIp}]` : ""} | ${msg}`.green);
        break;
      case "custom":
        console.log(`[*][Account ${this.accountIndex + 1}]${this.proxyIp ? `[${this.proxyIp}]` : ""} | ${msg}`.magenta);
        break;
      case "error":
        console.log(`[!] ${msg}`.red);
        break;
      case "warning":
        console.log(`[*][Account ${this.accountIndex + 1}]${this.proxyIp != "Local" ? `[${this.proxyIp}]` : ""} | ${msg}`.yellow);
        break;
      default:
        console.log(`[*][Account ${this.accountIndex + 1}]${this.proxyIp != "Local" ? `[${this.proxyIp}]` : ""} | ${msg}`.blue);
    }
  }

  async connect() {
    const wsUrl = `${this.wsUrl}/websocket?accessToken=${encodeURIComponent(this.token)}&version=${encodeURIComponent(this.version)}`;

    const options = {};
    if (this.proxy) {
      options.agent = new HttpsProxyAgent(this.proxy);
    }

    this.socket = new WebSocket(wsUrl, options);

    this.socket.onopen = () => {
      const connectionTime = new Date().toISOString();
      console.log(`[Account ${this.accountIndex + 1}] WebSocket connected at`.green, connectionTime);
      this.reconnectAttempts = 0;
      this.startPinging();
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const message = `[${data?.date || new Date().toLocaleDateString()}] Message: ${data?.message} | Points: ${data?.pointsTotal || 0} | wating ${15} minutes to next ping...`;
      console.log(`[Account ${this.accountIndex + 1}] Received message from WebSocket:`, `${message}`.green);
    };

    this.socket.onclose = () => {
      this.log("WebSocket disconnected", "warning");
      this.stopPinging();
      this.reconnect();
    };

    this.socket.onerror = (error) => {
      console.log(`[Account ${this.accountIndex + 1}] WebSocket error: `.red, error.message);
    };
  }

  reconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.log(`Reconnecting in ${delay / 1000} seconds...`);
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.stopPinging();
    }
  }

  startPinging() {
    this.stopPinging();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "PING" }));
      }
    }, 10000);
  }

  stopPinging() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
async function checkProxyIP(proxy) {
  try {
    const proxyAgent = new HttpsProxyAgent(proxy);
    const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
    if (response.status === 200) {
      return response.data.ip;
    }
  } catch (error) {}
  return null;
}

async function getRef(proxy, token) {
  const url = "https://api.teneo.pro/api/users/referrals";
  let config = {
    method: "get",
    headers: {
      ...headers(token),
    },
  };
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    config = {
      ...config,
      httpsAgent: agent,
    };
  }

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error:", error.response ? error.response.data : error.message);
    return null;
  }
}

async function claimRef(proxy, ref, token) {
  const url = "https://api.teneo.pro/api/users/referrals/claim";
  let config = {
    body: JSON.stringify({
      referralId: ref.id,
    }),
    method: "post",
    headers: {
      ...headers(token),
    },
  };
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    config = {
      ...config,
      httpsAgent: agent,
    };
  }

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error:", error.response ? error.response.data : error.message);
    return null;
  }
}

async function handleRef(accountIndex, proxy, token) {
  const resInfo = await getRef(proxy, token);

  if (resInfo?.success) {
    const { referrals, successfulReferralsAmount, totalReferralPoints, pendingReferralsAmount } = resInfo;
    console.log(`[Account ${accountIndex + 1}] Ref success: ${successfulReferralsAmount} | Ref pending: ${pendingReferralsAmount} | Points ref: ${totalReferralPoints} | Checking ref reward...`.blue);
    const refClaims = referrals.filter((r) => r.canClaim);
    if (refClaims.length == 0) {
      console.log(`[Account ${accountIndex + 1}] No rewards ref to claim`.yellow);
      return;
    }

    for (const referral of refClaims) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const resClaim = await claimRef(proxy, referral, token);
      if (resClaim?.success) {
        console.log(`[Account ${accountIndex + 1}] Claimed referral: ${referral.id} | Points: ${referral.invitedPoints}`.green);
      } else {
        console.log(`[Account ${accountIndex + 1}] Failed to claim referral: ${referral.id}`.yellow);
      }
    }
  }
}

async function main() {
  try {
    const tokens = await readFile("tokens.txt");
    rl.question("Do you want to use a proxy? (y/n): ".blue, async (useProxyAnswer) => {
      let useProxy = useProxyAnswer.toLowerCase() === "y";
      let proxies = [];

      if (useProxy) {
        proxies = await readFile("proxies.txt");
      }

      if (tokens.length > 0) {
        const wsClients = [];

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          const proxy = proxies[i % proxies.length] || null;
          let proxyIP = null;
          if (proxy) {
            try {
              proxyIP = await checkProxyIP(proxy);
            } catch (error) {
              console.log(`Cannot check proxy IP: ${error.message}...skipping`.yellow);
              continue;
            }
          }

          await handleRef(i, proxy, token);

          console.log(`Connecting WebSocket for account: ${i + 1} - Proxy: ${proxy || "None"}`.blue);

          const wsClient = new WebSocketClient(token, proxy, i, proxyIP);
          wsClient.connect();
          wsClients.push(wsClient);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        process.on("SIGINT", () => {
          console.log("Program exited. Stopping pinging and disconnecting All WebSockets...".yellow);
          wsClients.forEach((client) => client.stopPinging());
          wsClients.forEach((client) => client.disconnect());
          process.exit(0);
        });
      } else {
        console.log("No tokens found in tokens.txt - exiting...".yellow);
        process.exit(0);
      }
    });
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

main();

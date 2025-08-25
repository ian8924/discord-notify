import fetch from "node-fetch";
import { Client, GatewayIntentBits } from "discord.js";

const DISCORD_BOT_TOKEN = "";
const CHANNEL_ID = "1374934627860349109";

// 價格跳漲通知配置
let PUMP_THRESHOLD = 5; // 漲幅閾值 (百分比)
const PRICE_HISTORY = new Map(); // 存儲價格歷史
const NOTIFICATION_COOLDOWN = 30 * 60 * 1000; // 30分鐘冷卻期
const LAST_NOTIFICATIONS = new Map(); // 記錄上次通知時間

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  setInterval(fetchAndSendPrice, 15 * 1000); // 每 5 分鐘
  fetchAndSendPrice(); // 啟動時立即一次
});

// 可選：加入訊息查詢指令
client.on("messageCreate", async (msg) => {
  if (msg.content.startsWith("!price")) {
    const [, coin] = msg.content.split(" ");
    if (!coin) return;
    const symbol = `${coin.toUpperCase()}-USDT`;
    try {
      const price = await fetchBingXPrice(symbol);
      msg.reply(`${coin.toUpperCase()}/USDT 價格為：$${price}`);
    } catch {
      msg.reply(`查無 ${coin.toUpperCase()}，請確認輸入是否正確。`);
    }
  }

  // 設置跳漲閾值指令
  if (msg.content.startsWith("!setpump")) {
    const [, threshold] = msg.content.split(" ");
    const newThreshold = parseFloat(threshold);

    if (isNaN(newThreshold) || newThreshold <= 0) {
      msg.reply("❌ 請輸入有效的跳漲閾值（大於 0 的數字）");
      return;
    }

    PUMP_THRESHOLD = newThreshold;
    msg.reply(`✅ 跳漲通知閾值已設置為 ${newThreshold}%`);
  }

  // 查看當前設置
  if (msg.content === "!pumpinfo") {
    msg.reply(`📊 跳漲通知設置：
    📈 閾值：${PUMP_THRESHOLD}%
    ⏰ 冷卻期：${NOTIFICATION_COOLDOWN / 60000} 分鐘
    🔍 監控時間窗口：10 分鐘`);
  }
});

async function fetchBingXPrice(symbol) {
  const url = `https://open-api.bingx.com/openApi/spot/v1/ticker/price?symbol=${symbol}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`BingX API error: ${json.msg}`);
  return json.data[0].trades[0].price;
}

async function fetchAndSendPrice() {
  try {
    const btc = await fetchBingXPrice("BTC_USDT");
    const eth = await fetchBingXPrice("ETH_USDT");

    // 檢查價格跳漲
    await checkPricePump("BTC", "BTC_USDT", btc);
    await checkPricePump("ETH", "ETH_USDT", eth);

    const message = `📊 BingX 價格更新：
    🟠 BTC/USDT：$${btc}
    🔷 ETH/USDT：$${eth}`;

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (channel) {
      channel.send(message);
    }
  } catch (err) {
    console.error("🚫 發送失敗：", err.message);
  }
}

// 檢查價格跳漲並發送通知
async function checkPricePump(coinName, symbol, currentPrice) {
  const now = Date.now();
  const price = parseFloat(currentPrice);

  // 初始化價格歷史
  if (!PRICE_HISTORY.has(symbol)) {
    PRICE_HISTORY.set(symbol, []);
  }

  const priceHistory = PRICE_HISTORY.get(symbol);
  priceHistory.push({ price, timestamp: now });

  // 只保留最近 30 分鐘的數據
  const thirtyMinutesAgo = now - 30 * 60 * 1000;
  PRICE_HISTORY.set(
    symbol,
    priceHistory.filter((p) => p.timestamp > thirtyMinutesAgo)
  );

  // 需要至少有 2 個價格點才能計算漲幅
  if (priceHistory.length < 2) return;

  // 檢查冷卻期
  const lastNotification = LAST_NOTIFICATIONS.get(symbol);
  if (lastNotification && now - lastNotification < NOTIFICATION_COOLDOWN) {
    return;
  }

  // 計算短期漲幅 (與 10 分鐘前比較)
  const tenMinutesAgo = now - 10 * 60 * 1000;
  const oldPrices = priceHistory.filter((p) => p.timestamp <= tenMinutesAgo);

  if (oldPrices.length === 0) return;

  const oldPrice = oldPrices[oldPrices.length - 1].price;
  const pumpPercentage = ((price - oldPrice) / oldPrice) * 100;

  // 如果漲幅超過閾值，發送通知
  if (pumpPercentage >= PUMP_THRESHOLD) {
    await sendPumpNotification(
      coinName,
      symbol,
      oldPrice,
      price,
      pumpPercentage
    );
    LAST_NOTIFICATIONS.set(symbol, now);
  }
}

// 發送跳漲通知
async function sendPumpNotification(
  coinName,
  symbol,
  oldPrice,
  newPrice,
  pumpPercentage
) {
  try {
    const message = `🚀 價格跳漲警報！
    
💰 ${coinName}/USDT 短期暴漲 ${pumpPercentage.toFixed(2)}%！
📈 從 $${oldPrice.toFixed(4)} 漲到 $${newPrice.toFixed(4)}
⏰ 檢測時間：${new Date().toLocaleString("zh-TW")}

⚠️ 請注意風險管理！`;

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (channel) {
      await channel.send(message);
      console.log(
        `🚀 發送跳漲通知：${coinName} +${pumpPercentage.toFixed(2)}%`
      );
    }
  } catch (err) {
    console.error("🚫 發送跳漲通知失敗：", err.message);
  }
}

client.login(DISCORD_BOT_TOKEN);

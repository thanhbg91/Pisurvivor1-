import express from "express";
import path from "path";
import dotenv from "dotenv";
import { TransactionBuilder, Keypair } from "@stellar/stellar-sdk";

dotenv.config();

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files in public directory (like validation-key.txt)
app.use(express.static(path.join(process.cwd(), "public")));

// Standard API health endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV });
});

// Endpoint to check backend PI_API_KEY integration status securely
app.get("/api/pi/status", (req, res) => {
  res.json({
    success: true,
    configured: !!process.env.PI_API_KEY,
    sandbox: process.env.VITE_PI_SANDBOX !== "false",
  });
});

// Helper function to call Pi Network Platform API
async function callPiApi(endpoint, method, body) {
  const apiKey = process.env.PI_API_KEY;
  if (!apiKey) {
    throw new Error("PI_API_KEY is not configured in the server environment variables.");
  }

  const url = `https://api.minepi.com${endpoint}`;
  const headers = {
    Authorization: `Key ${apiKey}`,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pi API returned status ${response.status}: ${errorText}`);
  }

  return response.json();
}

// 0. AUTHENTICATE / VALIDATE user endpoint
app.post("/api/pi/authenticate", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: "accessToken is required" });
    }

    console.log(`[Pi Backend] Validating pioneer access token against Pi Platform API...`);
    const response = await fetch("https://api.minepi.com/v2/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Pi Backend] Pi Platform API token validation failed (status ${response.status}): ${errorText}`);
      return res.status(response.status).json({ error: `Pi Network API token validation failed: ${errorText}` });
    }

    const userData = await response.json();
    console.log("[Pi Backend] Pioneer validation successful. User data:", userData);

    res.json({ success: true, user: userData });
  } catch (error) {
    console.error("[Pi Backend] Exception during user authentication:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 1. APPROVE payment endpoint
app.post("/api/pi/approve", async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ error: "paymentId is required" });
    }

    console.log(`[Pi Backend] Approving payment ${paymentId}...`);
    const result = await callPiApi(`/v2/payments/${paymentId}/approve`, "POST");
    console.log(`[Pi Backend] Payment ${paymentId} approved successfully:`, result);

    res.json({ success: true, result });
  } catch (error) {
    console.error("[Pi Backend] Error approving payment:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. COMPLETE payment endpoint
app.post("/api/pi/complete", async (req, res) => {
  try {
    const { paymentId, txid } = req.body;
    if (!paymentId || !txid) {
      return res.status(400).json({ error: "paymentId and txid are required" });
    }

    console.log(`[Pi Backend] Completing payment ${paymentId} with TX ${txid}...`);
    const result = await callPiApi(`/v2/payments/${paymentId}/complete`, "POST", { txid });
    console.log(`[Pi Backend] Payment ${paymentId} completed successfully:`, result);

    res.json({ success: true, result });
  } catch (error) {
    console.error("[Pi Backend] Error completing payment:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. SELL coins (App-to-User payment) endpoint
app.post("/api/pi/sell", async (req, res) => {
  try {
    const { uid, username, amountCoins, piAmount } = req.body;
    if (!uid || !amountCoins || !piAmount) {
      return res.status(400).json({ error: "Missing uid, amountCoins, or piAmount" });
    }

    console.log(`[Pi Backend] Process sell request: Pioneer @${username || uid} wants to sell ${amountCoins} xu for ${piAmount} Pi`);

    // Verify if API Key is configured
    const apiKey = process.env.PI_API_KEY;
    if (!apiKey) {
      console.log(`[Pi Backend] PI_API_KEY is not configured. Simulating transaction on sandbox/test mode.`);
      return res.json({
        success: true,
        simulated: true,
        message: "No PI_API_KEY configured. Transaction simulated successfully.",
        amountCoins,
        piAmount
      });
    }

    // Since API Key is configured, we require a Wallet Seed to perform real payouts.
    // If it is missing, we gracefully fall back to a simulated transaction so the user can still test the flow.
    const walletSeed = process.env.PI_WALLET_SEED;
    if (!walletSeed) {
      console.warn(`[Pi Backend] PI_WALLET_SEED is missing while PI_API_KEY is configured. Falling back to simulated transaction so the user can test the payout flow.`);
      return res.json({
        success: true,
        simulated: true,
        message: "Chưa cấu hình PI_WALLET_SEED trên Server. Giao dịch được mô phỏng thành công.",
        amountCoins,
        piAmount
      });
    }

    // Try to perform a real App-to-User payment on Pi Platform API
    try {
      console.log(`[Pi Backend] Requesting Pi Platform to create App-to-User payment...`);
      const paymentResponse = await callPiApi("/v2/payments", "POST", {
        payment: {
          amount: Number(piAmount),
          memo: `Thanh toan doi ${amountCoins} Xu sang Pi cho Pioneer ${username || uid}`,
          metadata: { type: "sell_xu", xuAmount: amountCoins },
          uid: uid
        }
      });

      console.log(`[Pi Backend] App-to-User payment created on Pi API:`, paymentResponse);

      console.log(`[Pi Backend] PI_WALLET_SEED is configured. Proceeding with real blockchain signing of App-to-User payout...`);
      const paymentId = paymentResponse.id;
      const txEnvelope = paymentResponse.network_tx_envelope;
      
      const passphrase = process.env.VITE_PI_SANDBOX !== "false" ? "Pi Testnet" : "Pi Network";
      console.log(`[Pi Backend] Using Network Passphrase: "${passphrase}"`);
      
      // Load and sign transaction
      const tx = TransactionBuilder.fromEnvelope(txEnvelope, { networkPassphrase: passphrase });
      const keypair = Keypair.fromSecret(walletSeed);
      tx.sign(keypair);
      
      const txid = tx.hash().toString('hex');
      console.log(`[Pi Backend] Transaction signed. TXID: ${txid}. Submitting to Pi Network Platform...`);
      
      // Submit A2U payment
      const submitResponse = await callPiApi(`/v2/payments/${paymentId}/submit`, "POST", { txid });
      console.log(`[Pi Backend] Payment submitted successfully. Response:`, submitResponse);
      
      // Complete A2U payment
      console.log(`[Pi Backend] Completing payment acknowledgement...`);
      const completeResponse = await callPiApi(`/v2/payments/${paymentId}/complete`, "POST", { txid });
      console.log(`[Pi Backend] Payment completed successfully. Response:`, completeResponse);
      
      return res.json({
        success: true,
        simulated: false,
        txid,
        payment: completeResponse
      });

    } catch (apiError) {
      console.error(`[Pi Backend] Pi Platform API error during App-to-User payment:`, apiError);
      return res.status(500).json({
        error: `Lỗi Pi Platform API: ${apiError.message || apiError}. Vui lòng kiểm tra ví Developer (đủ số dư rút Pi?) hoặc Key cấu hình.`
      });
    }

  } catch (error) {
    console.error("[Pi Backend] Error processing sell request:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default app;

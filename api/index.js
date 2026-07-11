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
    let errorObj = null;
    try {
      errorObj = JSON.parse(errorText);
    } catch (e) {
      // Not JSON
    }
    const err = new Error(`Pi API returned status ${response.status}: ${errorText}`);
    err.status = response.status;
    err.body = errorObj || errorText;
    throw err;
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

    // Enforce withdrawal rate and flat 0.1 Pi fee:
    // Rate: 20000 Coins = 1 Pi (Deposit is 10,000 Coins = 1 Pi)
    // Withdrawal fee: 0.1 Pi
    const rate = 20000;
    const grossPi = Number((amountCoins / rate).toFixed(7));
    const fee = 0.1;
    const expectedNetPi = Number((grossPi - fee).toFixed(7));

    // Ensure the net Pi is positive and matches the client's request
    if (expectedNetPi <= 0) {
      return res.status(400).json({ 
        error: `Số xu rút quá ít. Tối thiểu là 4000 xu để nhận Pi dương sau khi trừ phí rút cố định 0.1 Pi.` 
      });
    }

    if (Math.abs(Number(piAmount) - expectedNetPi) > 0.0001) {
      return res.status(400).json({ 
        error: `Số lượng Pi không khớp với tỷ giá: Yêu cầu ${amountCoins} xu ứng với thực nhận ${expectedNetPi} Pi (sau khi trừ phí rút cố định 0.1 Pi).` 
      });
    }

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
      let paymentResponse;
      try {
        console.log(`[Pi Backend] Requesting Pi Platform to create App-to-User payment...`);
        paymentResponse = await callPiApi("/v2/payments", "POST", {
          payment: {
            amount: Number(piAmount),
            memo: `Thanh toan doi ${amountCoins} Xu sang Pi cho Pioneer ${username || uid}`,
            metadata: { type: "sell_xu", xuAmount: amountCoins },
            uid: uid
          }
        });
        console.log(`[Pi Backend] App-to-User payment created on Pi API:`, paymentResponse);
      } catch (apiError) {
        if (apiError.status === 400 && apiError.body && apiError.body.error === "ongoing_payment_found" && apiError.body.payment) {
          console.log(`[Pi Backend] Ongoing payment found! Attempting to complete the existing ongoing payment instead...`);
          paymentResponse = apiError.body.payment;
        } else {
          throw apiError;
        }
      }

      console.log(`[Pi Backend] PI_WALLET_SEED is configured. Analyzing payment state...`);
      console.log(`[Pi Backend] Payment ID: ${paymentResponse.id}`);
      console.log(`[Pi Backend] Payment status:`, JSON.stringify(paymentResponse.status || {}));
      console.log(`[Pi Backend] Payment keys:`, Object.keys(paymentResponse));

      const paymentId = paymentResponse.id;
      const txEnvelope = paymentResponse.network_tx_envelope;
      
      // 1. Check if the payment is already fully completed on the blockchain/developer server
      const isCompleted = paymentResponse.status && (
        paymentResponse.status.developer_completed === true ||
        paymentResponse.status.blockchain_committed === true
      );

      if (isCompleted) {
        console.log(`[Pi Backend] Payment ${paymentId} is already completed. Returning success.`);
        return res.json({
          success: true,
          simulated: false,
          txid: paymentResponse.transaction?.txid || "unknown",
          payment: paymentResponse
        });
      }

      // 2. Check if the payment is already submitted or verified (meaning transaction exists)
      const existingTxid = paymentResponse.transaction?.txid;
      if (existingTxid && !txEnvelope) {
        console.log(`[Pi Backend] Payment ${paymentId} has already been submitted to the blockchain (TXID: ${existingTxid}) but not yet completed. Completing it now...`);
        try {
          const completeResponse = await callPiApi(`/v2/payments/${paymentId}/complete`, "POST", { txid: existingTxid });
          console.log(`[Pi Backend] Payment ${paymentId} completed successfully on callback:`, completeResponse);
          return res.json({
            success: true,
            simulated: false,
            txid: existingTxid,
            payment: completeResponse
          });
        } catch (completeErr) {
          console.error(`[Pi Backend] Error trying to complete already-submitted transaction:`, completeErr);
          throw new Error(`Giao dịch đã được gửi lên Blockchain (TXID: ${existingTxid}) nhưng không thể hoàn tất: ${completeErr.message}`);
        }
      }

      // 3. Handle cases where network_tx_envelope is missing
      if (!txEnvelope) {
        // Identify if it is a User-to-App payment instead of App-to-User
        // In User-to-App payment, the recipient is the app/developer, and the sender is the user.
        // A2U payment is from app/developer to user.
        const isUserToApp = paymentResponse.recipient === "app" || 
                            (paymentResponse.recipient && !paymentResponse.recipient.includes(uid)) ||
                            paymentResponse.direction === "user_to_app";

        if (isUserToApp) {
          throw new Error(
            `Phát hiện một giao dịch NẠP Pi (User-to-App) chưa hoàn tất (ID: ${paymentId}, Trạng thái: ${JSON.stringify(paymentResponse.status || {})}). ` +
            `Vui lòng quay lại màn hình chính, hệ thống sẽ tự động đồng bộ và hoàn tất giao dịch nạp đó trước khi bạn có thể thực hiện giao dịch Rút Pi này.`
          );
        }

        // If it's not a User-to-App payment, explain what happened but fall back to a simulated transaction
        // so that the player is not blocked and does not lose their experience.
        console.warn(`[Pi Backend] 'network_tx_envelope' is missing for payment ${paymentId}. Falling back to simulated transaction.`);
        return res.json({
          success: true,
          simulated: true,
          message: `[MÔ PHỎNG] ${piAmount} π (Pi Network chưa tạo được bản nháp blockchain do Ví Developer chưa được liên kết, thiếu số dư Pi hoặc chưa được cấp quyền A2U)`,
          amountCoins,
          piAmount
        });
      }
      
      const passphrase = process.env.VITE_PI_SANDBOX !== "false" ? "Pi Testnet" : "Pi Network";
      console.log(`[Pi Backend] Using Network Passphrase: "${passphrase}"`);
      
      // Load and sign transaction
      const tx = TransactionBuilder.fromXDR(txEnvelope, passphrase);
      const keypair = Keypair.fromSecret(walletSeed);
      tx.sign(keypair);
      
      const txid = tx.hash().toString('hex');
      console.log(`[Pi Backend] Transaction signed. TXID: ${txid}. Submitting to Pi Network Platform...`);
      
      // Submit A2U payment
      let submitResponse;
      try {
        submitResponse = await callPiApi(`/v2/payments/${paymentId}/submit`, "POST", { txid });
        console.log(`[Pi Backend] Payment submitted successfully. Response:`, submitResponse);
      } catch (submitErr) {
        console.warn(`[Pi Backend] Submit step warning or error (payment may already be submitted):`, submitErr.message);
      }
      
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

// server.js — Enhanced with MongoDB persistence

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// ✅ Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });


// ✅ Mongoose Schema
const prepaymentSchema = new mongoose.Schema({
  month: Number,
  amount: Number,
});

const loanSchema = new mongoose.Schema({
  principal: Number,
  annualRate: Number,
  emi: Number,
  totalTenure: Number,
  paidEmis: Number,
  prepayments: [prepaymentSchema],
  outstandingAfterPrepayments: Number,
  keepEMI: Object,
  reduceEMI: Object,
  simLog: Array,
  createdAt: { type: Date, default: Date.now },
  lastCalculatedAt: Date,
});

const Loan = mongoose.model("Loan", loanSchema);

// ✅ Helper functions
function round(x) {
  return Math.round(x);
}

function amortizeUntilPaid(balance, monthlyRate, emi, maxMonths = 1000) {
  const out = [];
  let month = 0;
  while (balance > 0 && month < maxMonths) {
    month++;
    const interest = round(balance * monthlyRate);
    let principal = emi - interest;
    if (principal <= 0) throw new Error("EMI too small to cover interest.");
    if (principal > balance) principal = balance;
    const emiPaid = interest + principal;
    balance = round(balance - principal);
    out.push({
      month,
      emi_paid: emiPaid,
      principal,
      interest,
      remaining: Math.max(balance, 0),
    });
  }
  return out;
}

function computeEMI(balance, monthlyRate, months) {
  if (months <= 0) return 0;
  const factor = Math.pow(1 + monthlyRate, months);
  return Math.round((balance * monthlyRate * factor) / (factor - 1));
}

// ✅ Save or Update Loan
app.post("/api/loan", async (req, res) => {
  try {
    const { principal, annualRate, emi, totalTenure, paidEmis, prepayments } = req.body;

    let loan = await Loan.findOne();
    if (!loan) loan = new Loan({ principal, annualRate, emi, totalTenure, paidEmis, prepayments });
    else {
      loan.principal = principal;
      loan.annualRate = annualRate;
      loan.emi = emi;
      loan.totalTenure = totalTenure;
      loan.paidEmis = paidEmis;
      loan.prepayments = prepayments;
    }

    await loan.save();
    res.json({ status: "saved", loan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save loan data" });
  }
});

// ✅ Fetch latest loan data
app.get("/api/loan", async (req, res) => {
  try {
    const loan = await Loan.findOne();
    if (!loan) return res.status(404).json({ message: "No loan found" });
    res.json(loan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch loan" });
  }
});

// ✅ Recalculate loan
app.post("/api/reschedule", async (req, res) => {
  try {
    const {
      officialSchedule,
      principal,
      annualRate = 8.35,
      emi,
      totalTenure = 180,
      paidEmis = 0,
      prepayments = [],
    } = req.body;

    // 🔹 Find or create loan
    let loan = await Loan.findOne();
    if (!loan) loan = new Loan({ principal, annualRate, emi, totalTenure, paidEmis, prepayments });
    else {
      loan.principal = principal;
      loan.annualRate = annualRate;
      loan.emi = emi;
      loan.totalTenure = totalTenure;
      loan.paidEmis = paidEmis;
      loan.prepayments = prepayments;
    }

    const monthlyRate = (Number(annualRate) / 100) / 12;
    let outstanding;

    // 🔹 Compute current outstanding
    if (officialSchedule && Array.isArray(officialSchedule) && officialSchedule.length >= Math.max(0, paidEmis)) {
      outstanding = paidEmis === 0
        ? (principal ? Number(principal) : Number(officialSchedule[0].Outstanding))
        : Number(officialSchedule[paidEmis - 1].Outstanding);
    } else if (typeof principal !== "undefined") {
      outstanding = Number(principal);
      for (let m = 1; m <= paidEmis; m++) {
        const interest = round(outstanding * monthlyRate);
        let principalPart = emi - interest;
        if (principalPart > outstanding) principalPart = outstanding;
        outstanding = round(outstanding - principalPart);
      }
    } else {
      return res.status(400).json({
        error: "Provide either officialSchedule or principal + paidEmis to derive outstanding.",
      });
    }

    // 🔹 Apply prepayments
    const prepayMap = {};
    (prepayments || []).forEach((p) => {
      const mm = Number(p.month);
      const aa = Number(p.amount);
      if (!mm || aa <= 0) return;
      prepayMap[mm] = (prepayMap[mm] || 0) + aa;
    });

    const simLog = [];
    let currentMonth = paidEmis;
    const lastPrepayMonth = Object.keys(prepayMap).length
      ? Math.max(...Object.keys(prepayMap).map(Number))
      : paidEmis;
    const simulateTargetMonth = Math.max(lastPrepayMonth, paidEmis);

    while (currentMonth < simulateTargetMonth) {
      currentMonth += 1;
      const interest = round(outstanding * monthlyRate);
      let principalPart = emi - interest;
      if (principalPart > outstanding) principalPart = outstanding;
      const emiPaid = interest + principalPart;
      outstanding = round(outstanding - principalPart);
      simLog.push({ month: currentMonth, action: "EMI", emi_paid: emiPaid, interest, principal: principalPart, remaining_after_emi: outstanding });

      if (prepayMap[currentMonth]) {
        const before = outstanding;
        outstanding = Math.max(0, round(outstanding - prepayMap[currentMonth]));
        simLog.push({
          month: currentMonth,
          action: "PREPAY",
          prepay_amount: prepayMap[currentMonth],
          before,
          remaining_after_prepay: outstanding,
        });
      }
    }

    if (prepayMap[paidEmis]) {
      const before = outstanding;
      outstanding = Math.max(0, round(outstanding - prepayMap[paidEmis]));
      simLog.unshift({
        month: paidEmis,
        action: "PREPAY_AFTER_ALREADY_PAID_EMI",
        prepay_amount: prepayMap[paidEmis],
        before,
        remaining_after_prepay: outstanding,
      });
    }

    const outstandingAfterPrepayments = outstanding;

    // 🔹 Keep EMI (reduce tenure)
    let keepEMI = { monthsToFinish: 0, schedule: [], totalInterest: 0 };
    try {
      const denom = emi - outstandingAfterPrepayments * monthlyRate;
      if (denom <= 0) {
        keepEMI.monthsToFinish = Infinity;
        keepEMI.totalInterest = Infinity;
      } else {
        const n = Math.log(emi / denom) / Math.log(1 + monthlyRate);
        const monthsToFinish = Math.ceil(n);
        keepEMI.monthsToFinish = monthsToFinish;
        keepEMI.schedule = amortizeUntilPaid(outstandingAfterPrepayments, monthlyRate, emi, monthsToFinish + 5);
        keepEMI.totalInterest = keepEMI.schedule.reduce((s, r) => s + r.interest, 0);
      }
    } catch (err) {
      keepEMI.error = err.message;
    }

    // 🔹 Reduce EMI (keep tenure)
    const monthsDone = simulateTargetMonth;
    const remainingOfficial = totalTenure - monthsDone;
    let reduceEMI = { newEmi: 0, remainingSchedule: [], totalInterest: 0 };

    if (remainingOfficial > 0) {
      const newEmi = computeEMI(outstandingAfterPrepayments, monthlyRate, remainingOfficial);
      reduceEMI.newEmi = newEmi;
      reduceEMI.remainingSchedule = amortizeUntilPaid(outstandingAfterPrepayments, monthlyRate, newEmi, remainingOfficial + 5);
      if (reduceEMI.remainingSchedule.length > remainingOfficial)
        reduceEMI.remainingSchedule = reduceEMI.remainingSchedule.slice(0, remainingOfficial);
      reduceEMI.totalInterest = reduceEMI.remainingSchedule.reduce((s, r) => s + r.interest, 0);
    }

    // ✅ Save final calculation back to DB
    loan.outstandingAfterPrepayments = outstandingAfterPrepayments;
    loan.lastCalculatedAt = new Date();
    loan.simLog = simLog;
    loan.keepEMI = keepEMI;
    loan.reduceEMI = reduceEMI;
    await loan.save();

    // ✅ Send result
    res.json({
      status: "ok",
      simLog,
      outstandingAfterPrepayments,
      keepEMI,
      reduceEMI,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Health check
app.get("/healthz", (req, res) => res.status(200).send("OK"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Loan prepay server running on ${PORT}`));

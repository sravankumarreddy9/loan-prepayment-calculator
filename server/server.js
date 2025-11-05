// server.js (replace the existing /api/reschedule handler with the code below)

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

function round(x) { return Math.round(x); }

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
    out.push({ month, emi_paid: emiPaid, principal, interest, remaining: Math.max(balance,0) });
  }
  return out;
}

function computeEMI(balance, monthlyRate, months) {
  if (months <= 0) return 0;
  const factor = Math.pow(1 + monthlyRate, months);
  const emi = Math.round((balance * monthlyRate * factor) / (factor - 1));
  return emi;
}

// NEW: precise reschedule endpoint
app.post('/api/reschedule', (req, res) => {
  try {
    const {
      officialSchedule, // optional: array of {Instalment, Outstanding, Principal_component, Interest_component, EMI}
      principal,        // sanctioned principal (optional if officialSchedule given)
      annualRate = 8.35,
      emi,              // current EMI (required)
      totalTenure = 180,
      paidEmis = 0,     // EMIs already paid
      prepayments = [], // array [{month: <EMI number after which prepayment applied>, amount: <rupees>}]
      mode = 'reduce_tenure' // 'reduce_tenure' or 'reduce_emi'
    } = req.body;

    const monthlyRate = (Number(annualRate) / 100) / 12;

    // 1) Determine starting outstanding AFTER paidEmis
    let outstanding;
    if (officialSchedule && Array.isArray(officialSchedule) && officialSchedule.length >= Math.max(0, paidEmis)) {
      if (paidEmis === 0) {
        // outstanding is original sanctioned principal if provided, else schedule[0].Outstanding
        outstanding = principal ? Number(principal) : Number(officialSchedule[0].Outstanding);
      } else {
        // schedule stores Outstanding after each EMI. Use the official outstanding after paidEmis.
        outstanding = Number(officialSchedule[paidEmis - 1].Outstanding);
      }
    } else if (typeof principal !== 'undefined') {
      // If official schedule not provided but principal submitted, simulate EMIs to reach outstanding after paidEmis
      outstanding = Number(principal);
      for (let m = 1; m <= paidEmis; m++) {
        const interest = round(outstanding * monthlyRate);
        let principalPart = emi - interest;
        if (principalPart > outstanding) principalPart = outstanding;
        outstanding = round(outstanding - principalPart);
      }
    } else {
      return res.status(400).json({ error: "Provide either officialSchedule or principal + paidEmis to derive outstanding." });
    }

    // 2) Build prepay map (sum amounts if same month)
    const prepayMap = {};
    (prepayments || []).forEach(p => {
      const mm = Number(p.month);
      const aa = Number(p.amount);
      if (!mm || aa <= 0) return;
      prepayMap[mm] = (prepayMap[mm] || 0) + aa;
    });

    // 3) Simulate EMI application and apply prepayments (EMI debited first, then prepayment)
    const simLog = []; // record EMI and prepay events up to last prepay month
    let currentMonth = paidEmis;
    const lastPrepayMonth = Object.keys(prepayMap).length ? Math.max(...Object.keys(prepayMap).map(Number)) : paidEmis;

    // If lastPrepayMonth < paidEmis, we still want to show that prepay would be retroactive if applied - but typical use is >= paidEmis.
    const simulateTargetMonth = Math.max(lastPrepayMonth, paidEmis);

    // Simulate month-by-month from paidEmis+1 to simulateTargetMonth, applying EMI then prepay if present.
    while (currentMonth < simulateTargetMonth) {
      // advance one month: apply EMI for next month
      currentMonth += 1;
      const interest = round(outstanding * monthlyRate);
      let principalPart = emi - interest;
      if (principalPart > outstanding) principalPart = outstanding;
      const emiPaid = interest + principalPart;
      outstanding = round(outstanding - principalPart);

      simLog.push({
        month: currentMonth,
        action: 'EMI',
        emi_paid: emiPaid,
        interest,
        principal: principalPart,
        remaining_after_emi: outstanding
      });

      // apply prepayment AFTER EMI if scheduled in this month
      if (prepayMap[currentMonth]) {
        const before = outstanding;
        outstanding = Math.max(0, round(outstanding - prepayMap[currentMonth]));
        simLog.push({
          month: currentMonth,
          action: 'PREPAY',
          prepay_amount: prepayMap[currentMonth],
          before,
          remaining_after_prepay: outstanding
        });
      }
    }

    // Special case: if a prepayment is scheduled for the same month as paidEmis (i.e., prepay after the EMI you already paid),
    // then it should apply immediately to the outstanding we've taken from official schedule (which already reflects EMI of paidEmis).
    if (prepayMap[paidEmis]) {
      const before = outstanding;
      outstanding = Math.max(0, round(outstanding - prepayMap[paidEmis]));
      simLog.unshift({
        month: paidEmis,
        action: 'PREPAY_AFTER_ALREADY_PAID_EMI',
        prepay_amount: prepayMap[paidEmis],
        before,
        remaining_after_prepay: outstanding
      });
    }

    // 4) Outstanding after all prepayments applied (this is the balance to amortize)
    const outstandingAfterPrepayments = outstanding;

    // 5) Compute remaining months and interest for both scenarios

    // A) Keep EMI same -> compute months to finish using formula n = ln(EMI/(EMI - P*r)) / ln(1+r)
    let keepEMI = { monthsToFinish: 0, schedule: [], totalInterest: 0 };
    try {
      const denom = (emi - outstandingAfterPrepayments * monthlyRate);
      if (denom <= 0) {
        // EMI too small to amortize (edge case)
        keepEMI.monthsToFinish = Infinity;
        keepEMI.schedule = [];
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

    // B) Reduce EMI and keep remaining tenure same (remaining months = totalTenure - months already simulated)
    const monthsDone = simulateTargetMonth; // months already accounted for from loan start
    const remainingOfficial = totalTenure - monthsDone;
    let reduceEMI = { newEmi: 0, remainingSchedule: [], totalInterest: 0 };
    if (remainingOfficial > 0) {
      const newEmi = computeEMI(outstandingAfterPrepayments, monthlyRate, remainingOfficial);
      reduceEMI.newEmi = newEmi;
      reduceEMI.remainingSchedule = amortizeUntilPaid(outstandingAfterPrepayments, monthlyRate, newEmi, remainingOfficial + 5);
      // If amortizeUntilPaid returns more months than remainingOfficial because of rounding, trim to remainingOfficial
      if (reduceEMI.remainingSchedule.length > remainingOfficial) {
        reduceEMI.remainingSchedule = reduceEMI.remainingSchedule.slice(0, remainingOfficial);
      }
      reduceEMI.totalInterest = reduceEMI.remainingSchedule.reduce((s, r) => s + r.interest, 0);
    } else {
      reduceEMI.newEmi = 0;
      reduceEMI.remainingSchedule = [];
      reduceEMI.totalInterest = 0;
    }

    // 6) Compute original remaining interest for comparison (if officialSchedule provided)
    let originalRemainingInterest = 0;
    if (officialSchedule && officialSchedule.length > 0) {
      for (const row of officialSchedule) {
        if (row.Instalment > paidEmis) originalRemainingInterest += Number(row.Interest_component || row.Interest || 0);
      }
    } else {
      // fallback: estimate original remaining interest by amortizing outstanding at same EMI
      try {
        const origSched = amortizeUntilPaid(outstandingAfterPrepayments, monthlyRate, emi, totalTenure - paidEmis);
        originalRemainingInterest = origSched.reduce((s,r) => s + r.interest, 0);
      } catch (e) { originalRemainingInterest = 0; }
    }

    // interest saved values
    const interestSaved_keepEMI = Math.round(originalRemainingInterest - keepEMI.totalInterest);
    const interestSaved_reduceEMI = Math.round(originalRemainingInterest - reduceEMI.totalInterest);

    // Response
    res.json({
      status: 'ok',
      input: {
        usedOfficialSchedule: !!officialSchedule,
        principal,
        annualRate,
        emi,
        totalTenure,
        paidEmis,
        prepayments,
        mode
      },
      simLog,
      outstandingAfterPrepayments,
      monthsSimulatedUpTo: simulateTargetMonth,
      remainingOfficialMonthsBefore: totalTenure - paidEmis,
      keepEMI: {
        monthsToFinish: keepEMI.monthsToFinish,
        schedule: keepEMI.schedule,
        totalInterest: keepEMI.totalInterest,
        interestSavedVsOriginal: interestSaved_keepEMI
      },
      reduceEMI: {
        newEmi: reduceEMI.newEmi,
        remainingSchedule: reduceEMI.remainingSchedule,
        totalInterest: reduceEMI.totalInterest,
        interestSavedVsOriginal: interestSaved_reduceEMI
      },
      originalRemainingInterest
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Loan prepay server listening on ${PORT}`));

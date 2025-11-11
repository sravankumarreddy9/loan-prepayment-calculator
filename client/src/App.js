import React, { useState, useMemo, useEffect } from "react";
import LoanInsights from "./LoanInsights";
import axios from "axios";
import { Analytics } from "@vercel/analytics/react";
import {
  Container,
  Grid,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Divider,
  Box,
  Chip,
  Stack,
  Tabs,
  Tab,
  CircularProgress,
  Switch,
  FormControlLabel,
  CssBaseline,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import { Bar } from "react-chartjs-2";
import { Save, Calculate } from "@mui/icons-material";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { saveAs } from "file-saver";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// 🌐 Backend API base (change if needed)
const API_BASE =
  process.env.REACT_APP_API_URL ||
  "https://loan-prepayment-calculator.onrender.com";

function App() {
  const [principal, setPrincipal] = useState(3200000);
  const [emi, setEmi] = useState(31231);
  const [rate, setRate] = useState(8.35);
  const [tenure, setTenure] = useState(180);
  const [paidEmis, setPaidEmis] = useState(4);
  const [prepayments, setPrepayments] = useState([]);
  const [newPrepay, setNewPrepay] = useState({ month: "", amount: "" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  // 🆕 Updated Loan Scenario inputs
const [updatedPrincipal, setUpdatedPrincipal] = useState('');
const [updatedRate, setUpdatedRate] = useState('');
const [updatedEmi, setUpdatedEmi] = useState('');
const [updatedPrepayment, setUpdatedPrepayment] = useState('');
const [comparison, setComparison] = useState(null);


  // 🟢 Fetch latest saved loan from DB on app load
  useEffect(() => {
    axios
      .get(`${API_BASE}/api/loan`)
      .then((res) => {
        const loan = res.data;
        setPrincipal(loan.principal);
        setRate(loan.annualRate);
        setEmi(loan.emi);
        setTenure(loan.totalTenure);
        setPaidEmis(loan.paidEmis);
        setPrepayments(loan.prepayments || []);
        if (loan.keepEMI) {
          setResult({
            keepEMI: loan.keepEMI,
            reduceEMI: loan.reduceEMI,
            outstandingAfterPrepayments: loan.outstandingAfterPrepayments,
            lastCalculatedAt: loan.lastCalculatedAt,
          });
        }
      })
      .catch(() => {
        console.warn("⚠️ No saved loan found yet in DB");
      });
  }, []);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? "dark" : "light",
          primary: {
            main: darkMode ? "#90caf9" : "#1976d2",
          },
          background: {
            default: darkMode ? "#121212" : "#f9fafc",
            paper: darkMode ? "#1e1e1e" : "#fff",
          },
        },
        typography: {
          allVariants: {
            color: darkMode ? "#fff" : "#000",
          },
        },
      }),
    [darkMode]
  );

  // ➕ Add Prepayment
  const addPrepay = async () => {
    if (!newPrepay.month || !newPrepay.amount) return;
    const existing = prepayments.find(
      (p) => p.month === Number(newPrepay.month)
    );
    if (existing) {
      alert(`Prepayment already exists after EMI ${newPrepay.month}`);
      return;
    }

    const sorted = [
      ...prepayments,
      { month: Number(newPrepay.month), amount: Number(newPrepay.amount) },
    ].sort((a, b) => a.month - b.month);

    setPrepayments(sorted);
    setNewPrepay({ month: "", amount: "" });

    // Optional: Auto-recalculate after adding prepayment
    await calculate(sorted);
  };

  // 🗑 Remove Prepayment
  const removePrepay = (index) => {
    const updated = prepayments.filter((_, i) => i !== index);
    setPrepayments(updated);
  };

  // 💾 Save loan to DB
  const saveLoan = async (prepayList = prepayments) => {
    await axios.post(`${API_BASE}/api/loan`, {
      principal,
      annualRate: rate,
      emi,
      totalTenure: tenure,
      paidEmis,
      prepayments: prepayList,
    });
  };

  // 🧮 Calculate and refresh schedule
  const calculate = async (prepayList = prepayments) => {
    try {
      setLoading(true);
      await saveLoan(prepayList); // save before calculating

      const res = await axios.post(`${API_BASE}/api/reschedule`, {
        principal,
        annualRate: rate,
        emi,
        totalTenure: tenure,
        paidEmis,
        prepayments: prepayList,
      });
      setResult(res.data);
    } catch (error) {
      console.error(error);
      alert("Error calculating loan. Check connection.");
    } finally {
      setLoading(false);
    }
  };
  // 🆕 Calculate Updated Loan
const calculateUpdatedLoan = async () => {
  try {
    setLoading(true);

    const res = await axios.post("https://loan-prepayment-calculator.onrender.com/api/reschedule", {
      principal: updatedPrincipal || principal,
      annualRate: updatedRate || rate,
      emi: updatedEmi || emi,
      totalTenure: tenure,
      paidEmis,
      prepayments: [
        ...prepayments,
        ...(updatedPrepayment ? [{ month: paidEmis + 1, amount: updatedPrepayment }] : []),
      ],
    });

    const newResult = res.data;

    // Compare with current result if it exists
    if (result) {
      const interestSaved = result.keepEMI.totalInterest - newResult.keepEMI.totalInterest;
      const tenureReduced = result.keepEMI.monthsToFinish - newResult.keepEMI.monthsToFinish;
      setComparison({ interestSaved, tenureReduced });
    }

    setResult(newResult);
  } catch (error) {
    console.error(error);
    alert("Error calculating updated loan. Please check your inputs.");
  } finally {
    setLoading(false);
  }
};


  // 📊 Chart data
  const chartData = useMemo(() => {
    if (!result) return null;
    const schedule = result.keepEMI?.schedule || [];
    return {
      labels: schedule.map((r) => `M${r.month}`),
      datasets: [
        {
          label: "Principal Component",
          data: schedule.map((r) => r.principal),
          backgroundColor: "rgba(75, 192, 192, 0.7)",
        },
        {
          label: "Interest Component",
          data: schedule.map((r) => r.interest),
          backgroundColor: "rgba(255, 99, 132, 0.7)",
        },
      ],
    };
  }, [result]);

  // 📁 Export CSV
  const exportCSV = () => {
    if (!result?.keepEMI?.schedule) return;
    const rows = result.keepEMI.schedule.map(
      (r) =>
        `${r.month},${r.emi || emi},${r.principal},${r.interest},${r.remaining}`
    );
    const csv = ["Month,EMI,Principal,Interest,Remaining", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, "loan_schedule.csv");
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 4, transition: "all 0.3s ease" }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          mb={2}
        >
          <Typography
            variant="h4"
            fontWeight={600}
            sx={{
              background:
                "linear-gradient(90deg, #0052D4 0%, #4364F7 50%, #6FB1FC 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            🏦 Loan Prepayment — Bank-Matching Calculator
          </Typography>

          <Stack direction="row" alignItems="center" spacing={2}>
            <Button
              variant="outlined"
              color="info"
              onClick={() =>
                window.open(
                  "https://economictimes.indiatimes.com/industry/banking/rssfeeds/13358259.cms",
                  "_blank"
                )
              }
            >
              📊 Loan Insights
            </Button>
            <FormControlLabel
              control={
                <Switch
                  checked={darkMode}
                  onChange={() => setDarkMode(!darkMode)}
                />
              }
              label="Dark Mode"
            />
          </Stack>
        </Stack>

        <Grid container spacing={3}>
          {/* Loan Input Section */}
          <Grid item xs={12} md={4}>
            <Card sx={{ p: 2, boxShadow: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Loan Basics
                </Typography>

                <Stack spacing={2}>
                  <TextField
                    label="Principal (₹)"
                    value={principal}
                    onChange={(e) => setPrincipal(Number(e.target.value))}
                  />
                  <TextField
                    label="EMI (₹)"
                    value={emi}
                    onChange={(e) => setEmi(Number(e.target.value))}
                  />
                  <TextField
                    label="Rate p.a. (%)"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                  />
                  <TextField
                    label="Tenure (months)"
                    value={tenure}
                    onChange={(e) => setTenure(Number(e.target.value))}
                  />
                  <TextField
                    label="EMIs Paid"
                    value={paidEmis}
                    onChange={(e) => setPaidEmis(Number(e.target.value))}
                  />
                </Stack>

                <Divider sx={{ my: 2 }} />

                <Typography variant="h6">Prepayment Plan</Typography>
                <Stack spacing={2}>
                  <TextField
                    label="After which EMI number"
                    value={newPrepay.month}
                    onChange={(e) =>
                      setNewPrepay({ ...newPrepay, month: e.target.value })
                    }
                  />
                  <TextField
                    label="Amount (₹)"
                    value={newPrepay.amount}
                    onChange={(e) =>
                      setNewPrepay({ ...newPrepay, amount: e.target.value })
                    }
                  />
                  <Button variant="contained" onClick={addPrepay}>
                    Add Prepayment
                  </Button>
                </Stack>

                {prepayments.length > 0 && (
                  <Box mt={2}>
                    <Typography variant="subtitle1" gutterBottom>
                      Planned Prepayments:
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" spacing={1}>
                      {prepayments.map((p, i) => (
                        <Chip
                          key={i}
                          label={`After EMI ${p.month} → ₹${Number(
                            p.amount
                          ).toLocaleString("en-IN")}`}
                          onDelete={() => removePrepay(i)}
                          color="primary"
                          variant="outlined"
                          sx={{ m: 0.5 }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
                <Divider sx={{ my: 2 }} />

<Typography variant="h6">Updated Loan Scenario</Typography>
<Stack spacing={2}>
  <TextField
    label="Updated Principal (₹)"
    value={updatedPrincipal}
    onChange={(e) => setUpdatedPrincipal(Number(e.target.value))}
  />
  <TextField
    label="Updated Rate p.a. (%)"
    value={updatedRate}
    onChange={(e) => setUpdatedRate(Number(e.target.value))}
  />
  <TextField
    label="Updated EMI (₹)"
    value={updatedEmi}
    onChange={(e) => setUpdatedEmi(Number(e.target.value))}
  />
  <TextField
    label="Additional Prepayment (₹)"
    value={updatedPrepayment}
    onChange={(e) => setUpdatedPrepayment(Number(e.target.value))}
  />
  <Button
    variant="contained"
    color="secondary"
    onClick={calculateUpdatedLoan}
  >
    Calculate Updated Loan
  </Button>
</Stack>

                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={2} justifyContent="center">
                  <Button
                    variant="contained"
                    startIcon={<Calculate />}
                    onClick={() => calculate(prepayments)}
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={24} /> : "Calculate"}
                  </Button>
                  <Button
                    variant="outlined"
                    color="success"
                    startIcon={<Save />}
                    onClick={exportCSV}
                  >
                    Export CSV
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Results Section */}
          <Grid item xs={12} md={8}>
            {result && (
              <Card sx={{ p: 3, boxShadow: 4 }}>
                <Typography variant="h6" gutterBottom>
                  📈 Result Summary
                </Typography>

                <Typography>
                  <b>Outstanding:</b> ₹
                  {result.outstandingAfterPrepayments?.toLocaleString("en-IN")}
                </Typography>
                <Typography sx={{ color: "#1976d2", mt: 1 }}>
                  <b>Keep EMI (Reduce Tenure):</b>{" "}
                  {result.keepEMI.monthsToFinish} months | Interest: ₹
                  {result.keepEMI.totalInterest.toLocaleString("en-IN")}
                </Typography>
                <Typography sx={{ color: "#2e7d32", mt: 1 }}>
                  <b>Reduce EMI (Keep Tenure):</b> ₹
                  {result.reduceEMI.newEmi.toLocaleString("en-IN")} | Interest: ₹
                  {result.reduceEMI.totalInterest.toLocaleString("en-IN")}
                </Typography>
                {comparison && (
  <Box sx={{ mt: 2, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
    <Typography variant="subtitle1" fontWeight={600}>
      💡 Comparison Summary
    </Typography>
    <Typography sx={{ mt: 1 }}>
      <b>Interest Saved:</b> ₹{comparison.interestSaved.toLocaleString("en-IN")}
    </Typography>
    <Typography sx={{ mt: 1 }}>
      <b>Tenure Reduced:</b> {comparison.tenureReduced} months
    </Typography>
  </Box>
)}

                {result.lastCalculatedAt && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Last updated:{" "}
                    {new Date(result.lastCalculatedAt).toLocaleString("en-IN")}
                  </Typography>
                  
                )}

                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 3 }}>
                  <Tab label="Overview" />
                  <Tab label="Full Schedule" />
                </Tabs>

                {tab === 0 && chartData && (
                  <Box sx={{ mt: 2 }}>
                    <Bar
                      data={chartData}
                      options={{
                        plugins: {
                          legend: {
                            labels: { color: darkMode ? "#fff" : "#000" },
                          },
                          title: {
                            display: true,
                            text: "EMI Split (Principal vs Interest)",
                            color: darkMode ? "#fff" : "#000",
                          },
                        },
                        scales: {
                          x: { ticks: { color: darkMode ? "#fff" : "#000" } },
                          y: { ticks: { color: darkMode ? "#fff" : "#000" } },
                        },
                        responsive: true,
                        animation: { duration: 800, easing: "easeOutBounce" },
                      }}
                    />
                  </Box>
                )}

                {tab === 1 && (
                  <Box sx={{ mt: 2, maxHeight: 400, overflow: "auto", fontSize: 14 }}>
                    <table
                      width="100%"
                      border="1"
                      style={{
                        borderCollapse: "collapse",
                        width: "100%",
                        backgroundColor: darkMode ? "#1e1e1e" : "#fff",
                        color: darkMode ? "#f5f5f5" : "#000000",
                      }}
                    >
                      <thead
                        style={{
                          backgroundColor: darkMode ? "#2a2a2a" : "#e0e0e0",
                          color: darkMode ? "#ffffff" : "#000000",
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                        }}
                      >
                        <tr>
                          <th>Month</th>
                          <th>EMI</th>
                          <th>Principal</th>
                          <th>Interest</th>
                          <th>Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.keepEMI.schedule.slice(0, 50).map((r, i) => (
                          <tr
                            key={i}
                            style={{
                              backgroundColor: darkMode
                                ? i % 2 === 0
                                  ? "#2a2a2a"
                                  : "#1a1a1a"
                                : i % 2 === 0
                                ? "#f9f9f9"
                                : "#ffffff",
                              color: darkMode ? "#f1f1f1" : "#000000",
                            }}
                          >
                            <td>{r.month}</td>
                            <td>{r.emi}</td>
                            <td>{r.principal}</td>
                            <td>{r.interest}</td>
                            <td>{r.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                )}
              </Card>
            )}
            <LoanInsights darkMode={darkMode} />
          </Grid>
        </Grid>
        <Analytics />
      </Container>
    </ThemeProvider>
  );
}

export default App;

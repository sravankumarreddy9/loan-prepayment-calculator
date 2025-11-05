import React, { useState, useMemo } from "react";
import axios from "axios";
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
} from "@mui/material";
import { Bar } from "react-chartjs-2";
import { Save, Calculate } from "@mui/icons-material";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";
import { saveAs } from "file-saver";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

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
  const [mode, setMode] = useState("tenure");

  const addPrepay = () => {
    if (!newPrepay.month || !newPrepay.amount) return;
    const sorted = [...prepayments, newPrepay].sort((a, b) => a.month - b.month);
    setPrepayments(sorted);
    setNewPrepay({ month: "", amount: "" });
  };

  const removePrepay = (index) => {
    const updated = prepayments.filter((_, i) => i !== index);
    setPrepayments(updated);
  };

  const calculate = async () => {
    try {
      setLoading(true);
      const res = await axios.post("https://loan-prepayment-calculator.onrender.com/api/reschedule", {
        principal,
        annualRate: rate,
        emi,
        totalTenure: tenure,
        paidEmis,
        prepayments,
      });
      setResult(res.data);
    } catch (err) {
      console.error("❌ API Error:", err);
      alert("Something went wrong. Please check your internet or backend.");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return null;
    const schedule = result.keepEMI?.schedule || [];
    return {
      labels: schedule.map((r) => `M${r.month}`),
      datasets: [
        {
          label: "Principal Component",
          data: schedule.map((r) => r.principal),
          backgroundColor: "rgba(75, 192, 192, 0.6)",
        },
        {
          label: "Interest Component",
          data: schedule.map((r) => r.interest),
          backgroundColor: "rgba(255, 99, 132, 0.6)",
        },
      ],
    };
  }, [result]);

  const exportCSV = () => {
    if (!result?.keepEMI?.schedule) return;
    const rows = result.keepEMI.schedule.map((r) => `${r.month},${r.emi},${r.principal},${r.interest},${r.remaining}`);
    const csv = ["Month,EMI,Principal,Interest,Remaining", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, "loan_schedule.csv");
  };

  const interestSaved = useMemo(() => {
    if (!result) return 0;
    const originalInterest = result.originalInterest || 0;
    const newInterest = result.keepEMI?.totalInterest || 0;
    return Math.max(0, originalInterest - newInterest);
  }, [result]);

  return (
    <Container maxWidth="lg" sx={{ py: 4, bgcolor: darkMode ? "#121212" : "#f9fafc", color: darkMode ? "#fff" : "#000" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography
          variant="h4"
          fontWeight={600}
          textAlign="center"
          gutterBottom
          sx={{
            background: "linear-gradient(90deg, #0052D4 0%, #4364F7 50%, #6FB1FC 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          🏦 Loan Prepayment — Bank-Matching Calculator
        </Typography>
        <FormControlLabel
          control={<Switch checked={darkMode} onChange={() => setDarkMode(!darkMode)} />}
          label="Dark Mode"
        />
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Card sx={{ p: 2, boxShadow: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Loan Basics</Typography>
              <Stack spacing={2}>
                <TextField label="Principal (₹)" value={principal} onChange={(e) => setPrincipal(Number(e.target.value))} />
                <TextField label="EMI (₹)" value={emi} onChange={(e) => setEmi(Number(e.target.value))} />
                <TextField label="Rate p.a. (%)" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
                <TextField label="Tenure (months)" value={tenure} onChange={(e) => setTenure(Number(e.target.value))} />
                <TextField label="EMIs Paid" value={paidEmis} onChange={(e) => setPaidEmis(Number(e.target.value))} />
              </Stack>

              <Divider sx={{ my: 2 }} />

              <Typography variant="h6">Prepayment Plan</Typography>
              <Stack spacing={2}>
                <TextField label="After which EMI number" value={newPrepay.month} onChange={(e) => setNewPrepay({ ...newPrepay, month: e.target.value })} />
                <TextField label="Amount (₹)" value={newPrepay.amount} onChange={(e) => setNewPrepay({ ...newPrepay, amount: e.target.value })} />
                <Button variant="contained" onClick={addPrepay}>Add Prepayment</Button>
              </Stack>

              {prepayments.length > 0 && (
                <Box mt={2}>
                  <Typography variant="subtitle1" gutterBottom>Planned Prepayments:</Typography>
                  <Stack direction="row" flexWrap="wrap" spacing={1}>
                    {prepayments.map((p, i) => (
                      <Chip
                        key={i}
                        label={`After EMI ${p.month} → ₹${Number(p.amount).toLocaleString("en-IN")}`}
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
              <Stack direction="row" spacing={2} justifyContent="center">
                <Button
                  variant="contained"
                  startIcon={<Calculate />}
                  onClick={calculate}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} /> : "Calculate"}
                </Button>
                <Button variant="outlined" color="success" startIcon={<Save />} onClick={exportCSV}>
                  Export CSV
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          {result && (
            <Card sx={{ p: 3, boxShadow: 4 }}>
              <Typography variant="h6" gutterBottom>📈 Result Summary</Typography>
              <Typography><b>Outstanding:</b> ₹{result.outstandingAfterPrepayments.toLocaleString("en-IN")}</Typography>
              <Typography sx={{ color: "#1976d2", mt: 1 }}>
                <b>Keep EMI (Reduce Tenure):</b> {result.keepEMI.monthsToFinish} months | Interest: ₹{result.keepEMI.totalInterest.toLocaleString("en-IN")}
              </Typography>
              <Typography sx={{ color: "#2e7d32", mt: 1 }}>
                <b>Reduce EMI (Keep Tenure):</b> ₹{result.reduceEMI.newEmi.toLocaleString("en-IN")} | Interest: ₹{result.reduceEMI.totalInterest.toLocaleString("en-IN")}
              </Typography>
              {interestSaved > 0 && (
                <Typography sx={{ color: "#43a047", mt: 2 }}>
                  💰 You save ₹{interestSaved.toLocaleString("en-IN")} in interest!
                </Typography>
              )}

              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 3 }}>
                <Tab label="Overview" />
                <Tab label="Full Schedule" />
              </Tabs>

              {tab === 0 && chartData && (
                <Bar
                  data={chartData}
                  options={{
                    plugins: { legend: { position: "bottom" }, title: { display: true, text: "EMI Split" } },
                    responsive: true,
                    animation: { duration: 800, easing: "easeOutBounce" },
                  }}
                />
              )}

              {tab === 1 && (
                <Box sx={{ mt: 2, maxHeight: 400, overflow: "auto", fontSize: 14 }}>
                  <table width="100%" border="1" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#1976d2", color: "#fff" }}>
                        <th>Month</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.keepEMI.schedule.slice(0, 50).map((r, i) => (
                        <tr key={i}>
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
        </Grid>
      </Grid>
    </Container>
  );
}

export default App;

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Box,
  Grid,
  Button,
} from "@mui/material";

const feeds = [
  {
    name: "Economic Times - Banking & Finance",
    url: "https://economictimes.indiatimes.com/rssfeeds/13358259.cms",
  },
  {
    name: "MoneyControl - Personal Finance",
    url: "https://www.moneycontrol.com/rss/personalfinance.xml",
  },
  {
    name: "RBI - Press Releases",
    url: "https://rbi.org.in/rss/PressReleases.xml",
  },
];

export default function LoanInsights({ darkMode }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState(feeds[0]);

  const fetchNews = async (feedUrl) => {
    try {
      setLoading(true);
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (data && data.items) {
        setNews(data.items.slice(0, 8)); // show top 8 stories
      }
    } catch (err) {
      console.error("❌ Error fetching RSS feed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews(source.url);
  }, [source]);

  return (
    <Card
      sx={{
        mt: 3,
        p: 2,
        boxShadow: 3,
        backgroundColor: darkMode ? "#1e1e1e" : "#ffffff",
        transition: "all 0.3s ease",
      }}
    >
      <Typography variant="h6" gutterBottom>
        📰 Live Loan & Finance News (India)
      </Typography>

      {/* Source Buttons */}
      <Box sx={{ mb: 2 }}>
        {feeds.map((feed) => (
          <Button
            key={feed.name}
            onClick={() => setSource(feed)}
            size="small"
            variant={source.name === feed.name ? "contained" : "outlined"}
            sx={{ mr: 1, mb: 1 }}
          >
            {feed.name.split(" - ")[0]}
          </Button>
        ))}
      </Box>

      {/* Loader */}
      {loading ? (
        <Box sx={{ textAlign: "center", py: 3 }}>
          <CircularProgress />
          <Typography variant="body2" sx={{ mt: 1 }}>
            Fetching latest {source.name} updates...
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {news.map((item, i) => (
            <Grid item xs={12} sm={6} md={4} key={i}>
              <Card
                sx={{
                  backgroundColor: darkMode ? "#2a2a2a" : "#f9f9f9",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {item.enclosure?.link && (
                  <img
                    src={item.enclosure.link}
                    alt="thumbnail"
                    style={{
                      width: "100%",
                      height: 120,
                      objectFit: "cover",
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                    }}
                  />
                )}
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      color: darkMode ? "#90caf9" : "#1976d2",
                      fontWeight: 600,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    {new Date(item.pubDate).toLocaleString("en-IN")}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {item.description
                      ?.replace(/<[^>]*>?/gm, "")
                      .slice(0, 120)}
                    ...
                  </Typography>
                  <Button
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    size="small"
                  >
                    Read more →
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Card>
  );
}

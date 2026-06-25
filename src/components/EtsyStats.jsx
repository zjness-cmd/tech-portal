import React, { useState, useEffect } from "react";

function formatCurrency(cents) {
  if (!cents && cents !== 0) return "—";
  return "$" + (cents / 100).toFixed(2);
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export default function EtsyStats({ onClose }) {
  const [shop, setShop] = useState(null);
  const [listings, setListings] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [shopRes, listingsRes, receiptsRes] = await Promise.all([
        fetch("/api/etsy?endpoint=shop"),
        fetch("/api/etsy?endpoint=listings"),
        fetch("/api/etsy?endpoint=receipts"),
      ]);
      const [shopData, listingsData, receiptsData] = await Promise.all([
        shopRes.json(), listingsRes.json(), receiptsRes.json()
      ]);
      if (shopData.error) throw new Error(shopData.error + (shopData.details ? ": " + JSON.stringify(shopData.details) : ""));
      setShop(shopData);
      setListings(listingsData.results || []);
      setReceipts(receiptsData.results || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  // Revenue calcs
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthReceipts = receipts.filter(r => new Date(r.create_timestamp * 1000) >= startOfMonth);
  const lastMonthReceipts = receipts.filter(r => {
    const d = new Date(r.create_timestamp * 1000);
    return d >= startOfLastMonth && d < startOfMonth;
  });
  const thisMonthRevenue = thisMonthReceipts.reduce((sum, r) => sum + (r.grandtotal?.amount || 0), 0);
  const lastMonthRevenue = lastMonthReceipts.reduce((sum, r) => sum + (r.grandtotal?.amount || 0), 0);
  const totalRevenue = receipts.reduce((sum, r) => sum + (r.grandtotal?.amount || 0), 0);

  return React.createElement("div", { style: styles.overlay, onClick: onClose },
    React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },

      // Header
      React.createElement("div", { style: styles.header },
        React.createElement("div", null,
          React.createElement("div", { style: styles.headerTitle }, "🛍️ Etsy Shop"),
          shop && React.createElement("div", { style: styles.headerSub }, shop.shop_name),
        ),
        React.createElement("button", { onClick: onClose, style: styles.closeBtn }, "×")
      ),

      loading ? React.createElement("div", { style: styles.loading }, "Loading shop data...") :
      error ? React.createElement("div", { style: styles.errorBox },
        React.createElement("div", { style: { fontWeight: 600, marginBottom: 4 } }, "❌ Could not load Etsy data"),
        React.createElement("div", { style: { fontSize: 12 } }, error),
        React.createElement("button", { onClick: loadAll, style: styles.retryBtn }, "Retry")
      ) :

      React.createElement(React.Fragment, null,

        // Tabs
        React.createElement("div", { style: styles.tabs },
          ["overview", "orders", "listings"].map(t =>
            React.createElement("button", {
              key: t,
              style: { ...styles.tab, ...(tab === t ? styles.tabActive : {}) },
              onClick: () => setTab(t),
            }, t === "overview" ? "📊 Overview" : t === "orders" ? "📦 Orders" : "🏷️ Listings")
          )
        ),

        // Tab content
        React.createElement("div", { style: styles.body },

          // ── Overview ──────────────────────────────────────────────────
          tab === "overview" && React.createElement("div", null,
            // Revenue cards
            React.createElement("div", { style: styles.cardGrid },
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "This Month"),
                React.createElement("div", { style: styles.statVal }, formatCurrency(thisMonthRevenue)),
                React.createElement("div", { style: styles.statSub }, thisMonthReceipts.length + " orders"),
              ),
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "Last Month"),
                React.createElement("div", { style: styles.statVal }, formatCurrency(lastMonthRevenue)),
                React.createElement("div", { style: styles.statSub }, lastMonthReceipts.length + " orders"),
              ),
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "Active Listings"),
                React.createElement("div", { style: styles.statVal }, shop?.listing_active_count || listings.length),
                React.createElement("div", { style: styles.statSub }, "in your shop"),
              ),
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "Total Sales"),
                React.createElement("div", { style: styles.statVal }, shop?.transaction_sold_count || "—"),
                React.createElement("div", { style: styles.statSub }, "all time"),
              ),
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "Shop Reviews"),
                React.createElement("div", { style: styles.statVal }, shop?.review_count || "—"),
                React.createElement("div", { style: styles.statSub }, shop?.review_average ? "⭐ " + Number(shop.review_average).toFixed(1) : ""),
              ),
              React.createElement("div", { style: styles.statCard },
                React.createElement("div", { style: styles.statLabel }, "Favorites"),
                React.createElement("div", { style: styles.statVal }, shop?.num_favorers || "—"),
                React.createElement("div", { style: styles.statSub }, "shop favorites"),
              ),
            ),

            // Recent orders preview
            receipts.length > 0 && React.createElement("div", { style: { marginTop: 16 } },
              React.createElement("div", { style: styles.sectionLabel }, "Recent Orders"),
              receipts.slice(0, 3).map(r => React.createElement("div", { key: r.receipt_id, style: styles.orderRow },
                React.createElement("div", { style: { flex: 1 } },
                  React.createElement("div", { style: styles.orderName }, r.name || "Customer"),
                  React.createElement("div", { style: styles.orderSub }, timeAgo((r.create_timestamp || 0) * 1000) + " · " + (r.transactions?.length || 1) + " item" + ((r.transactions?.length || 1) !== 1 ? "s" : "")),
                ),
                React.createElement("div", { style: styles.orderAmount }, formatCurrency(r.grandtotal?.amount))
              ))
            )
          ),

          // ── Orders ────────────────────────────────────────────────────
          tab === "orders" && React.createElement("div", null,
            receipts.length === 0
              ? React.createElement("div", { style: styles.empty }, "No recent orders found.")
              : receipts.map(r => React.createElement("div", { key: r.receipt_id, style: styles.orderCard },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
                    React.createElement("div", null,
                      React.createElement("div", { style: styles.orderName }, r.name || "Customer"),
                      React.createElement("div", { style: styles.orderSub }, new Date((r.create_timestamp || 0) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })),
                    ),
                    React.createElement("div", { style: { textAlign: "right" } },
                      React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#27500A" } }, formatCurrency(r.grandtotal?.amount)),
                      React.createElement("div", { style: { fontSize: 11, color: r.is_shipped ? "#27500A" : "#856404", marginTop: 2 } }, r.is_shipped ? "✅ Shipped" : "⏳ Processing"),
                    )
                  ),
                  r.transactions?.map((t, i) => React.createElement("div", { key: i, style: styles.transactionRow },
                    React.createElement("div", { style: { fontSize: 13, color: "#444" } }, "• " + t.title),
                    React.createElement("div", { style: { fontSize: 13, color: "#888" } }, "x" + t.quantity + " · " + formatCurrency(t.price?.amount * t.quantity))
                  ))
                ))
          ),

          // ── Listings ──────────────────────────────────────────────────
          tab === "listings" && React.createElement("div", null,
            listings.length === 0
              ? React.createElement("div", { style: styles.empty }, "No active listings found.")
              : listings.map(l => React.createElement("div", { key: l.listing_id, style: styles.listingCard },
                  React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } },
                    // Thumbnail
                    l.MainImage?.url_75x75 && React.createElement("img", {
                      src: l.MainImage.url_75x75,
                      alt: l.title,
                      style: { width: 60, height: 60, borderRadius: 8, objectFit: "cover", flexShrink: 0 }
                    }),
                    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                      React.createElement("div", { style: styles.listingTitle }, l.title),
                      React.createElement("div", { style: { display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" } },
                        React.createElement("span", { style: styles.listingBadge }, "💰 " + formatCurrency(l.price?.amount * 100 / (l.price?.divisor || 100))),
                        React.createElement("span", { style: styles.listingBadge }, "👁️ " + (l.views || 0) + " views"),
                        React.createElement("span", { style: styles.listingBadge }, "❤️ " + (l.num_favorers || 0)),
                        l.quantity !== undefined && React.createElement("span", { style: { ...styles.listingBadge, color: l.quantity < 3 ? "#856404" : "#27500A" } }, "📦 " + l.quantity + " left"),
                      ),
                      React.createElement("a", {
                        href: l.url, target: "_blank", rel: "noreferrer",
                        style: { fontSize: 11, color: "#185FA5", marginTop: 4, display: "inline-block" }
                      }, "View on Etsy →")
                    )
                  )
                ))
          )
        )
      )
    )
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0", background: "#F97316", color: "#fff" },
  headerTitle: { fontSize: 17, fontWeight: 700 },
  headerSub: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  closeBtn: { fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#fff", lineHeight: 1 },
  loading: { padding: "3rem", textAlign: "center", color: "#888", fontSize: 14 },
  errorBox: { margin: "1rem", padding: "1rem", background: "#fef0f0", borderRadius: 10, color: "#c0392b", fontSize: 13 },
  retryBtn: { marginTop: 10, padding: "6px 16px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 },
  tabs: { display: "flex", borderBottom: "0.5px solid #e0e0e0", background: "#f9f9f9" },
  tab: { flex: 1, padding: "10px 4px", fontSize: 12, fontWeight: 500, background: "none", border: "none", cursor: "pointer", color: "#888", borderBottom: "2px solid transparent" },
  tabActive: { color: "#F97316", borderBottom: "2px solid #F97316", background: "#fff" },
  body: { overflowY: "auto", flex: 1, padding: "1rem" },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
  statCard: { background: "#f9f9f9", borderRadius: 10, padding: "0.75rem 1rem", border: "0.5px solid #e0e0e0" },
  statLabel: { fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 },
  statVal: { fontSize: 22, fontWeight: 700, color: "#1a1a1a" },
  statSub: { fontSize: 11, color: "#888", marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 },
  orderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "0.5px solid #f0f0f0" },
  orderCard: { background: "#f9f9f9", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 8, border: "0.5px solid #e0e0e0" },
  orderName: { fontSize: 14, fontWeight: 600, color: "#1a1a1a" },
  orderSub: { fontSize: 12, color: "#888", marginTop: 2 },
  orderAmount: { fontSize: 15, fontWeight: 700, color: "#27500A" },
  transactionRow: { display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "0.5px solid #e0e0e0" },
  listingCard: { background: "#f9f9f9", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 8, border: "0.5px solid #e0e0e0" },
  listingTitle: { fontSize: 13, fontWeight: 600, color: "#1a1a1a", lineHeight: 1.3 },
  listingBadge: { fontSize: 11, color: "#666", background: "#fff", padding: "2px 8px", borderRadius: 10, border: "0.5px solid #e0e0e0" },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};

// Customer order tracking — see t.html. Plain script, no dependencies.
(function () {
  "use strict";

  var TOKEN_RE = /^[A-Za-z0-9]{22}$/;
  var STEPS = [
    { key: "confirmed", label: "Order confirmed" },
    { key: "out", label: "Out for delivery" },
    { key: "delivered", label: "Delivered" },
  ];
  var STATUS = {
    confirmed: { label: "Confirmed", color: "var(--accent)" },
    out: { label: "Out for delivery", color: "var(--warning)" },
    delivered: { label: "Delivered", color: "var(--success)" },
    cancelled: { label: "Cancelled", color: "var(--danger)" },
  };

  function $(id) {
    return document.getElementById(id);
  }
  function show(id) {
    ["loading", "missing", "offline", "order"].forEach(function (x) {
      $(x).hidden = x !== id;
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = String(text);
    return e;
  }
  function str(v, max) {
    return typeof v === "string" ? v.slice(0, max || 120) : "";
  }
  function when(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "";
    try {
      return new Date(ms).toLocaleString("en-GB", {
        timeZone: "Asia/Colombo",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "";
    }
  }

  function render(o) {
    var status = STATUS[o.status] ? o.status : "confirmed";
    document.title = str(o.order, 12) + " · Order tracking";
    $("shop").textContent = str(o.shop, 40);
    $("no").textContent = str(o.order, 12);
    $("day").textContent = status === "cancelled" ? "Cancelled" : "Delivery on " + str(o.deliveryLabel, 20);
    $("badge").textContent = STATUS[status].label;
    document.documentElement.style.setProperty("--s", STATUS[status].color);

    var steps = $("steps");
    steps.textContent = "";
    var at = o.statusAt && typeof o.statusAt === "object" ? o.statusAt : {};
    var reached = status === "cancelled" ? 0 : STEPS.findIndex(function (s) { return s.key === status; });
    STEPS.forEach(function (s, i) {
      if (status === "cancelled" && i > 0) return;
      var li = el("li", i < reached || (i === reached && status === "delivered") ? "done" : i === reached ? "now" : "");
      var body = el("div");
      body.appendChild(el("div", "t", s.label));
      var w = when(at[s.key]);
      if (w) body.appendChild(el("div", "w", w));
      li.appendChild(body);
      steps.appendChild(li);
    });
    if (status === "cancelled") {
      var li = el("li", "now");
      var body = el("div");
      body.appendChild(el("div", "t", "Cancelled"));
      var w = when(at.cancelled);
      if (w) body.appendChild(el("div", "w", w));
      li.appendChild(body);
      steps.appendChild(li);
    }

    var items = $("items");
    items.textContent = "";
    (Array.isArray(o.lines) ? o.lines : []).slice(0, 50).forEach(function (l) {
      var li = el("li");
      li.appendChild(el("span", "", str(l && l.name, 80)));
      li.appendChild(el("span", "q", str(l && l.qty, 24)));
      items.appendChild(li);
    });
    $("weighed").hidden = status !== "confirmed";

    var contact = $("contact");
    contact.textContent = "";
    contact.appendChild(el("span", "note", "Questions? Call us:"));
    var numbers = str(o.contact, 80).match(/0\d{2}\s?\d{3}\s?\d{4}/g) || [];
    numbers.slice(0, 3).forEach(function (n) {
      var a = el("a", "", n);
      a.href = "tel:" + n.replace(/\s/g, "");
      contact.appendChild(a);
    });
    show("order");
  }

  var k = "";
  try {
    k = new URLSearchParams(window.location.search).get("k") || "";
  } catch {
    k = "";
  }
  if (!TOKEN_RE.test(k)) {
    show("missing");
    return;
  }

  fetch("/api/track?k=" + encodeURIComponent(k), { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
    .then(function (r) {
      if (r.status === 404) {
        show("missing");
        return null;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (o) {
      if (o) render(o);
    })
    .catch(function () {
      show("offline");
    });
})();

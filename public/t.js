// Customer order tracking — see t.html. Plain script, no dependencies.
(function () {
  "use strict";

  var TOKEN_RE = /^[A-Za-z0-9]{22}$/;
  var STEPS = [
    { key: "confirmed", label: "Order confirmed", hint: "We have your order." },
    { key: "out", label: "Out for delivery", hint: "Weighed, billed and on the way." },
    { key: "delivered", label: "Delivered", hint: "Thank you for ordering with us." },
  ];
  var STATUS = {
    confirmed: { label: "Confirmed", color: "var(--accent)" },
    out: { label: "Out for delivery", color: "var(--warning)" },
    delivered: { label: "Delivered", color: "var(--success)" },
    cancelled: { label: "Cancelled", color: "var(--danger)" },
  };
  var SVG = "http://www.w3.org/2000/svg";

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
  /** A small stroked icon from fixed path data (never from the server). */
  function icon(paths, size) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("width", size || 16);
    s.setAttribute("height", size || 16);
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "3");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }
  var TICK = ["M20 6 9 17l-5-5"];
  var CROSS = ["M18 6 6 18", "m6 6 12 12"];
  var PHONE = ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"];

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

  function step(state, label, at, hint, glyph) {
    var li = el("li", state);
    var dot = el("span", "dot");
    if (glyph) dot.appendChild(icon(glyph, 14));
    li.appendChild(dot);
    var body = el("div");
    body.appendChild(el("div", "t", label));
    var w = when(at);
    if (w) body.appendChild(el("div", "w", w));
    else if (hint && state !== "todo") body.appendChild(el("div", "w", hint));
    li.appendChild(body);
    return li;
  }

  function render(o, k) {
    var status = STATUS[o.status] ? o.status : "confirmed";
    var label = str(o.order, 12);
    document.title = label + " · Order tracking · VSP FARM";
    if (str(o.shop, 40)) $("shop").textContent = str(o.shop, 40);
    $("no").textContent = label;
    $("badge").textContent = STATUS[status].label;
    $("dayLabel").textContent = status === "delivered" ? "Delivery day" : status === "cancelled" ? "Was due" : "Delivery";
    $("day").textContent = str(o.deliveryLabel, 20) || "—";
    document.documentElement.style.setProperty("--s", STATUS[status].color);

    // Progress
    var steps = $("steps");
    steps.textContent = "";
    var at = o.statusAt && typeof o.statusAt === "object" ? o.statusAt : {};
    if (status === "cancelled") {
      steps.appendChild(step("done", STEPS[0].label, at.confirmed, "", TICK));
      steps.appendChild(step("now", "Cancelled", at.cancelled, "Call us if this is a mistake.", CROSS));
    } else {
      var reached = STEPS.findIndex(function (s) { return s.key === status; });
      STEPS.forEach(function (s, i) {
        var done = i < reached || (i === reached && status === "delivered");
        var state = done ? "done" : i === reached ? "now" : "todo";
        steps.appendChild(step(state, s.label, at[s.key], s.hint, done ? TICK : null));
      });
    }

    // Items
    var items = $("items");
    items.textContent = "";
    var lines = (Array.isArray(o.lines) ? o.lines : []).slice(0, 50);
    lines.forEach(function (l) {
      var li = el("li");
      li.appendChild(el("span", "n", str(l && l.name, 80)));
      li.appendChild(el("span", "q", str(l && l.qty, 24)));
      items.appendChild(li);
    });
    $("count").textContent = lines.length + (lines.length === 1 ? " product" : " products");
    $("weighed").hidden = status !== "confirmed";

    // Bill
    var hasBill = o.hasBill === true && (status === "out" || status === "delivered");
    $("billCard").hidden = !hasBill;
    if (hasBill) {
      var link = $("billLink");
      link.href = "/api/track?k=" + encodeURIComponent(k) + "&bill=pdf";
      link.setAttribute("download", "VSP_Bill_" + label.replace(/[^A-Za-z0-9-]/g, "") + ".pdf");
      $("billSub").textContent = "Bill " + label + " · PDF copy for your records.";
    }

    // Contact
    var contact = $("contact");
    contact.textContent = "";
    var numbers = str(o.contact, 80).match(/0\d{2}\s?\d{3}\s?\d{4}/g) || [];
    numbers.slice(0, 3).forEach(function (n) {
      var a = el("a", "call");
      a.href = "tel:" + n.replace(/\s/g, "");
      var ic = el("span", "ic");
      ic.appendChild(icon(PHONE, 16));
      a.appendChild(ic);
      a.appendChild(el("span", "", n));
      a.appendChild(el("small", "", "Call"));
      contact.appendChild(a);
    });
    if (numbers.length === 0) contact.appendChild(el("p", "note", "Please call the shop."));
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
      if (o) render(o, k);
    })
    .catch(function () {
      show("offline");
    });
})();

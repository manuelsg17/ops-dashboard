// charts.js — Toda la lógica de ApexCharts

// ── TOOLTIP FLOTANTE ──────────────────────────────────────────────────────────
// El listener de mousemove se agrega solo cuando el tooltip está visible y se
// remueve al ocultarlo, evitando disparos en cada pixel cuando no hay tooltip.
function _onTipMouseMove(e) {
  const ft = document.getElementById("floatTip");
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX + 16, y = e.clientY - 16;
  if (x + 260 > vw) x = e.clientX - 265;
  if (y + ft.offsetHeight > vh) y = vh - ft.offsetHeight - 10;
  ft.style.left = x + "px";
  ft.style.top  = y + "px";
}

function attachTooltipEvents() { /* listener se registra en showFloatTip/hideFloatTip */ }

function showFloatTip(date, rows) {
  const ft = document.getElementById("floatTip");
  document.getElementById("ftDate").textContent = date;
  const container = document.getElementById("ftRows");
  container.innerHTML = rows.length
    ? rows.map(r =>
        `<div class="ft-r">
           <span class="ft-dot" style="background:${r.color}"></span>
           <span class="ft-n">${r.name}</span>
           <span class="ft-v">${fmt(r.val)}</span>
         </div>`).join("")
    : `<div style="font-size:.75rem;color:#aaa">Sin datos</div>`;
  if (ft.style.display !== "block") {
    document.addEventListener("mousemove", _onTipMouseMove);
  }
  ft.style.display = "block";
}

function hideFloatTip() {
  document.getElementById("floatTip").style.display = "none";
  document.removeEventListener("mousemove", _onTipMouseMove);
}

// ── MULTI-LINE CHART (one series per partner) ─────────────────────────────────
function buildMultiLine(elId, dates, partners, byDate, metric, fallbackColor) {
  const colors  = partners.map(p => STATE.partnerColors[p] || fallbackColor);
  const series  = partners.map(p => ({
    name: p,
    data: dates.map(d => {
      const dp = byDate[d]?.[p];
      if (!dp) return 0;
      if (metric === "nr") return dp.newPartner + dp.newService + dp.reactivated;
      if (metric === "sh") return dp.supplyHours;
      return dp.activeDrivers;
    })
  }));
  buildLineChart(elId, dates, series, colors);
}

// ── SINGLE-LINE CHART (one series for a city aggregate) ──────────────────────
function buildSingleLine(elId, dates, cityByDate, metric, color, label) {
  const data = dates.map(d => {
    const r = cityByDate[d];
    return r ? r[metric] : 0;
  });
  buildLineChart(elId, dates, [{ name: label, data }], [color]);
}

// ── BASE LINE CHART ───────────────────────────────────────────────────────────
function buildLineChart(elId, dates, series, colors) {
  const opts = {
    series,
    chart: {
      type:       "line",
      height:     200,
      toolbar:    { show: false },
      zoom:       { enabled: false },
      fontFamily: "inherit",
      animations: { enabled: true, speed: 300 },
      events: {
        mouseLeave: () => hideFloatTip()
      }
    },
    stroke:  { curve: "smooth", width: 2 },
    colors,
    xaxis: {
      categories: dates.map(d2s),
      labels:     { style: { fontSize: "10px" }, rotate: -30 },
      axisBorder: { show: false },
      axisTicks:  { show: false }
    },
    yaxis: {
      labels: {
        formatter: v => fmt(v),
        style:     { fontSize: "10px" }
      }
    },
    legend: {
      show:         series.length <= 8,
      position:     "bottom",
      fontSize:     "10px",
      itemMargin:   { horizontal: 4, vertical: 2 }
    },
    grid:    { borderColor: "#f0f0f0", strokeDashArray: 4 },
    markers: { size: 3, strokeWidth: 0, hover: { size: 5 } },
    tooltip: {
      custom({ series: s, dataPointIndex: di, w }) {
        const date = w.globals.labels[di];
        const rows = series
          .map((sr, i) => ({ name: sr.name, val: s[i][di] || 0, color: colors[i] }))
          .filter(r => r.val > 0)
          .sort((a, b) => b.val - a.val);
        showFloatTip(date, rows);
        return "<div style='display:none'></div>";
      }
    }
  };

  const prev = STATE.charts[elId];
  if (prev) {
    // Si el elemento sigue en DOM, actualizar series sin recrear el chart (mucho más rápido)
    if (prev.el && document.body.contains(prev.el)) {
      prev.updateOptions({ series, colors: opts.colors }, false, false, false);
      return;
    }
    // Elemento fue destruido por innerHTML — orphan, no necesita destroy()
    delete STATE.charts[elId];
  }

  const el = document.getElementById(elId);
  if (!el) return;

  const ch = new ApexCharts(el, opts);
  ch.render();
  STATE.charts[elId] = ch;
}

// ── DOWNLOAD CHART AS PNG ─────────────────────────────────────────────────────
function dlChart(chartId, name) {
  const ch = STATE.charts[chartId];
  if (!ch) return;
  ch.dataURI().then(({ imgURI }) => {
    const a = document.createElement("a");
    a.href     = imgURI;
    a.download = `yango_${name}_${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

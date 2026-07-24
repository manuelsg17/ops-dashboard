// vendor.js — Bootstrap de librerías de terceros (Fase A1, migración a Vite).
//
// Reemplaza los <script src="cdn..."> con SRI del index.html: las 7 librerías
// ahora vienen de npm (pineadas en package.json + package-lock, sin mantener SRI
// a mano). Este módulo corre PRIMERO (es el único type="module" y va antes que
// los <script defer> de la app en el orden del documento → se ejecuta antes,
// pero después del parseo y antes de DOMContentLoaded).
//
// Expone cada librería como global con el MISMO nombre que tenían las versiones
// UMD del CDN, para que el código de la app (aún en scope global clásico durante
// la transición A1→A2) las siga encontrando sin cambios:
//   supabase.createClient · XLSX · ApexCharts · Chart · html2canvas · jspdf.jsPDF
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import ApexCharts from "apexcharts";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// El plugin datalabels se auto-registraba globalmente en la versión UMD del CDN
// (por eso el código pone `datalabels:{display:false}` en los charts que NO lo
// quieren). Registrarlo acá replica ese comportamiento por defecto.
Chart.register(ChartDataLabels);

window.supabase    = { createClient };
window.XLSX        = XLSX;
window.ApexCharts  = ApexCharts;
window.Chart       = Chart;
window.html2canvas = html2canvas;
window.jspdf       = { jsPDF };

// ── Módulos de app (Fase A2 completa: los 16 archivos ya son módulos ES) ─────
// Todo el código de la app vive en módulos ES ahora — ya no hay <script defer>
// clásicos en index.html. Igual se espeja todo a window (Object.assign) porque
// las funciones se siguen invocando desde HANDLERS INLINE del HTML (onclick=
// "fn(...)", ~183 de ellos) — eso requiere que `fn` exista como global. Matar
// ese espejo requiere primero migrar los onclick a event delegation (próxima
// fase de A2), momento en el que este Object.assign deja de hacer falta.
import * as config       from "./core/config.js";
import * as security     from "./core/security.js";
import * as format       from "./core/format.js";
import * as dates        from "./core/dates.js";
import * as data         from "./data.js";
import * as auth         from "./auth.js";
import * as charts       from "./charts.js";
import * as rendimiento  from "./rendimiento.js";
import * as metas        from "./metas.js";
import * as app          from "./app.js";
import * as unifview     from "./unifview.js";
import * as rawdata      from "./rawdata.js";
import * as partnerView  from "./partnerView.js";
import * as calculator   from "./calculator.js";
import * as seguimiento  from "./seguimiento.js";
import * as fleetexterno from "./fleetexterno.js";
import * as forecast     from "./forecast.js";
import * as adminUsers   from "./adminUsers.js";
import * as presentacion2 from "./presentacion2.js";
Object.assign(window,
  config, security, format, dates, data, auth, charts,
  rendimiento, metas, app, unifview, rawdata, partnerView,
  calculator, seguimiento, fleetexterno, forecast, presentacion2, adminUsers
);

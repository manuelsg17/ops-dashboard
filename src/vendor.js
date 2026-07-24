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

// shared/icons.ts — Set de iconos SVG (Ola 4, sep-2026)
//
// Reemplazo de los emojis-como-icono (234 usos, 65 distintos, que cambian de
// dibujo según el sistema operativo). Fuente: `lucide` (ISC), pineado en
// package.json. Se importa icono POR icono — el paquete declara
// `sideEffects:false`, así que Rollup deja afuera los otros ~3.600.
//
// CSP: el SVG va INLINE en el HTML (string), sin <script>, sin handlers y sin
// `style=`; `script-src 'self'` no aplica. Tampoco hay <use href> a un sprite
// externo, así que no depende de img-src.
//
// Agregar un icono: importarlo abajo y sumarlo a ICONS con un nombre en
// kebab-case. Los nombres son NUESTROS (estables), no los de lucide — si
// lucide renombra algo (ya pasó: Filter→Funnel, AlertTriangle→TriangleAlert,
// Trash2→Trash) se cambia solo el import.
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, Bike, Building, Calculator, Calendar,
  Car, CarTaxiFront, ChartColumn, ChartLine, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleAlert, CircleCheck, Clock, Copy, Database, Download, Eye,
  FileText, Flag, Funnel, Globe, Image, Info, Lightbulb, ListChecks, Lock, LogOut,
  MapPin, Menu, Minus, Motorbike, Package, Pencil, Plus, Presentation, Printer,
  RefreshCw, Rocket, Save, Search, Settings, Star, Table, Target, Trash,
  TrendingDown, TrendingUp, TriangleAlert, Truck, Upload, User, Users, X
} from "lucide";

/** Formato de lucide ≥1.x: lista de [tag, atributos] hijos del <svg>. */
type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

export const ICONS = {
  "activity": Activity,
  "alert-circle": CircleAlert,
  "alert-triangle": TriangleAlert,
  "arrow-down": ArrowDown,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "bike": Bike,
  "building": Building,
  "calculator": Calculator,
  "calendar": Calendar,
  "car": Car,
  "chart-bar": ChartColumn,
  "chart-line": ChartLine,
  "check": Check,
  "check-circle": CircleCheck,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "clock": Clock,
  "copy": Copy,
  "database": Database,
  "download": Download,
  "edit": Pencil,
  "eye": Eye,
  "file-text": FileText,
  "filter": Funnel,
  "flag": Flag,
  "globe": Globe,
  "image": Image,
  "info": Info,
  "lightbulb": Lightbulb,
  "list-check": ListChecks,
  "lock": Lock,
  "log-out": LogOut,
  "map-pin": MapPin,
  "menu": Menu,
  "minus": Minus,
  "package": Package,
  "plus": Plus,
  "presentation": Presentation,
  "printer": Printer,
  "refresh": RefreshCw,
  "rocket": Rocket,
  "save": Save,
  "search": Search,
  "settings": Settings,
  "star": Star,
  "table": Table,
  "target": Target,
  "taxi": CarTaxiFront,
  "trash": Trash,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  "truck": Truck,
  // Lucide no tiene mototaxi; la moto es lo más cercano a un TukTuk que se
  // lee a 16px. Nombre propio para poder cambiar el dibujo en un solo lugar.
  "tuktuk": Motorbike,
  "upload": Upload,
  "user": User,
  "users": Users,
  "x": X
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export interface IconOptions {
  /** Lado en px (default 16). */
  size?: number;
  /** Grosor del trazo (default 2; 1.75 se ve mejor a ≥20px). */
  strokeWidth?: number;
  /** Si el icono va SOLO (sin texto al lado) y comunica algo, su nombre
   *  accesible. Sin label el icono es decorativo (aria-hidden). */
  label?: string;
  /** Clases extra (se suman a `ui-icon`). */
  className?: string;
}

const _ATTR_SAFE = /^[a-zA-Z][a-zA-Z0-9-]*$/;

function _escAttr(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** SVG inline como string. Nombre desconocido → "" (y aviso en consola en
 *  dev): un icono faltante no debe romper el render de una vista. */
export function iconSvg(name: IconName | string, opts: IconOptions = {}): string {
  if (!isIconName(name)) {
    if ((import.meta as any).env?.DEV) console.warn(`[icons] icono desconocido: ${name}`);
    return "";
  }
  const node = ICONS[name] as IconNode;
  const size = Number.isFinite(opts.size) && (opts.size as number) > 0 ? opts.size : 16;
  const sw = Number.isFinite(opts.strokeWidth) && (opts.strokeWidth as number) > 0 ? opts.strokeWidth : 2;
  const cls = ["ui-icon", opts.className].filter(Boolean).join(" ");
  const a11y = opts.label
    ? `role="img" aria-label="${_escAttr(opts.label)}"`
    : `aria-hidden="true" focusable="false"`;
  const children = node.map(([tag, attrs]) => {
    if (!_ATTR_SAFE.test(tag)) return "";
    const at = Object.entries(attrs)
      .filter(([k, v]) => v !== undefined && _ATTR_SAFE.test(k))
      .map(([k, v]) => `${k}="${_escAttr(v)}"`).join(" ");
    return `<${tag} ${at}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${_escAttr(cls)}" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${a11y}>${children}</svg>`;
}

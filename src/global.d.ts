//@ts-nocheck
import { State } from './domain/types';

declare global {
  var STATE: State;
  var CALC_STATE: any;
  var supabase: any;
  var XLSX: any;
  var ApexCharts: any;
  var Chart: any;
  var html2canvas: any;
  var jspdf: any;
  var loadViewModule: (viewName: string) => Promise<any>;
  var escapeHTML: (str: any) => string;
  var fmt: {
    num: (n: any) => string;
    pct: (n: any) => string;
    cur: (n: any) => string;
    sol: (n: any) => string;
  };
  
  interface Window {
    STATE: State;
    CALC_STATE: any;
    supabase: any;
    XLSX: any;
    ApexCharts: any;
    Chart: any;
    html2canvas: any;
    jspdf: any;
    loadViewModule: (viewName: string) => Promise<any>;
  }
}

export {};

export interface RendimientoRow {
  clid: string;
  month: string;
  week: string;
  date: string;
  city: string;
  trips: number;
  gmv: number;
  [key: string]: any;
}

export interface MetasRow {
  clid: string;
  month: string;
  city: string;
  supply_hours: number;
  active_drivers: number;
  [key: string]: any;
}

export interface State {
  mode: string;
  dates: string[];
  dateFrom: string;
  dateTo: string;
  city: string;
  kam: string;
  search: string;
  selectedClids: Set<string>;
  
  CLID_MAP: Record<string, string>;
  CLID_KAM: Record<string, string>;
  CITY_MAP: Record<string, string>;
  KAM_LIST: string[];
  
  rawRendimiento: RendimientoRow[];
  rawMetas: MetasRow[];
  rawFlotas: any[];
  
  user: any;
  userEmail: string;
  isAdmin: boolean;
  isKam: boolean;
  loading: boolean;
}

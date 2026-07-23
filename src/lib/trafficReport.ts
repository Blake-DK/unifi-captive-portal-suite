import { dpiAppName, dpiCategoryName } from "./dpiCatalog";
import type { TrafficAppUsage } from "./unifi";

export type AppRow = {
  name: string;
  category: string;
  rx: number;
  tx: number;
  total: number;
};

export type CategoryRow = { name: string; rx: number; tx: number; total: number };

export function parseHours(raw: string | null): number {
  const h = parseInt(raw ?? "", 10);
  return [24, 72, 168, 720].includes(h) ? h : 24;
}

/** Roll usage entries up into named app and category rows, largest first. */
export function aggregateTraffic(usage: TrafficAppUsage[]): {
  apps: AppRow[];
  categories: CategoryRow[];
} {
  const apps = new Map<string, AppRow>();
  const cats = new Map<string, CategoryRow>();

  for (const u of usage) {
    const rx = u.bytes_received ?? 0;
    const tx = u.bytes_transmitted ?? 0;
    const total = u.total_bytes ?? rx + tx;

    const appKey = `${u.category}:${u.application}`;
    const app = apps.get(appKey) ?? {
      name: dpiAppName(u.category, u.application),
      category: dpiCategoryName(u.category),
      rx: 0,
      tx: 0,
      total: 0,
    };
    app.rx += rx;
    app.tx += tx;
    app.total += total;
    apps.set(appKey, app);

    const catKey = dpiCategoryName(u.category);
    const cat = cats.get(catKey) ?? { name: catKey, rx: 0, tx: 0, total: 0 };
    cat.rx += rx;
    cat.tx += tx;
    cat.total += total;
    cats.set(catKey, cat);
  }

  return {
    apps: [...apps.values()].sort((a, b) => b.total - a.total).slice(0, 40),
    categories: [...cats.values()].sort((a, b) => b.total - a.total),
  };
}

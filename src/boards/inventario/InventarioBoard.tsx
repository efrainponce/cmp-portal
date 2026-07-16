// Inventario (2026-07-15): native D1 feature (warehouses/movements/stock), not a
// Monday-mirrored board — no StageBoardList/OpportunityDrawer here. Three tabs: Stock,
// Movimientos, Nuevo movimiento — see src/lib/inventoryApi.ts for the fetch client.
import { useState } from 'react';
import { Tabs, type TabDef } from '../../components/navigation/Tabs';
import { StockTab } from './tabs/StockTab';
import { MovementsTab } from './tabs/MovementsTab';
import { NewMovementTab } from './tabs/NewMovementTab';

type InventarioTabKey = 'stock' | 'movimientos' | 'nuevo';

const TABS: TabDef[] = [
  { key: 'stock', label: 'Stock' },
  { key: 'movimientos', label: 'Movimientos' },
  { key: 'nuevo', label: 'Nuevo movimiento' },
];

export function InventarioBoard() {
  const [tab, setTab] = useState<InventarioTabKey>('stock');
  // Bumped after a successful create so Stock/Movimientos refetch when visited next.
  const [version, setVersion] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '26px 32px 0', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Inventario</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', margin: '2px 0 16px' }}>
          Stock por almacén y bitácora de movimientos
        </div>
        <Tabs tabs={TABS} activeKey={tab} onChange={(k) => setTab(k as InventarioTabKey)} />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {tab === 'stock' && <StockTab refreshToken={version} />}
        {tab === 'movimientos' && <MovementsTab refreshToken={version} />}
        {tab === 'nuevo' && (
          <NewMovementTab
            onCreated={() => {
              setVersion((v) => v + 1);
              setTab('movimientos');
            }}
          />
        )}
      </div>
    </div>
  );
}

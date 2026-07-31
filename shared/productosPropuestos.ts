// shared/productosPropuestos.ts — contrato del tab "Nuevos productos" del drawer
// de Oportunidad. Nativo en D1 (worker/lib/productosPropuestos.ts): no hay board
// de Monday detrás, no se sincroniza al mirror ni al outbox.
export interface ProposedProductDTO {
  id: string;
  nombre: string;
  descripcion: string;
  imageUrl?: string;
  createdBy: string;
  createdAt: string;
}

export interface ProposedProductsResponse {
  productos: ProposedProductDTO[];
}

export interface AddProposedProductResponse {
  ok: true;
  producto: ProposedProductDTO;
}

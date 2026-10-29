-- Migración escrita a mano: Prisma no puede expresar estas restricciones en schema.prisma.

-- btree_gist permite combinar igualdad sobre uuid con traslape de rangos en un índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Un espacio no puede tener dos reservas CONFIRMED con horarios traslapados.
-- El rango '[)' incluye el inicio y excluye el fin, así que horarios contiguos sí se permiten.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_no_overlap"
  EXCLUDE USING gist (
    "spaceId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" = 'CONFIRMED');

-- El fin de la reserva debe ser posterior a su inicio.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_endsAt_after_startsAt"
  CHECK ("endsAt" > "startsAt");

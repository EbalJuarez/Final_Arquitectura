import type { Request, Response } from 'express';
import type { CreateReservationInput, IdParams } from '@reservalab/shared';
import { getAuthUser } from '../middleware/authenticate';
import * as reservationService from '../services/reservation.service';

// body y params ya vienen validados por el middleware validate() de cada ruta.

export async function create(req: Request, res: Response): Promise<void> {
  const reservation = await reservationService.createReservation(getAuthUser(req), req.body as CreateReservationInput);
  res.status(201).json(reservation);
}

export async function mine(req: Request, res: Response): Promise<void> {
  res.json(await reservationService.listMyReservations(getAuthUser(req).id));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  res.json(await reservationService.cancelReservation(getAuthUser(req), id));
}

import { Router } from "express";
import {
  getMachines,
  getMonthlyRevenue,
  forceRefreshMonthlyRevenue
} from "../controllers/machineController.js";

const router = Router();

router.post("/monthly-revenue/refresh", forceRefreshMonthlyRevenue);
router.get("/monthly-revenue", getMonthlyRevenue);
router.get("/", getMachines);

export default router;
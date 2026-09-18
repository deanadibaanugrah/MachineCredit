import "dotenv/config";
import express from "express";
import cors from "cors";

import machineRoutes from "./routes/machineRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "MachineCredit API is running"
  });
});

app.use("/api/machines", machineRoutes);

app.use("/api/portfolio", portfolioRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MachineCredit API running on port ${PORT}`);
});
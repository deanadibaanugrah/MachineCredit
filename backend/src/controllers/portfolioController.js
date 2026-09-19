import { ethers } from "ethers";
import { machineCredit } from "../config/blockchain.js";

const FINANCING_STATUS_LABEL = ["Open", "Completed", "Defaulted"];

export async function getPortfolio(req, res) {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address"
      });
    }

    const count = await machineCredit.machineCount();

    const positions = [];

    let totalInvested = 0n;
    let totalEarned = 0n;
    let totalClaimablePrincipal = 0n;

    for (let i = 1; i <= Number(count); i++) {

      const machine = await machineCredit.getMachine(i);

      const investor =
        await machineCredit.getInvestor(i, wallet);

      const pending =
        await machineCredit.getPendingRevenue(i, wallet);

      const invested = investor[0];
      const earned = investor[1];
      const active = investor[2];

      // Wallet belum pernah investasi di machine ini
      if (invested === 0n) {
        continue;
      }

      totalInvested += invested;
      totalEarned += earned;

      const financing = await machineCredit.getFinancing(i);
      const financingStatusCode = Number(financing[5]);

      const claimablePrincipal =
        await machineCredit.getClaimablePrincipal(i, wallet);

      totalClaimablePrincipal += claimablePrincipal;

      positions.push({
        machineId: i,

        externalMachineId: machine[0],
        machineName: machine[1],

        performanceScore: Number(machine[2]),
        monthlyRevenue: machine[3].toString(),

        fundingTarget: machine[4].toString(),
        totalFunded: machine[5].toString(),

        revenueSharePercent: Number(machine[6]),

        invested: invested.toString(),
        totalEarned: earned.toString(),
        pendingRevenue: pending.toString(),

        active,

        financingStatus: FINANCING_STATUS_LABEL[financingStatusCode] || "Unknown",
        principalRepaid: financing[3].toString(),
        principalLoss: financing[4].toString(),
        claimablePrincipal: claimablePrincipal.toString()
      });
    }

    const averagePerformance =
      positions.length
        ? positions.reduce(
            (sum, position) =>
              sum + position.performanceScore,
            0
          ) / positions.length
        : 0;

    res.json({
      success: true,

      wallet,

      totalInvested: totalInvested.toString(),
      totalEarned: totalEarned.toString(),

      totalPending: positions.reduce(
        (sum, position) =>
          sum + BigInt(position.pendingRevenue),
        0n
      ).toString(),

      totalClaimablePrincipal: totalClaimablePrincipal.toString(),

      averagePerformance,

      positions
    });

  } catch (error) {

    console.error("Portfolio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch portfolio"
    });
  }
}
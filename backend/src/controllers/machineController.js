import { machineCredit, provider } from "../config/blockchain.js";
import { ethers } from "ethers";

/* =========================================================
   MONTHLY REVENUE — dihitung di background, bukan per-request
   ========================================================= */

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const LOG_CHUNK_SIZE = 5000;
const CONCURRENCY = 8;
const REFRESH_INTERVAL_MS = 20000; // hitung ulang tiap 20 detik

let monthlyRevenueState = {
  ready: false,
  data: null,
  updatedAt: null,
  error: null
};


async function computeMonthlyRevenue() {

  const latestBlockNumber =
    await provider.getBlockNumber();

  const latestBlock =
    await provider.getBlock(latestBlockNumber);

  const cutoffTimestamp =
    latestBlock.timestamp - THIRTY_DAYS_SECONDS;

  // Binary search: cari block pertama yang timestamp-nya >= cutoff
  let lo = 0;
  let hi = latestBlockNumber;

  while (lo < hi) {

    const mid = Math.floor((lo + hi) / 2);

    const block = await provider.getBlock(mid);

    if (block.timestamp < cutoffTimestamp) {
      lo = mid + 1;
    } else {
      hi = mid;
    }

  }

  const fromBlock = lo;

  const ranges = [];

  for (
    let start = fromBlock;
    start <= latestBlockNumber;
    start += LOG_CHUNK_SIZE
  ) {

    ranges.push([
      start,
      Math.min(start + LOG_CHUNK_SIZE - 1, latestBlockNumber)
    ]);

  }

  const filter = machineCredit.filters.RevenueDeposited();

  const logs = [];

  for (let i = 0; i < ranges.length; i += CONCURRENCY) {

    const batch = ranges.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(([start, end]) =>
        machineCredit.queryFilter(filter, start, end)
      )
    );

    results.forEach(chunk => logs.push(...chunk));

  }

  let totalRaw = 0n;
  let depositCount = 0;
  const perMachine = {};

  // Semua log di range ini sudah pasti >= cutoff (hasil binary search),
  // jadi tidak perlu cek timestamp per-log lagi.
  for (const log of logs) {

    const revenue = BigInt(log.args.revenue);
    const machineId = Number(log.args.machineId);

    totalRaw += revenue;
    depositCount++;

    perMachine[machineId] =
      (BigInt(perMachine[machineId] || 0n) + revenue).toString();

  }

  return {
    totalRaw: totalRaw.toString(),
    total: Number(ethers.formatUnits(totalRaw, 6)),
    depositCount,
    perMachine,
    windowDays: 30,
    fromBlock,
    toBlock: latestBlockNumber
  };

}


async function refreshMonthlyRevenue() {

  try {

    const data = await computeMonthlyRevenue();

    monthlyRevenueState = {
      ready: true,
      data,
      updatedAt: Date.now(),
      error: null
    };

  } catch (error) {

    console.error("Failed to refresh monthly revenue:", error);

    monthlyRevenueState.error =
      error?.message || "Unknown error";

  }

}




// Mulai hitung sejak server start, lalu ulangi berkala di background.
refreshMonthlyRevenue();

setInterval(refreshMonthlyRevenue, REFRESH_INTERVAL_MS);


export async function getMonthlyRevenue(req, res) {

  if (!monthlyRevenueState.ready) {

    return res.json({
      success: true,
      cached: false,
      warming: true,
      data: {
        total: 0,
        depositCount: 0,
        perMachine: {},
        windowDays: 30
      }
    });

  }

  res.json({
    success: true,
    cached: true,
    updatedAt: monthlyRevenueState.updatedAt,
    data: monthlyRevenueState.data
  });

}


export async function getMachines(req, res) {
  try {
    const count = await machineCredit.machineCount();

    const machines = [];

    for (let i = 1; i <= Number(count); i++) {
      const machine = await machineCredit.getMachine(i);

      machines.push({
        id: i,
        machineId: machine[0],
        name: machine[1],
        performanceScore: Number(machine[2]),
        monthlyRevenue: Number(machine[3]),
        fundingTarget: Number(machine[4]),
        totalFunded: Number(machine[5]),
        revenueSharePercent: Number(machine[6]),
        owner: machine[7],
        active: machine[8]
      });
    }

    res.json({
      success: true,
      count: machines.length,
      data: machines
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch machines from blockchain"
    });
  }
}

export async function forceRefreshMonthlyRevenue(req, res) {

  try {

    await refreshMonthlyRevenue();

    return res.json({
      success: true,
      data: monthlyRevenueState.data,
      updatedAt: monthlyRevenueState.updatedAt
    });

  } catch (error) {

    console.error(
      "Failed to force refresh monthly revenue:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to refresh monthly revenue"
    });

  }

}
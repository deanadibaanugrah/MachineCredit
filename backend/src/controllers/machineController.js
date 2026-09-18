import { machineCredit, provider } from "../config/blockchain.js";
import { ethers } from "ethers";

/* =========================================================
   MONTHLY REVENUE — dihitung di background, bukan per-request
   ========================================================= */

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_INTERVAL_MS = 20000; // hitung ulang tiap 20 detik

const BLOCKSCOUT_API_URL =
  "https://scan.bohr.life/api/v2";

const REVENUE_DEPOSITED_TOPIC =
  ethers.id(
    "RevenueDeposited(uint256,uint256,uint256,uint256)"
  );

const revenueInterface =
  new ethers.Interface([
    "event RevenueDeposited(uint256 indexed machineId,uint256 revenue,uint256 lenderPool,uint256 companyShare)"
  ]);

let monthlyRevenueState = {
  ready: false,
  data: null,
  updatedAt: null,
  error: null
};


/* =========================================================
   BLOCKSCOUT — AMBIL HISTORICAL LOGS
   ========================================================= */

async function getRevenueLogs() {

  const contractAddress =
    process.env.MACHINECREDIT_ADDRESS;

  const logs = [];

  let nextPageParams = null;

  while (true) {

    const params =
      new URLSearchParams();

    if (nextPageParams) {

      for (
        const [key, value]
        of Object.entries(nextPageParams)
      ) {

        if (
          value !== null &&
          value !== undefined
        ) {

          params.set(
            key,
            String(value)
          );

        }

      }

    }

    const url =
      `${BLOCKSCOUT_API_URL}/addresses/${contractAddress}/logs` +
      (
        params.toString()
          ? `?${params.toString()}`
          : ""
      );

    const response =
      await fetch(url);

    if (!response.ok) {

      throw new Error(
        `Blockscout logs request failed: HTTP ${response.status}`
      );

    }

    const result =
      await response.json();

    const items =
      Array.isArray(result.items)
        ? result.items
        : [];

    logs.push(...items);

    nextPageParams =
      result.next_page_params;

    if (!nextPageParams) {
      break;
    }

  }

  return logs;

}


/* =========================================================
   COMPUTE MONTHLY REVENUE
   ========================================================= */

async function computeMonthlyRevenue() {

  /* -------------------------------------------------------
     Ambil block terbaru dari RPC utama
     ------------------------------------------------------- */

  const latestBlockNumber =
    await provider.getBlockNumber();

  const latestBlock =
    await provider.getBlock(
      latestBlockNumber
    );

  if (!latestBlock) {
    throw new Error(
      "Failed to fetch latest block"
    );
  }


  /* -------------------------------------------------------
     Tentukan timestamp 30 hari terakhir
     ------------------------------------------------------- */

  const cutoffTimestamp =
    latestBlock.timestamp -
    THIRTY_DAYS_SECONDS;


  /* -------------------------------------------------------
     Binary search:
     cari block pertama yang timestamp-nya
     >= cutoffTimestamp
     ------------------------------------------------------- */

  let lo = 0;
  let hi = latestBlockNumber;

  while (lo < hi) {

    const mid =
      Math.floor(
        (lo + hi) / 2
      );

    const block =
      await provider.getBlock(mid);

    if (!block) {
      throw new Error(
        `Failed to fetch block ${mid}`
      );
    }

    if (
      block.timestamp <
      cutoffTimestamp
    ) {

      lo = mid + 1;

    } else {

      hi = mid;

    }

  }

  const fromBlock = lo;


  /* -------------------------------------------------------
     Ambil semua logs dari Blockscout
     ------------------------------------------------------- */

  const logs =
    await getRevenueLogs();


  /* -------------------------------------------------------
     Filter hanya logs yang berada dalam
     window 30 hari terakhir
     ------------------------------------------------------- */

  const recentLogs =
    logs.filter(log => {

      const blockNumber =
        Number(log.block_number);

      return (
        blockNumber >= fromBlock &&
        blockNumber <= latestBlockNumber
      );

    });


  /* -------------------------------------------------------
     Hitung revenue
     ------------------------------------------------------- */

  let totalRaw = 0n;

  let depositCount = 0;

  const perMachine = {};


  /* -------------------------------------------------------
     Decode hanya RevenueDeposited
     ------------------------------------------------------- */

  for (const log of recentLogs) {

    const topic =
      log.topics?.[0];

    if (
      !topic ||
      topic.toLowerCase() !==
      REVENUE_DEPOSITED_TOPIC.toLowerCase()
    ) {

      continue;

    }

    try {

      const parsed =
        revenueInterface.parseLog({
          topics: log.topics.filter(
            topic => topic !== null
          ),
          data: log.data
        });

      if (!parsed) {
        continue;
      }


      const revenue =
        BigInt(
          parsed.args.revenue
        );

      const machineId =
        Number(
          parsed.args.machineId
        );


      totalRaw += revenue;

      depositCount++;


      perMachine[machineId] =
        (
          BigInt(
            perMachine[machineId] || 0n
          ) + revenue
        ).toString();


    } catch (error) {

      console.warn(
        "Failed to decode RevenueDeposited log:",
        error
      );

    }

  }


  /* -------------------------------------------------------
     Return hasil
     ------------------------------------------------------- */

  return {

    totalRaw:
      totalRaw.toString(),

    total:
      Number(
        ethers.formatUnits(
          totalRaw,
          6
        )
      ),

    depositCount,

    perMachine,

    windowDays: 30,

    fromBlock,

    toBlock:
      latestBlockNumber

  };

}


/* =========================================================
   BACKGROUND REFRESH
   ========================================================= */

async function refreshMonthlyRevenue() {

  try {

    const data =
      await computeMonthlyRevenue();

    monthlyRevenueState = {

      ready: true,

      data,

      updatedAt:
        Date.now(),

      error: null

    };

    console.log(
      "Monthly revenue refreshed:",
      data
    );

  } catch (error) {

    console.error(
      "Failed to refresh monthly revenue:",
      error
    );

    monthlyRevenueState.error =
      error?.message ||
      "Unknown error";

  }

}


/* =========================================================
   START BACKGROUND PROCESS
   ========================================================= */

// Mulai hitung sejak server start.
refreshMonthlyRevenue();

// Hitung ulang setiap 20 detik.
setInterval(
  refreshMonthlyRevenue,
  REFRESH_INTERVAL_MS
);


/* =========================================================
   GET MONTHLY REVENUE
   ========================================================= */

export async function getMonthlyRevenue(
  req,
  res
) {

  if (
    !monthlyRevenueState.ready
  ) {

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


  return res.json({

    success: true,

    cached: true,

    updatedAt:
      monthlyRevenueState.updatedAt,

    data:
      monthlyRevenueState.data

  });

}


/* =========================================================
   GET MACHINES
   ========================================================= */

export async function getMachines(
  req,
  res
) {

  try {

    const count =
      await machineCredit.machineCount();

    const machines = [];


    for (
      let i = 1;
      i <= Number(count);
      i++
    ) {

      const machine =
        await machineCredit.getMachine(i);


      machines.push({

        id: i,

        machineId:
          machine[0],

        name:
          machine[1],

        performanceScore:
          Number(machine[2]),

        monthlyRevenue:
          Number(machine[3]),

        fundingTarget:
          Number(machine[4]),

        totalFunded:
          Number(machine[5]),

        revenueSharePercent:
          Number(machine[6]),

        owner:
          machine[7],

        active:
          machine[8]

      });

    }


    return res.json({

      success: true,

      count:
        machines.length,

      data:
        machines

    });

  } catch (error) {

    console.error(
      error
    );


    return res.status(500).json({

      success: false,

      message:
        "Failed to fetch machines from blockchain"

    });

  }

}


/* =========================================================
   FORCE REFRESH MONTHLY REVENUE
   ========================================================= */

export async function forceRefreshMonthlyRevenue(
  req,
  res
) {

  try {

    await refreshMonthlyRevenue();


    return res.json({

      success: true,

      data:
        monthlyRevenueState.data,

      updatedAt:
        monthlyRevenueState.updatedAt

    });

  } catch (error) {

    console.error(
      "Failed to force refresh monthly revenue:",
      error
    );


    return res.status(500).json({

      success: false,

      message:
        "Failed to refresh monthly revenue"

    });

  }

}